<p align="center">
  <h1 align="center">🐦 Tern</h1>
  <p align="center"><strong>International A2P SMS, done right.</strong></p>
</p>

---

Tern is a cloud-native messaging platform built for **international SMS delivery** — named after the Arctic tern, the bird that flies the longest international routes on Earth and never stays home.

## What we build

A full-stack A2P SMS gateway and delivery platform:

- **📡 Standard protocols** — SMPP 3.4 and HTTP/JSON APIs for submitting traffic, with real-time DLR (delivery receipt) forwarding back to customers.
- **🧭 Intelligent routing** — multi-supplier routing with per-country/per-operator policies, failover, and cost-aware selection.
- **🧹 Traffic quality** — number validation and list hygiene before anything hits the wire, so budgets go to reachable handsets.
- **💰 Transparent billing** — prepaid wallet with submit-time charging and a full auditable ledger.
- **📊 Observability** — delivery, latency, and per-route quality metrics for both customers and operations.

## Architecture

Go microservices on **[go-zero](https://github.com/zeromicro/go-zero)**, with PostgreSQL for state, Redis for hot-path data, and ClickHouse for analytics at scale. Services communicate over zRPC; the edge speaks SMPP and HTTP.

## Status

🚧 Early days — we're heads-down building V1. Watch this space.

---

<p align="center"><sub>Sterna paradisaea — pole to pole, every year.</sub></p>
