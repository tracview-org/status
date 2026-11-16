# TracView Status

Public status page for TracView. Every 5 minutes a GitHub Actions workflow calls TracView's `/api/health`, probes the APIs, records each component's state in `data/`, and publishes a static page to GitHub Pages. History is committed here, so the page stays up when TracView is down.

Design: tracview-org/tracview#1568, #1856, #2306, #2484, #2485.

## How it works

- `scripts/check.mjs` calls `TRACVIEW_HEALTH_URL` and reads `components` (`app`, `signIn`, `integrationsSync.{salesforce,hubspot,zendesk,gong,jira}`, `mailCollection`, `emailSending`, `eventsApi`, `publicApi`). A timeout or non-JSON response reads every component `down`; an unknown value reads `down`. A 503 still has components, so they are read as given.
- It also calls `POST /api/v1/events` and `GET /api/v1/customers` on the same origin with no API key. A healthy API answers 401 within 5 s; anything else is `down`. Events API and Public API show the worse of that probe and the health value.
- `data/daily.json` keeps per-day counts of `operational` / `degraded` / `down` checks for each component, 90 days. `data/current.json` is the latest check.
- `scripts/build.mjs` renders `site/index.html`: current state, 90-day bars, 90-day and this-month uptime, and the 99.9% monthly uptime objective (not an SLA). Degraded time counts as up.
- **Incidents** are issues in this repo labelled `incident`. Open ones show at the top of the page. Opening, editing, labelling or closing one rebuilds the page.
  - The checker opens one ("<Component> is down") when a component reads `down` on 2 checks in a row, and comments and closes it once the component recovers. Edit its body to tell customers what's happening; the hidden `status-check` marker in it must stay.
  - `degraded` incidents, and any others, are opened by hand; the checker never touches those.

The page doesn't page anyone. Alerting is the Route 53 health check and CloudWatch alarms in `tracview-org/tracview` (`infra/modules/monitoring`, on-call runbook `docs/runbooks/on-call.md`).

## Setup

1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → Variables: `TRACVIEW_HEALTH_URL=https://www.tracview.io/api/health`. Until it's set, the check is skipped and the page reads "No checks yet".
3. Create an `incident` label.
4. Custom domain: add `CNAME status` → `tracview-org.github.io` at the DNS host, set the custom domain `status.tracview.io` in Pages, and enforce HTTPS.

## Local

```bash
npm test
TRACVIEW_HEALTH_URL=https://staging.tracview.io/api/health npm run check
npm run build   # writes site/index.html
```
