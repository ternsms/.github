import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gitLog, renderGenome } from "./update-org-stats.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATS_DIR = join(ROOT, "profile", "stats");

function geometryOutsideViewBox(svg) {
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(viewBox, "SVG must define a numeric viewBox");
  const width = Number(viewBox[1]);
  const height = Number(viewBox[2]);
  const points = [];

  for (const tag of svg.matchAll(/<(?:rect|image)\b[^>]*>/g)) {
    const x = Number(tag[0].match(/\bx="([\d.-]+)"/)?.[1] || 0);
    const y = Number(tag[0].match(/\by="([\d.-]+)"/)?.[1] || 0);
    const w = Number(tag[0].match(/\bwidth="([\d.]+)"/)?.[1] || 0);
    const h = Number(tag[0].match(/\bheight="([\d.]+)"/)?.[1] || 0);
    points.push([x, y], [x + w, y + h]);
  }

  for (const tag of svg.matchAll(/<polygon\b[^>]*\bpoints="([^"]+)"/g)) {
    for (const pair of tag[1].trim().split(/\s+/)) points.push(pair.split(",").map(Number));
  }

  for (const tag of svg.matchAll(/<(?:circle|line)\b[^>]*>/g)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/\b(cx|cy|r|x1|x2|y1|y2)="([\d.-]+)"/g)].map((m) => [m[1], Number(m[2])]));
    if ("cx" in attrs) points.push([attrs.cx - attrs.r, attrs.cy - attrs.r], [attrs.cx + attrs.r, attrs.cy + attrs.r]);
    if ("x1" in attrs) points.push([attrs.x1, attrs.y1], [attrs.x2, attrs.y2]);
  }

  return points.filter(([x, y]) => x < 0 || x > width || y < 0 || y > height);
}

test("gitLog scans only the requested default branch", () => {
  const repo = mkdtempSync(join(tmpdir(), "org-stats-test-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });

  try {
    git("init", "-b", "main");
    git("config", "user.name", "Stats Test");
    git("config", "user.email", "stats@example.com");
    writeFileSync(join(repo, "main.txt"), "main\n");
    git("add", "main.txt");
    git("commit", "-m", "main commit");
    git("switch", "-c", "topic");
    writeFileSync(join(repo, "topic.txt"), "topic\n");
    git("add", "topic.txt");
    git("commit", "-m", "topic commit");

    assert.equal(gitLog(repo, "main").length, 1);
    git("update-ref", "refs/remotes/origin/main", "refs/heads/main");
    git("branch", "-D", "main");
    assert.equal(gitLog(repo, "main").length, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("genome expands to contain long language legends", () => {
  const languages = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`Language${i + 1}`, 100 - i]));
  const svg = renderGenome({ languages, filesByRepo: {}, stamp: "test", totalBytes: 1647 });

  assert.deepEqual(geometryOutsideViewBox(svg), []);
});

test("contributors are unique regardless of GitHub login casing", () => {
  const stats = JSON.parse(readFileSync(join(STATS_DIR, "latest.json"), "utf8"));
  const keys = stats.contributors.map(({ login }) => login.toLocaleLowerCase("en-US"));

  assert.equal(new Set(keys).size, keys.length, `duplicate contributor identities: ${keys.join(", ")}`);
});

test("stats include every repository required by the workflow", () => {
  const stats = JSON.parse(readFileSync(join(STATS_DIR, "latest.json"), "utf8"));
  const required = (process.env.REQUIRED_REPOS || "ternsms/sms,ternsms/.github").split(",").filter(Boolean);

  for (const repo of required) {
    assert.ok(stats.repos.includes(repo), `required repository missing from stats: ${repo}`);
  }
  assert.ok(stats.contributors.some(({ repos }) => repos.includes(".github")), "profile repository commits missing from stats");
});

test("generated SVG geometry stays inside each viewBox", () => {
  for (const name of ["leaderboard.svg", "commits.svg", "genome.svg"]) {
    const svg = readFileSync(join(STATS_DIR, name), "utf8");
    const outside = geometryOutsideViewBox(svg);
    assert.equal(outside.length, 0, `${name} geometry outside viewBox: ${JSON.stringify(outside.slice(0, 8))}`);
  }
});

test("generated SVG assets do not contain trailing whitespace", () => {
  for (const name of ["leaderboard.svg", "commits.svg", "genome.svg"]) {
    const svg = readFileSync(join(STATS_DIR, name), "utf8");
    const lines = svg.split(/\r?\n/).filter((line) => /[ \t]+$/.test(line));
    assert.equal(lines.length, 0, `${name} contains ${lines.length} line(s) with trailing whitespace`);
    assert.doesNotMatch(svg, /<(?:linearGradient|polygon|path)\b/, `${name} contains decorative geometry`);
  }
});

test("README stats section stays free of decorative table wrappers", () => {
  const readme = readFileSync(join(ROOT, "profile", "README.md"), "utf8");
  const section = readme.match(/<!-- org-stats:start -->([\s\S]*?)<!-- org-stats:end -->/)?.[1] || "";

  assert.doesNotMatch(section, /<table>|<strong>/);
  assert.equal((section.match(/<img\b/g) || []).length, 3);
});
