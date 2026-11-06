// One health check: calls TRACVIEW_HEALTH_URL, records each component's state.
import { readFile, writeFile } from "node:fs/promises";

import { normalize, record } from "./lib.mjs";

const TIMEOUT_MS = 15_000;

const url = process.env.TRACVIEW_HEALTH_URL;
if (!url) {
  console.log("::warning::TRACVIEW_HEALTH_URL is not set; skipping the check.");
  process.exit(0);
}

let body = null;
try {
  // A 503 still carries the components, so the status code is not checked.
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  body = await res.json();
} catch (error) {
  console.log(`Health check failed, every component down: ${error.message}`);
}

const now = new Date().toISOString();
const states = normalize(body);
const daily = JSON.parse(await readFile("data/daily.json", "utf8").catch(() => "{}"));

await writeFile("data/daily.json", `${JSON.stringify(record(daily, now.slice(0, 10), states), null, 1)}\n`);
await writeFile("data/current.json", `${JSON.stringify({ checkedAt: now, components: states }, null, 2)}\n`);
console.log(states);
