import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COMPONENTS,
  dayState,
  incidentMarker,
  incidentPlan,
  lastDates,
  monthDates,
  normalize,
  probeRequests,
  probeState,
  record,
  uptime,
  withProbes,
} from "../scripts/lib.mjs";

const healthy = {
  status: "ok",
  components: {
    app: "operational",
    signIn: "operational",
    integrationsSync: { salesforce: "operational", hubspot: "degraded", zendesk: "operational" },
    emailSending: "operational",
    eventsApi: "operational",
    publicApi: "operational",
  },
};

test("normalize flattens every component, nested sync providers included", () => {
  const states = normalize(healthy);
  assert.deepEqual(Object.keys(states), COMPONENTS.map((c) => c.key));
  assert.equal(states["integrationsSync.hubspot"], "degraded");
  assert.equal(states.app, "operational");
});

test("normalize reads a missing body (timeout, non-JSON) as every component down", () => {
  assert.ok(Object.values(normalize(null)).every((s) => s === "down"));
  assert.ok(Object.values(normalize({ status: "ok" })).every((s) => s === "down"));
});

test("normalize reads an unknown value as down", () => {
  assert.equal(normalize({ components: { ...healthy.components, signIn: "maybe" } }).signIn, "down");
});

test("record counts per day and keeps only 90 days", () => {
  let daily = {};
  daily = record(daily, "2026-01-01", { app: "operational" });
  daily = record(daily, "2026-01-01", { app: "down" });
  assert.deepEqual(daily["2026-01-01"].app, { operational: 1, degraded: 0, down: 1 });
  daily = record(daily, "2026-03-31", { app: "operational" }); // day 90 counting 01-01
  assert.ok(daily["2026-01-01"]);
  daily = record(daily, "2026-04-01", { app: "operational" });
  assert.equal(daily["2026-01-01"], undefined);
});

test("uptime counts degraded as up, and is null without checks", () => {
  const daily = { "2026-01-01": { app: { operational: 997, degraded: 2, down: 1 } } };
  assert.equal(uptime(daily, "app", ["2026-01-01"]), 99.9);
  assert.equal(uptime(daily, "app", ["2026-01-02"]), null);
});

test("dayState is the worst state seen that day", () => {
  const daily = { d: { a: { operational: 5, degraded: 1, down: 0 }, b: { operational: 5, degraded: 1, down: 1 } } };
  assert.equal(dayState(daily, "d", "a"), "degraded");
  assert.equal(dayState(daily, "d", "b"), "down");
  assert.equal(dayState(daily, "x", "a"), null);
});

test("date windows", () => {
  assert.deepEqual(lastDates("2026-03-01", 3), ["2026-02-27", "2026-02-28", "2026-03-01"]);
  assert.deepEqual(monthDates("2026-11-03"), ["2026-11-01", "2026-11-02", "2026-11-03"]);
});

test("components include Gong, Jira and mail collection", () => {
  const keys = COMPONENTS.map((c) => c.key);
  for (const k of ["integrationsSync.gong", "integrationsSync.jira", "mailCollection"]) assert.ok(keys.includes(k), k);
  const states = normalize({
    components: { ...healthy.components, integrationsSync: { ...healthy.components.integrationsSync, gong: "degraded", jira: "operational" }, mailCollection: "down" },
  });
  assert.equal(states["integrationsSync.gong"], "degraded");
  assert.equal(states.mailCollection, "down");
});

test("a probe is operational only on a 401", () => {
  assert.equal(probeState(401), "operational");
  for (const s of [200, 403, 429, 500, 503, null]) assert.equal(probeState(s), "down", String(s));
});

test("probes target the health URL's origin without a key", () => {
  assert.deepEqual(
    probeRequests("https://www.tracview.io/api/health").map((p) => [p.key, p.method, p.url]),
    [
      ["eventsApi", "POST", "https://www.tracview.io/api/v1/events"],
      ["publicApi", "GET", "https://www.tracview.io/api/v1/customers"],
    ],
  );
});

test("withProbes shows the worse of the health component and its probe", () => {
  const states = normalize(healthy);
  const merged = withProbes(states, { eventsApi: "down", publicApi: "operational" });
  assert.equal(merged.eventsApi, "down");
  assert.equal(merged.publicApi, "operational");
  assert.equal(withProbes({ ...states, publicApi: "degraded" }, { publicApi: "operational" }).publicApi, "degraded");
  assert.equal(states.eventsApi, "operational", "input untouched");
});

const auto = (key, number) => ({ number, body: `${incidentMarker(key)}\nfounder text` });

test("an incident opens after two down checks in a row, once", () => {
  const prev = { app: "down", signIn: "operational" };
  const now = { app: "down", signIn: "down" };
  assert.deepEqual(incidentPlan({ previous: prev, current: now, open: [] }), { open: ["app"], close: [] });
  assert.deepEqual(incidentPlan({ previous: prev, current: now, open: [auto("app", 7)] }), { open: [], close: [] });
  assert.deepEqual(incidentPlan({ previous: null, current: now, open: [] }), { open: [], close: [] });
});

test("an auto-opened incident closes on recovery; hand-opened ones stay", () => {
  const open = [auto("app", 7), { number: 8, body: "Degraded sync, opened by hand" }];
  assert.deepEqual(incidentPlan({ previous: { app: "down" }, current: { app: "degraded" }, open }), { open: [], close: [7] });
  assert.deepEqual(incidentPlan({ previous: { app: "down" }, current: { app: "down" }, open }), { open: [], close: [] });
});

test("a hidden component never opens an incident", () => {
  assert.ok(COMPONENTS.find((c) => c.key === "mailCollection").hidden);
  const plan = incidentPlan({ previous: { mailCollection: "down" }, current: { mailCollection: "down" }, open: [] });
  assert.deepEqual(plan, { open: [], close: [] });
});
