# Infrastructure Monitoring Platform

A self-hosted, multi-service infrastructure monitoring platform — built with Docker Compose, deployed to the cloud, and fully automated with CI/CD. Includes a reverse-proxied backend API, an uptime monitor with retry logic, a log analytics engine, and a live dashboard tying it all together.

**🔗 Live demo:** https://nginx-proxy-jax8.onrender.com/dashboard.html

Originally built and debugged entirely on a local Windows/WSL environment, then migrated to a fully cloud-hosted deployment — at zero infrastructure cost.

## Architecture

Two deployment variants exist, documented honestly below, because they genuinely differ in one meaningful way.

### Cloud deployment (live demo)

```
Internet (any device, anytime — no dependency on any personal machine)
        ↓ HTTPS
Nginx (Render) — reverse proxy, single public entry point
    ├── /                → static dashboard
    ├── /api/            → Backend API (Render)
    ├── /monitor/        → Uptime monitor (Render)
    └── /logs/           → Log analytics (Render)
                                ↓
                          Postgres (Neon, permanent free tier)

Backend + Monitor  ──HTTP──▶  Log Analyzer  (/ingest endpoint)
   (app-level request logging — see "Design Decisions" below)

UptimeRobot pings all 4 services every 5 minutes to prevent
Render free-tier services from sleeping after 15 min of inactivity.
```

### Local deployment (Docker Compose)

```
Nginx (local) — reads its own access.log directly
    ↓
Log Analyzer — tails the real Nginx log file (shared Docker volume)
    ↓
Postgres (local container, persistent via Docker volume)
```

Both variants share the same core services; only the logging pipeline differs, for reasons explained below.

## What it does

- **Reverse proxy layer** — Nginx routes all incoming traffic to the correct backend service based on URL path, and serves the dashboard directly.
- **Uptime monitoring** — a scheduled service (cron-based) checks a configurable list of URLs every 2 minutes, records response time and status, and retries failed checks before marking a site down (avoiding false positives from transient network blips).
- **Log analytics** — records structured request data (IP, method, path, status code) in Postgres, and exposes aggregation endpoints (top IPs, status code breakdown).
- **Live dashboard** — a single page pulling from all services' APIs, auto-refreshing every 15 seconds, showing uptime status, traffic patterns, and recent requests visually.
- **CI/CD** — every push to `main` automatically builds and publishes all four custom Docker images to Docker Hub via GitHub Actions.

## Tech Stack

**Infrastructure:** Docker, Docker Compose, Nginx, WSL (Ubuntu)
**Cloud hosting:** Render (app services), Neon (managed Postgres)
**Backend:** Node.js, Express
**Database:** PostgreSQL
**CI/CD:** GitHub Actions, Docker Hub
**Uptime:** UptimeRobot (external keep-alive monitoring)
**Local exposure option:** Cloudflare Tunnel (public HTTPS, zero-cost, no inbound firewall rules)

## Design Decisions Worth Explaining

**Why two different logging mechanisms exist.** The local deployment has Nginx write real log files to disk, which the log-analyzer tails directly — the simplest, most complete approach, capturing every request including static files and unmatched routes. Render's free tier does not support shared filesystems between separate services, so this approach doesn't translate to the cloud. Rather than dropping log analytics from the cloud deployment, the backend and monitor services were given lightweight logging middleware that reports each request directly to the log-analyzer's `/ingest` endpoint over HTTP. This is arguably a more realistic pattern for a distributed system (services reporting their own telemetry, rather than a central process tailing another service's files) — the trade-off is that requests Nginx handles without reaching an app (like a 404 for an unmatched route) aren't captured in the cloud variant.

**Why UptimeRobot instead of GitHub Actions for keep-alive pinging.** Render's free tier spins down inactive services after 15 minutes. The first attempt at solving this used a GitHub Actions scheduled workflow (`cron: */14 * * * *`), but GitHub does not guarantee scheduled workflow timing — observed run intervals were 40–60+ minutes in practice, far exceeding Render's sleep threshold and making the fix ineffective. Switching to UptimeRobot (a tool purpose-built for reliable interval monitoring) resolved this correctly, with consistent 5-minute pings.

## Challenges & How They Were Solved

This project surfaced a number of genuine infrastructure bugs, each diagnosed with evidence rather than guesswork:

