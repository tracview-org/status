// One health check: calls TRACVIEW_HEALTH_URL and probes the APIs, records
// each component's state, then opens or closes `incident` issues.
import { readFile, writeFile } from "node:fs/promises";

import {
  COMPONENTS,
  incidentMarker,
  incidentPlan,
  normalize,
  probeRequests,
  probeState,
  record,
  withProbes,
} from "./lib.mjs";

const TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;

const url = process.env.TRACVIEW_HEALTH_URL;
if (!url) {
  console.log("::warning::TRACVIEW_HEALTH_URL is not set; skipping the check.");
  process.exit(0);
}

const readJson = async (path, fallback) => JSON.parse(await readFile(path, "utf8").catch(() => JSON.stringify(fallback)));

let body = null;
try {
  // A 503 still carries the components, so the status code is not checked.
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  body = await res.json();
} catch (error) {
  console.log(`Health check failed, every component down: ${error.message}`);
}

const probes = Object.fromEntries(
  await Promise.all(
    probeRequests(url).map(async ({ key, method, url: probeUrl }) => {
      // No API key on purpose: a healthy API answers 401.
      const status = await fetch(probeUrl, { method, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
        .then((res) => res.status)
        .catch(() => null);
      console.log(`Probe ${method} ${probeUrl}: ${status ?? "no answer"}`);
      return [key, probeState(status)];
    }),
  ),
);

const now = new Date().toISOString();
const states = withProbes(normalize(body), probes);
const previous = (await readJson("data/current.json", null))?.components ?? null;
const daily = await readJson("data/daily.json", {});

await writeFile("data/daily.json", `${JSON.stringify(record(daily, now.slice(0, 10), states), null, 1)}\n`);
await writeFile("data/current.json", `${JSON.stringify({ checkedAt: now, components: states }, null, 2)}\n`);
console.log(states);

// A GitHub API failure must not cost the data commit or the page build.
await updateIncidents(previous, states).catch((error) => console.log(`::warning::Incidents not updated: ${error.message}`));

/** Opens and closes the checker's own `incident` issues; skipped without a token (local runs). */
async function updateIncidents(previous, current) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return;
  const api = async (path, init = {}) => {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed: ${res.status}`);
    return res.json();
  };
  const open = (await api("/issues?labels=incident&state=open&per_page=100")).filter((i) => !i.pull_request);
  const plan = incidentPlan({ previous, current, open });
  for (const key of plan.open) {
    const { label } = COMPONENTS.find((c) => c.key === key);
    const issue = await api("/issues", {
      method: "POST",
      body: JSON.stringify({
        title: `${label} is down`,
        labels: ["incident"],
        body: `${incidentMarker(key)}\nWe're investigating. Updates will follow here.`,
      }),
    });
    console.log(`Opened incident #${issue.number} for ${key}`);
  }
  for (const number of plan.close) {
    await api(`/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Resolved: the component is no longer down." }),
    });
    await api(`/issues/${number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
    console.log(`Closed incident #${number}`);
  }
}
