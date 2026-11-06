// Renders site/index.html from data/ and the repo's open `incident` issues.
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { COMPONENTS, HISTORY_DAYS, TARGET, dayState, lastDates, monthDates, uptime } from "./lib.mjs";

const readJson = async (path, fallback) => JSON.parse(await readFile(path, "utf8").catch(() => JSON.stringify(fallback)));

const daily = await readJson("data/daily.json", {});
const current = await readJson("data/current.json", null);
const incidents = await openIncidents();

const today = new Date().toISOString().slice(0, 10);
const days = lastDates(today, HISTORY_DAYS);
const month = monthDates(today);

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const percent = (p) => (p === null ? "–" : `${p.toFixed(p === 100 ? 0 : 2)}%`);
const LABEL = { operational: "Operational", degraded: "Degraded", down: "Down" };

const states = COMPONENTS.map(({ key }) => current?.components?.[key] ?? null);
const overall = !current
  ? ["unknown", "No checks yet"]
  : states.includes("down")
    ? ["down", "Some systems are down"]
    : states.includes("degraded")
      ? ["degraded", "Some systems are degraded"]
      : ["operational", "All systems operational"];

const rows = COMPONENTS.map(({ key, label }, i) => {
  const state = states[i];
  const bars = days
    .map((d) => {
      const s = dayState(daily, d, key);
      const u = uptime(daily, key, [d]);
      return `<i class="${s ?? "none"}" title="${d}: ${s ? `${LABEL[s]}, ${percent(u)} up` : "no data"}"></i>`;
    })
    .join("");
  return `<section class="component">
  <div class="head"><h3>${escape(label)}</h3><span class="state ${state ?? "unknown"}">${state ? LABEL[state] : "No data"}</span></div>
  <div class="bars" role="img" aria-label="${escape(label)}: ${HISTORY_DAYS}-day history">${bars}</div>
  <div class="foot"><span><span class="wide">${HISTORY_DAYS}</span><span class="narrow">30</span> days ago</span><span>${percent(uptime(daily, key, days))} uptime · ${percent(uptime(daily, key, month))} this month</span><span>Today</span></div>
</section>`;
}).join("\n");

const incidentList = incidents.length
  ? `<section class="incidents"><h2>Open incidents</h2>${incidents
      .map(
        (i) => `<article><h3><a href="${escape(i.html_url)}">${escape(i.title)}</a></h3><p class="meta">Opened ${escape(i.created_at.slice(0, 16).replace("T", " "))} UTC</p>${i.body ? `<p>${escape(i.body).replace(/\n/g, "<br>")}</p>` : ""}</article>`,
      )
      .join("")}</section>`
  : "";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TracView Status</title>
<meta name="description" content="Current status and uptime of TracView.">
<style>
:root { --bg:#fff; --fg:#111; --muted:#666; --line:#e5e5e5; --none:#e5e5e5; --ok:#1f9d55; --warn:#d69e2e; --bad:#e53e3e; }
@media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#eee; --muted:#999; --line:#2a2a2a; --none:#2a2a2a; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; }
main { max-width:760px; margin:0 auto; padding:32px 16px 48px; }
h1 { font-size:22px; margin:0 0 24px; } h2 { font-size:17px; } h3 { font-size:15px; margin:0; }
a { color:inherit; }
.banner { padding:14px 16px; border-radius:8px; color:#fff; font-weight:600; margin-bottom:24px; }
.banner.operational { background:var(--ok); } .banner.degraded { background:var(--warn); } .banner.down { background:var(--bad); } .banner.unknown { background:var(--muted); }
.component { border-bottom:1px solid var(--line); padding:16px 0; }
.head, .foot { display:flex; justify-content:space-between; gap:8px; }
.foot { color:var(--muted); font-size:12px; margin-top:6px; }
.foot > span:first-child, .foot > span:last-child { flex:none; }
.state.operational { color:var(--ok); } .state.degraded { color:var(--warn); } .state.down { color:var(--bad); } .state.unknown { color:var(--muted); }
.bars { display:flex; gap:2px; margin-top:10px; height:28px; }
.bars i { flex:1; border-radius:2px; background:var(--none); }
.bars i.operational { background:var(--ok); } .bars i.degraded { background:var(--warn); } .bars i.down { background:var(--bad); }
@media (max-width:520px) { .bars i:nth-child(-n+60) { display:none; } .wide { display:none; } }
@media (min-width:521px) { .narrow { display:none; } }
.incidents article { border:1px solid var(--line); border-left:4px solid var(--bad); border-radius:6px; padding:12px 14px; margin-bottom:12px; }
.meta, footer { color:var(--muted); font-size:13px; }
footer { margin-top:32px; }
</style>
</head>
<body>
<main>
<h1>TracView Status</h1>
<div class="banner ${overall[0]}">${overall[1]}</div>
${incidentList}
${rows}
<footer>
<p>Our objective is ${TARGET}% monthly uptime for each component. This is an objective, not an SLA. Degraded time counts as up.</p>
<p>${current ? `Last checked ${escape(current.checkedAt.slice(0, 16).replace("T", " "))} UTC, every 5 minutes.` : "Checks every 5 minutes."}</p>
</footer>
</main>
</body>
</html>
`;

await mkdir("site", { recursive: true });
await writeFile("site/index.html", html);
console.log(`Built site/index.html (${incidents.length} open incidents).`);

/** Open issues labelled `incident`; none when there's no token (local builds). */
async function openIncidents() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return [];
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues?labels=incident&state=open&per_page=50`, {
    headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`Listing incidents failed: ${res.status}`);
  return (await res.json()).filter((i) => !i.pull_request);
}