1. **WSL network isolation.** Nginx was correctly configured and listening, but devices on the real WiFi network couldn't reach it. Diagnosed using `ip addr show` — WSL runs on its own private virtual network (172.x), invisible to the host's real network. Fixed with Windows-level port forwarding (`netsh interface portproxy`) bridging the two networks.

2. **Safe public exposure without opening the home router.** Rather than forwarding the actual router — a real security exposure — used Cloudflare Tunnel to create an outbound-only connection, gaining a public HTTPS URL with zero inbound ports opened and free TLS termination at the edge.

3. **Silent Nginx routing bug.** `/logs/` endpoints returned 404s despite correct-looking config. Root cause: a missing trailing slash in `proxy_pass` changes whether Nginx strips the location prefix before forwarding — `http://service:port/` strips it, `http://service:port` does not. Diagnosed by directly comparing the live container config against a working route.

4. **Log file symlink crash.** The log analytics service crashed with `ESPIPE: invalid seek` when trying to read Nginx's access log. Root cause: the official `nginx:alpine` image symlinks `access.log` to `/dev/stdout` by default (for `docker logs` visibility), making it an unseekable stream, not a real file. Fixed by removing the symlink in the Docker image — then discovered the fix didn't persist, because a named Docker volume retains its original content independently of image changes. Required removing the symlink from the live volume directly.

5. **Container network detachment after WSL restarts.** After extended downtime, `nginx-container` repeatedly failed with `host not found in upstream "backend"`, despite the backend running fine. Diagnosed via `docker inspect`, which revealed nginx-container's network list was completely empty (`"Networks": {}`) — a stale attachment from a prior session. Fixed with `docker compose up --force-recreate`.

6. **Port conflicts between native and containerized services.** The host's own `apt`-installed Nginx repeatedly competed with the Dockerized version for port 80 on every WSL restart. Diagnosed via `ss -tulpn` (process name `nginx` vs. the expected `docker-proxy`), and permanently resolved by disabling the native service's autostart (`systemctl disable nginx`).

7. **`proxy_pass` path truncation when using a variable upstream.** After deploying to Render, `/api/status` requests reached the backend as just `/api/`, losing the rest of the path. Root cause: using a variable in `proxy_pass` (required for resolving external hostnames dynamically) disables Nginx's normal automatic path-append behavior. Fixed by explicitly forwarding `$request_uri`, or using `rewrite ... break` combined with `$uri` where prefix-stripping was needed.

8. **Cloud logging redesign under a real platform constraint.** The original file-tailing log analytics approach couldn't work on Render, since separate services don't share a filesystem. Resolved by redesigning the logging pipeline around direct HTTP reporting from each service — a genuine architecture change driven by a real deployment constraint, not just a config tweak.

9. **Unreliable scheduled pinging via GitHub Actions.** See "Design Decisions" above — GitHub Actions cron scheduling proved unreliable for sub-15-minute intervals in practice; replaced with UptimeRobot.

## Running Locally

**Requirements:** Docker & Docker Compose

```bash
git clone https://github.com/SANJEEV-1208/docker-nginx-reverse-proxy.git
cd docker-nginx-reverse-proxy
docker compose up -d --build
```

Visit `http://localhost/dashboard.html` for the live dashboard, or `http://localhost/monitor/sites` / `http://localhost/logs/` for raw API access.

**Pre-built images** are also available on Docker Hub and can be pulled directly:
```bash
docker pull sanjeev1208/nginx-proxy
docker pull sanjeev1208/backend-api
docker pull sanjeev1208/monitor-service
docker pull sanjeev1208/log-analyzer
```

## Production Considerations

This project is architected with production patterns (containerization, service isolation, persistent storage, CI/CD, retry logic, environment-based configuration) but is a portfolio/demo project, not a commercially deployed product. A real production deployment would additionally require:

- Compliance review for any real user data collected (e.g., IP logging under GDPR/DPDP)
- A paid hosting tier to eliminate free-tier cold starts entirely, rather than working around them
- Secrets management (a vault/secrets manager), rather than credentials pasted into a platform's environment variable UI
- Security audit / dependency scanning
- Capturing infrastructure-level events (e.g., Nginx-level 404s on unmatched routes) that the current app-level cloud logging approach does not see