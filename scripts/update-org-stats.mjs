/**
 * Generate Tern org contribution board, commit graph, and code genome.
 * Intended for local runs and the daily GitHub Actions workflow.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const __dirname = dirname(SCRIPT_PATH);
const ROOT = resolve(__dirname, "..");
const PROFILE_DIR = join(ROOT, "profile");
const STATS_DIR = join(PROFILE_DIR, "stats");
const README_PATH = join(PROFILE_DIR, "README.md");
const TZ = "Asia/Shanghai";
const MARK_START = "<!-- org-stats:start -->";
const MARK_END = "<!-- org-stats:end -->";
const STATS_SUBJECT = "chore(stats): daily org contribution board";

const BOT_LOGINS = new Set([
  "dependabot[bot]",
  "dependabot",
  "github-actions[bot]",
  "github-actions",
  "renovate[bot]",
  "imgbot[bot]",
]);

const EMAIL_ALIASES = {
  "yunyang@gmail.com": "yunyanggit",
  "2339317361@qq.com": "chenqian2",
};

const NAME_ALIASES = {
  云阳: "yunyanggit",
  null: "backspace135",
};

const LANG_COLORS = {
  Go: "#00ADD8",
  TypeScript: "#3178C6",
  JavaScript: "#F1E05A",
  CSS: "#563D7C",
  Makefile: "#427819",
  Dockerfile: "#384D54",
  HTML: "#E34C26",
  Python: "#3572A5",
  YAML: "#CB171E",
  Shell: "#89E051",
  Markdown: "#083FA1",
  JSON: "#292929",
  TOML: "#9C4221",
  Protobuf: "#A72B2B",
  Other: "#64748B",
};

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function ghToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return sh("gh", ["auth", "token"]);
  } catch {
    return "";
  }
}

function orgFromRemote() {
  try {
    const remote = sh("git", ["-C", ROOT, "remote", "get-url", "origin"]);
    const m = remote.match(/github\.com[:/]([^/]+)\//i);
    if (m) return m[1];
  } catch {
    // fall through
  }
  return process.env.ORG_LOGIN || "ternsms";
}

async function ghApi(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "tern-org-stats",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${path} -> ${res.status} ${body.slice(0, 240)}`);
  }
  return res.json();
}

async function ghApiPaged(path, token) {
  const items = [];
  let page = 1;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await ghApi(`${path}${sep}per_page=100&page=${page}`, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return items;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatInt(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function shanghaiNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

function fmtStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} CST`;
}

function ymdInTz(date, tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(ymd, days) {
  const dt = parseYmd(ymd);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function weekdayMon0(ymd) {
  const day = parseYmd(ymd).getUTCDay();
  return (day + 6) % 7;
}

function isBot({ login, email, name }) {
  const hay = `${login || ""} ${email || ""} ${name || ""}`.toLowerCase();
  if (hay.includes("[bot]") || hay.includes("bot@") || hay.endsWith("bot")) return true;
  if (login && BOT_LOGINS.has(login)) return true;
  return false;
}

function resolveLogin({ name, email }) {
  const em = (email || "").trim().toLowerCase();
  const nm = (name || "").trim();
  const noreply = em.match(/^(\d+)\+([^@]+)@users\.noreply\.github\.com$/);
  if (noreply) return noreply[2];
  const idOnly = em.match(/^(\d+)@users\.noreply\.github\.com$/);
  if (EMAIL_ALIASES[em]) return EMAIL_ALIASES[em];
  if (NAME_ALIASES[nm]) return NAME_ALIASES[nm];
  if (nm && !nm.includes(" ") && /^[A-Za-z0-9-]+$/.test(nm)) return nm;
  if (idOnly) return nm || em;
  return nm || em || "unknown";
}

function cloneUrl(fullName, token) {
  if (token) return `https://x-access-token:${token}@github.com/${fullName}.git`;
  return `https://github.com/${fullName}.git`;
}

function gitLog(dir, ref) {
  const args = [
    "-C",
    dir,
    "log",
    "--no-merges",
    "--format=%aN%x09%aE%x09%ad%x09%H%x09%s",
    "--date=format:%Y-%m-%d",
  ];
  if (ref) args.push(ref);
  try {
    const out = sh("git", args);
    if (!out) return [];
    return out.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, email, date, hash, ...rest] = line.split("\t");
      return { name, email, date, hash, subject: rest.join("\t") };
    });
  } catch (error) {
    console.warn(`git log failed in ${dir}: ${error.stderr || error.message}`);
    return [];
  }
}

function gitFiles(dir) {
  try {
    const out = sh("git", ["-C", dir, "ls-tree", "-r", "HEAD", "--name-only"]);
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function prepareRepo(repo, token, scratch) {
  const sibling = resolve(ROOT, "..", repo.name);
  if (existsSync(join(sibling, ".git"))) return sibling;
  if (repo.name === ".github" && existsSync(join(ROOT, ".git"))) return ROOT;
  const dest = join(scratch, repo.name);
  const args = [
    "clone",
    "--bare",
    "--filter=blob:none",
    "--quiet",
    cloneUrl(repo.fullName, token),
    dest,
  ];
  sh("git", args);
  return dest;
}

async function loadAvatar(login, avatarUrl) {
  const url = avatarUrl || `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=80&v=4`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "tern-org-stats" } });
    if (!res.ok) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || "image/png";
    if (!/^image\/(?:png|jpe?g|gif|webp)$/i.test(mime)) return "";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

function heatLevel(count, max) {
  if (!count) return 0;
  const t = max <= 1 ? 1 : count / max;
  if (t > 0.8) return 4;
  if (t > 0.55) return 3;
  if (t > 0.3) return 2;
  return 1;
}

function wrapSvg(width, height, body, title) {
  const cleanBody = body.replace(/[ \t]+$/gm, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(title)}">
  <defs>
    <style>
      .bg { fill: #ffffff; }
      .border, .rule { stroke: #d0d7de; }
      .title, .ink, .num { fill: #1f2328; }
      .muted, .tiny { fill: #656d76; }
      .title { font: 600 18px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
      .ink { font: 600 13px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
      .num { font: 600 13px ui-monospace, SFMono-Regular, Consolas, monospace; }
      .muted { font: 400 11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
      .tiny { font: 400 10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
      .level-0 { fill: #ebedf0; }
      .level-1 { fill: #9be9a8; }
      .level-2 { fill: #40c463; }
      .level-3 { fill: #30a14e; }
      .level-4 { fill: #216e39; }
      @media (prefers-color-scheme: dark) {
        .bg { fill: #0d1117; }
        .border, .rule { stroke: #30363d; }
        .title, .ink, .num { fill: #e6edf3; }
        .muted, .tiny { fill: #8b949e; }
        .level-0 { fill: #161b22; }
        .level-1 { fill: #0e4429; }
        .level-2 { fill: #006d32; }
        .level-3 { fill: #26a641; }
        .level-4 { fill: #39d353; }
      }
    </style>
  </defs>
  <rect class="bg border" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="none"/>
${cleanBody.trim()}
</svg>
`;
}

function header(title, stamp, detail) {
  return `
  <text class="title" x="28" y="36">${xml(title)}</text>
  <text class="muted" x="872" y="29" text-anchor="end">${xml(detail)}</text>
  <text class="tiny" x="872" y="46" text-anchor="end">${xml(stamp)}</text>`;
}

function renderLeaderboard(contributors, stamp, repoCount) {
  const rows = contributors.slice(0, 12);
  const width = 900;
  const top = 66;
  const rowH = 56;
  const height = Math.max(150, top + rows.length * rowH + 14);

  const body = [
    header("Contributors", stamp, `${rows.length} people · ${repoCount} repositories`),
    `<line class="rule" x1="28" y1="58" x2="872" y2="58"/>`,
  ];

  if (!rows.length) {
    body.push(`<text class="muted" x="28" y="106">No human commits yet.</text>`);
    return wrapSvg(width, height, body.join("\n"), "Contributors");
  }

  rows.forEach((c, i) => {
    const y = top + i * rowH;
    const clip = `av${i}`;
    const avatar = c.avatarData
      ? `<image href="${c.avatarData}" x="58" y="${y + 10}" width="32" height="32" clip-path="url(#${clip})"/>`
      : `<circle cx="74" cy="${y + 26}" r="16" fill="#2da44e"/><text x="74" y="${y + 30}" text-anchor="middle" fill="#ffffff" style="font:600 10px sans-serif">${xml((c.login || "?").slice(0, 2))}</text>`;
    body.push(`
    <defs><clipPath id="${clip}"><circle cx="74" cy="${y + 26}" r="16"/></clipPath></defs>
    <text class="tiny" x="36" y="${y + 30}" text-anchor="middle">${i + 1}</text>
    ${avatar}
    <text class="ink" x="104" y="${y + 24}">${xml(c.login)}</text>
    <text class="tiny" x="104" y="${y + 41}">${xml(c.repos.join(" · ") || "—")} · last ${xml(c.lastDate || "—")}</text>
    <text class="num" x="856" y="${y + 29}" text-anchor="end">${formatInt(c.commits)}</text>
    <text class="tiny" x="872" y="${y + 29}">commits</text>
    <line class="rule" x1="28" y1="${y + rowH - 1}" x2="872" y2="${y + rowH - 1}"/>`);
  });

  return wrapSvg(width, height, body.join("\n"), "Contributors");
}

function renderCommits({ byDay, stamp, total, activeDays }) {
  const width = 900;
  const weeks = 53;
  const cell = 12;
  const gap = 3;
  const heatX = 70;
  const heatY = 88;
  const heatH = 7 * (cell + gap);
  const height = 238;
  const today = ymdInTz(new Date());
  const todayWeekday = weekdayMon0(today);
  const start = addDays(today, -((weeks - 1) * 7 + todayWeekday));
  const maxDay = Math.max(1, ...Object.values(byDay));
  const monthSeen = new Set();
  const cells = [];
  const monthLabels = [];

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      if (date > today) continue;
      const count = byDay[date] || 0;
      const x = heatX + w * (cell + gap);
      const y = heatY + d * (cell + gap);
      cells.push(`<rect class="level-${heatLevel(count, maxDay)}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2"><title>${date}: ${count}</title></rect>`);
      const month = date.slice(0, 7);
      if (!monthSeen.has(month) && date.slice(8) <= "07") {
        monthSeen.add(month);
        monthLabels.push(`<text class="tiny" x="${x}" y="${heatY - 8}">${xml(date.slice(5, 7))}</text>`);
      }
    }
  }

  const weekdays = ["Mon", "Wed", "Fri"];
  const weekdayText = [0, 2, 4]
    .map((d, i) => `<text class="tiny" x="${heatX - 10}" y="${heatY + d * (cell + gap) + 11}" text-anchor="end">${weekdays[i]}</text>`)
    .join("");

  const legend = [0, 1, 2, 3, 4]
    .map((i, idx) => `<rect class="level-${i}" x="${760 + idx * 17}" y="211" width="12" height="12" rx="2"/>`)
    .join("");

  const body = `
    ${header("Commits", stamp, `${formatInt(total)} commits · ${activeDays} active days`)}
    <line class="rule" x1="28" y1="58" x2="872" y2="58"/>
    ${weekdayText}
    ${monthLabels.join("\n")}
    ${cells.join("\n")}
    <text class="tiny" x="728" y="221">Less</text>
    ${legend}
    <text class="tiny" x="852" y="221">More</text>
  `;
  return wrapSvg(width, height, body, "Commits");
}

function renderGenome({ languages, filesByRepo, stamp, totalBytes }) {
  const width = 900;
  const entries = Object.entries(languages)
    .map(([name, bytes]) => ({ name, bytes, color: LANG_COLORS[name] || LANG_COLORS.Other }))
    .sort((a, b) => b.bytes - a.bytes);
  const sum = entries.reduce((s, x) => s + x.bytes, 0) || 1;
  const top = 112;
  const rowH = 34;
  const height = Math.max(190, top + entries.length * rowH + 16);
  const fileCount = Object.values(filesByRepo).reduce((count, files) => count + files.length, 0);
  let barX = 28;
  const bar = entries
    .map((lang) => {
      const segmentW = (lang.bytes / sum) * 844;
      const rect = `<rect x="${barX}" y="76" width="${segmentW}" height="12" fill="${lang.color}"/>`;
      barX += segmentW;
      return rect;
    })
    .join("");
  const rows = entries
    .map((lang, i) => {
      const y = top + i * rowH;
      const pct = ((lang.bytes / sum) * 100).toFixed(1);
      return `
    <circle cx="34" cy="${y + 12}" r="4" fill="${lang.color}"/>
    <text class="ink" x="48" y="${y + 16}">${xml(lang.name)}</text>
    <text class="muted" x="872" y="${y + 16}" text-anchor="end">${pct}% · ${formatBytes(lang.bytes)}</text>
    <line class="rule" x1="28" y1="${y + rowH - 1}" x2="872" y2="${y + rowH - 1}"/>`;
    })
    .join("");

  const body = `
    ${header("Code composition", stamp, `${formatBytes(totalBytes)} · ${fileCount} files`)}
    <line class="rule" x1="28" y1="58" x2="872" y2="58"/>
    <clipPath id="language-bar"><rect x="28" y="76" width="844" height="12" rx="6"/></clipPath>
    <g clip-path="url(#language-bar)">${bar}</g>
    ${rows}
  `;
  return wrapSvg(width, height, body, "Code composition");
}

function patchReadme(stamp, cacheBust) {
  let readme = readFileSync(README_PATH, "utf8");
  const section = `${MARK_START}
## 贡献看板

<sub>每日 00:00（北京时间）自动更新 · ${xml(stamp)}</sub>

<p align="center">
  <img src="./stats/leaderboard.svg?t=${cacheBust}" alt="Tern contributors" width="900" />
</p>
<p align="center">
  <img src="./stats/commits.svg?t=${cacheBust}" alt="Tern commit activity" width="900" />
</p>
<p align="center">
  <img src="./stats/genome.svg?t=${cacheBust}" alt="Tern code composition" width="900" />
</p>
${MARK_END}`;

  if (readme.includes(MARK_START) && readme.includes(MARK_END)) {
    const re = new RegExp(`${MARK_START}[\\s\\S]*?${MARK_END}`);
    readme = readme.replace(re, section);
  } else {
    readme = `${readme.trimEnd()}\n\n${section}\n`;
  }
  writeFileSync(README_PATH, readme);
}

async function main() {
  const token = ghToken();
  const org = orgFromRemote();
  mkdirSync(STATS_DIR, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "tern-org-stats-"));

  try {
    const repos = (await ghApiPaged(`/orgs/${org}/repos?type=all&sort=updated`, token))
      .filter((r) => !r.fork && !r.archived)
      .map((r) => ({
        name: r.name,
        fullName: r.full_name,
        defaultBranch: r.default_branch || "main",
        private: r.private,
      }));

    if (!repos.length) throw new Error(`No repositories found for org ${org}`);

    const languages = {};
    const filesByRepo = {};
    const people = new Map();
    const byDay = {};
    let totalCommits = 0;

    for (const repo of repos) {
      console.log(`scanning ${repo.fullName}`);
      let langs = {};
      try {
        langs = await ghApi(`/repos/${repo.fullName}/languages`, token);
      } catch (error) {
        console.warn(`languages failed for ${repo.fullName}: ${error.message}`);
      }
      for (const [k, v] of Object.entries(langs)) languages[k] = (languages[k] || 0) + v;

      const dir = prepareRepo(repo, token, scratch);
      const commits = gitLog(dir, repo.defaultBranch).filter((c) => {
        if (!c.subject) return true;
        if (c.subject.startsWith(STATS_SUBJECT)) return false;
        if (c.subject.includes("[org-stats]")) return false;
        return true;
      });
      const files = gitFiles(dir);
      filesByRepo[repo.name] = files;

      for (const commit of commits) {
        const login = resolveLogin(commit);
        const identityKey = login.toLocaleLowerCase("en-US");
        const bot = isBot({ login, email: commit.email, name: commit.name });
        if (bot) continue;
        totalCommits += 1;
        byDay[commit.date] = (byDay[commit.date] || 0) + 1;
        const rec = people.get(identityKey) || {
          login,
          commits: 0,
          repos: new Set(),
          lastDate: commit.date,
          email: commit.email,
        };
        rec.commits += 1;
        rec.repos.add(repo.name);
        if (commit.date > rec.lastDate) rec.lastDate = commit.date;
        people.set(identityKey, rec);
      }
    }

    const contributors = [...people.values()]
      .sort((a, b) => b.commits - a.commits || a.login.localeCompare(b.login))
      .map((c) => ({ ...c, repos: [...c.repos].sort() }));

    await Promise.all(
      contributors.slice(0, 12).map(async (c) => {
        let avatarUrl = "";
        try {
          const user = await ghApi(`/users/${encodeURIComponent(c.login)}`, token);
          avatarUrl = user.avatar_url || "";
          c.login = user.login || c.login;
        } catch {
          // keep resolved login
        }
        c.avatarData = await loadAvatar(c.login, avatarUrl);
      }),
    );

    const stamp = fmtStamp();
    const cacheBust = ymdInTz(new Date()).replaceAll("-", "");
    const totalBytes = Object.values(languages).reduce((s, n) => s + n, 0);
    const activeDays = Object.values(byDay).filter(Boolean).length;

    writeFileSync(join(STATS_DIR, "leaderboard.svg"), renderLeaderboard(contributors, stamp, repos.length));
    writeFileSync(
      join(STATS_DIR, "commits.svg"),
      renderCommits({ days: Object.keys(byDay).sort(), byDay, stamp, total: totalCommits, activeDays }),
    );
    writeFileSync(
      join(STATS_DIR, "genome.svg"),
      renderGenome({ languages, filesByRepo, stamp, totalBytes }),
    );
    writeFileSync(
      join(STATS_DIR, "latest.json"),
      `${JSON.stringify(
        {
          generatedAt: stamp,
          org,
          repos: repos.map((r) => r.fullName),
          totalCommits,
          contributors: contributors.map((c) => ({
            login: c.login,
            commits: c.commits,
            repos: c.repos,
            lastDate: c.lastDate,
          })),
          languages,
        },
        null,
        2,
      )}\n`,
    );
    patchReadme(stamp, cacheBust);
    console.log(`updated ${contributors.length} contributors, ${totalCommits} commits, ${repos.length} repos`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { gitLog, renderGenome };
