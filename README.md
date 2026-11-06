# TracView Status

Public status page for TracView. Every 5 minutes a GitHub Actions workflow calls TracView's `/api/health`, records each component's state in `data/`, and publishes a static page to GitHub Pages. History is committed here, so the page stays up when TracView is down.

Design: tracview-org/tracview#1568, #1856, #2306.

## How it works

- `scripts/check.mjs` calls `TRACVIEW_HEALTH_URL` and reads `components` (`app`, `signIn`, `integrationsSync.{salesforce,hubspot,zendesk}`, `emailSending`, `eventsApi`, `publicApi`). A timeout, non-JSON response, or unknown value counts as `down`. A 503 still has components, so they are read as given.
- `data/daily.json` keeps per-day counts of `operational` / `degraded` / `down` checks for each component, 90 days. `data/current.json` is the latest check.
- `scripts/build.mjs` renders `site/index.html`: current state, 90-day bars, 90-day and this-month uptime, and the 99.9% monthly uptime objective (not an SLA). Degraded time counts as up.
- **Incidents** are issues in this repo labelled `incident`. Open ones show at the top of the page. Opening, editing, labelling or closing one rebuilds the page.

The page doesn't alert anyone; alerting is the Sentry uptime monitor on the same URL.

## Setup

1. Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → Variables: `TRACVIEW_HEALTH_URL=https://staging.tracview.io/api/health`. Until it's set, the check is skipped and the page reads "No checks yet".
3. Create an `incident` label.
4. At production launch (#1858): point `TRACVIEW_HEALTH_URL` at `https://www.tracview.io/api/health`, add `CNAME status` → `tracview-org.github.io` at the DNS host, set the custom domain `status.tracview.io` in Pages, and enforce HTTPS.

## Local

```bash
npm test
TRACVIEW_HEALTH_URL=https://staging.tracview.io/api/health npm run check
npm run build   # writes site/index.html
```
