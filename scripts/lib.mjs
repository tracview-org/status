/** Components of TracView's `/api/health` `components` object (tracview-org/tracview#1856), flattened. */
export const COMPONENTS = [
  { key: "app", label: "App" },
  { key: "signIn", label: "Sign-in" },
  { key: "integrationsSync.salesforce", label: "Salesforce sync" },
  { key: "integrationsSync.hubspot", label: "HubSpot sync" },
  { key: "integrationsSync.zendesk", label: "Zendesk sync" },
  { key: "integrationsSync.gong", label: "Gong sync" },
  { key: "integrationsSync.jira", label: "Jira sync" },
  // Hidden until tracview-org/tracview's mailbox freshness fix is on production:
  // /api/health reads every Mailbox stale 2 h after its backfill. Still recorded.
  { key: "mailCollection", label: "Mail collection", hidden: true },
  { key: "emailSending", label: "Email sending" },
  { key: "eventsApi", label: "Events API" },
  { key: "publicApi", label: "Public API" },
];

export const STATES = ["operational", "degraded", "down"];

const worse = (a, b) => (STATES.indexOf(a) >= STATES.indexOf(b) ? a : b);

/**
 * Unauthenticated calls the API components must refuse with a 401
 * (tracview-org/tracview#2484). Anything else, a timeout included, is down.
 */
const PROBES = [
  { key: "eventsApi", method: "POST", path: "/api/v1/events" },
  { key: "publicApi", method: "GET", path: "/api/v1/customers" },
];

export const probeRequests = (healthUrl) =>
  PROBES.map(({ key, method, path }) => ({ key, method, url: new URL(path, healthUrl).href }));

/** A probe's state from its HTTP status; `null` is a timeout or network error. */
export const probeState = (status) => (status === 401 ? "operational" : "down");

/** Each probed component shows the worse of `/api/health`'s value and its probe. */
export function withProbes(states, probes) {
  const merged = { ...states };
  for (const [key, state] of Object.entries(probes)) merged[key] = worse(merged[key] ?? "operational", state);
  return merged;
}

/** Hidden marker on incidents the checker opened, so it only closes its own. */
export const incidentMarker = (key) => `<!-- status-check:${key} -->`;

/**
 * Incidents to open and close (tracview-org/tracview#2485): open when a
 * component reads `down` on two checks in a row and has no auto incident open;
 * close an auto incident once its component is no longer `down`. Incidents
 * opened by hand are never touched.
 */
export function incidentPlan({ previous, current, open }) {
  const auto = new Map();
  for (const issue of open)
    for (const { key } of COMPONENTS) if (issue.body?.includes(incidentMarker(key))) auto.set(key, issue.number);
  const plan = { open: [], close: [] };
  for (const { key, hidden } of COMPONENTS) {
    if (hidden) continue;
    if (current[key] === "down") {
      if (previous?.[key] === "down" && !auto.has(key)) plan.open.push(key);
    } else if (auto.has(key)) plan.close.push(auto.get(key));
  }
  return plan;
}

/** Days of history kept and shown. */
export const HISTORY_DAYS = 90;

/** Monthly uptime objective (not an SLA). */
export const TARGET = 99.9;

/**
 * One state per component from a parsed health body. A missing body (timeout,
 * non-JSON) or an unknown value reads `down`.
 */
export function normalize(body) {
  const states = {};
  for (const { key } of COMPONENTS) {
    const value = key
      .split(".")
      .reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), body?.components);
    states[key] = STATES.includes(value) ? value : "down";
  }
  return states;
}

/** Adds one check to the per-day counters, then drops days past the window. */
export function record(daily, date, states) {
  const next = structuredClone(daily);
  const day = (next[date] ??= {});
  for (const [key, state] of Object.entries(states)) {
    const counts = (day[key] ??= { operational: 0, degraded: 0, down: 0 });
    counts[state] += 1;
  }
  const oldest = shiftDate(date, -(HISTORY_DAYS - 1));
  for (const d of Object.keys(next)) if (d < oldest) delete next[d];
  return next;
}

/** Uptime percent over the given days; degraded counts as up. `null` without checks. */
export function uptime(daily, key, dates) {
  let total = 0;
  let down = 0;
  for (const d of dates) {
    const c = daily[d]?.[key];
    if (!c) continue;
    total += c.operational + c.degraded + c.down;
    down += c.down;
  }
  return total === 0 ? null : ((total - down) / total) * 100;
}

/** The worst state seen that day, or `null` without checks. */
export function dayState(daily, date, key) {
  const c = daily[date]?.[key];
  if (!c) return null;
  if (c.down) return "down";
  if (c.degraded) return "degraded";
  return "operational";
}

/** The last `n` UTC dates ending at `today`, oldest first. */
export function lastDates(today, n) {
  return Array.from({ length: n }, (_, i) => shiftDate(today, i - n + 1));
}

/** UTC dates of `today`'s month up to `today`. */
export function monthDates(today) {
  return lastDates(today, Number(today.slice(8, 10)));
}

export function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
