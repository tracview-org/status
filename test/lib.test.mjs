import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPONENTS, dayState, lastDates, monthDates, normalize, record, uptime } from "../scripts/lib.mjs";

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
