# Infrastructure Monitoring Platform

A self-hosted, multi-service infrastructure monitoring platform — built with Docker Compose, exposed to the public internet via Cloudflare Tunnel, and fully automated with CI/CD. Includes a reverse-proxied backend API, an uptime monitor with retry logic, a log analytics engine that parses live Nginx traffic, and a live dashboard tying it all together.

Built entirely on a local Windows/WSL environment, at zero infrastructure cost.

## Architecture

```
Internet (any device, any network)
        ↓ HTTPS
Cloudflare Tunnel (public entry point, zero inbound ports opened)
        ↓
Nginx (reverse proxy, single entry point on port 80)
    ├── /                → static dashboard + landing page
    ├── /api/            → Node.js backend service
    ├── /monitor/        → Uptime monitoring service
    └── /logs/           → Log analytics service
                                ↓
                          Postgres (persistent storage, Docker volume)
```

All services run as isolated containers, orchestrated via Docker Compose, and communicate over Docker's internal network using service names (not localhost).

## What it does

- **Reverse proxy layer** — Nginx routes all incoming traffic to the correct backend service based on URL path, and serves the dashboard directly.
- **Uptime monitoring** — a scheduled service (cron-based) checks a configurable list of URLs every 2 minutes, records response time and status, and retries failed checks before marking a site down (avoiding false positives from transient network blips).
- **Log analytics** — parses Nginx's real access logs in near real-time, storing structured request data (IP, method, path, status code) in Postgres, and exposes aggregation endpoints (top IPs, status code breakdown).
- **Live dashboard** — a single page pulling from all services' APIs, auto-refreshing every 15 seconds, showing uptime status, traffic patterns, and recent requests visually.
- **CI/CD** — every push to `main` automatically builds and publishes all four custom Docker images to Docker Hub via GitHub Actions.

## Tech Stack

**Infrastructure:** Docker, Docker Compose, Nginx, WSL (Ubuntu)
**Backend:** Node.js, Express
**Database:** PostgreSQL
**CI/CD:** GitHub Actions, Docker Hub
**Exposure:** Cloudflare Tunnel (public HTTPS, zero-cost, no inbound firewall rules)

## Challenges & How They Were Solved

This project surfaced a number of genuine infrastructure bugs, each diagnosed with evidence rather than guesswork:

1. **WSL network isolation.** Nginx was correctly configured and listening, but devices on the real WiFi network couldn't reach it. Diagnosed using `ip addr show` — WSL runs on its own private virtual network (172.x), invisible to the host's real network. Fixed with Windows-level port forwarding (`netsh interface portproxy`) bridging the two networks.

2. **Safe public exposure without opening the home router.** Rather than forwarding the actual router — a real security exposure — used Cloudflare Tunnel to create an outbound-only connection, gaining a public HTTPS URL with zero inbound ports opened and free TLS termination at the edge.

3. **Silent Nginx routing bug.** `/logs/` endpoints returned 404s despite correct-looking config. Root cause: a missing trailing slash in `proxy_pass` changes whether Nginx strips the location prefix before forwarding — `http://service:port/` strips it, `http://service:port` does not. Diagnosed by directly comparing the live container config against a working route.

4. **Log file symlink crash.** The log analytics service crashed with `ESPIPE: invalid seek` when trying to read Nginx's access log. Root cause: the official `nginx:alpine` image symlinks `access.log` to `/dev/stdout` by default (for `docker logs` visibility), making it an unseekable stream, not a real file. Fixed by removing the symlink in the Docker image — then discovered the fix didn't persist, because a named Docker volume retains its original content independently of image changes. Required removing the symlink from the live volume directly.

5. **Container network detachment after WSL restarts.** After extended downtime, `nginx-container` repeatedly failed with `host not found in upstream "backend"`, despite the backend running fine. Diagnosed via `docker inspect`, which revealed nginx-container's network list was completely empty (`"Networks": {}`) — a stale attachment from a prior session. Fixed with `docker compose up --force-recreate`.

6. **Port conflicts between native and containerized services.** The host's own `apt`-installed Nginx repeatedly competed with the Dockerized version for port 80 on every WSL restart. Diagnosed via `ss -tulpn` (process name `nginx` vs. the expected `docker-proxy`), and permanently resolved by disabling the native service's autostart (`systemctl disable nginx`).

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

This project is architected with production patterns (containerization, service isolation, persistent storage, CI/CD, retry logic) but is a portfolio/demo project, not a commercially deployed product. A real production deployment would additionally require:

- Compliance review for any real user data collected (e.g., IP logging under GDPR/DPDP)
- Managed database hosting with backups, rather than a local Docker volume
- Real infrastructure with uptime guarantees, replacing the Cloudflare quick-tunnel (which is explicitly not guaranteed for production use)
- Secrets management (environment variables/vault), rather than hardcoded credentials in `docker-compose.yml`
- Security audit / dependency scanning