"""Render the deck-matchup page from the notebook's dataframes.

Usage from the notebook:

    from viz import write_matchup_page
    write_matchup_page(matchup_df, deck_summary, standings_df, tournaments_df)

Produces a single self-contained HTML file - no network, no build step. Re-run it
after any fetch and the page reflects the new sample.
"""
import json
from pathlib import Path

TOP_N = 16          # decks shown in the matrix; past ~16 the cells get too thin to read


def _labels(standings_df):
    """Prettiest available display name per deck id, falling back to the id."""
    named = standings_df.dropna(subset=["deckId"])
    if named.empty or "deckName" not in named:
        return {}
    return (named.groupby("deckId")["deckName"]
            .agg(lambda s: s.mode().iat[0] if not s.mode().empty else s.iat[0])
            .to_dict())


def write_matchup_page(matchup_df, deck_summary, standings_df, tournaments_df,
                       path="matchup_matrix.html", top_n=TOP_N):
    """Write the matchup matrix page and return its Path."""
    if matchup_df.empty:
        raise ValueError("matchup_df is empty - nothing to visualise")

    labels = _labels(standings_df)
    top = deck_summary.head(top_n)["deck"].tolist()
    decks = deck_summary[deck_summary["deck"].isin(top)]
    cells = matchup_df[matchup_df["deck"].isin(top) & matchup_df["opponent"].isin(top)]

    payload = {
        "meta": {
            "tournaments": int(tournaments_df["id"].nunique()),
            "date_min": str(tournaments_df["date"].min()),
            "date_max": str(tournaments_df["date"].max()),
            "matches": int(matchup_df["games"].sum() // 2),
            "entries": int(len(standings_df)),
            "decks_total": int(matchup_df["deck"].nunique()),
        },
        "decks": [
            {"id": r.deck, "label": labels.get(r.deck, r.deck), "games": int(r.games),
             "winrate": float(r.winrate), "ci_low": float(r.ci_low), "ci_high": float(r.ci_high),
             "share": float(getattr(r, "meta_share", 0) or 0)}
            for r in decks.itertuples()
        ],
        "cells": [
            {"d": r.deck, "o": r.opponent, "n": int(r.games), "w": float(r.winrate),
             "lo": float(r.ci_low), "hi": float(r.ci_high)}
            for r in cells.itertuples()
        ],
    }
    lo = min(d["ci_low"] for d in payload["decks"])
    hi = max(d["ci_high"] for d in payload["decks"])
    payload["domain"] = [min(0.40, lo - 0.01), max(0.60, hi + 0.01)]

    html = _TEMPLATE.replace("/*__DATA__*/", json.dumps(payload))
    out = Path(path)
    out.write_text(html, encoding="utf-8")
    print(f"Wrote {out.resolve()} - {len(payload['decks'])} decks, "
          f"{len(payload['cells'])} matchup cells, {payload['meta']['matches']:,} matches")
    return out


_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deck matchup winrates &mdash; Limitless TCG</title>
<style>
:root { color-scheme: light dark; }
.viz-root{
  color-scheme: light;
  --surface-1:#fcfcfb; --plane:#f9f9f7;
  --text-primary:#0b0b0b; --text-secondary:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,0.10);
  --neutral:#f0efec;
  --d3:#e4857e; --d2:#f1aea8; --d1:#fad6d2;
  --u1:#cde2fb; --u2:#9ec5f4; --u3:#6da7ec;
  --ink-on-light:#0b0b0b; --ink-on-dark:#ffffff;
  --thin-bg:#f4f3f0;
}
@media (prefers-color-scheme: dark){
  :root:where(:not([data-theme="light"])) .viz-root{
    color-scheme: dark;
    --surface-1:#1a1a19; --plane:#0d0d0d;
    --text-primary:#ffffff; --text-secondary:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
    --neutral:#383835;
    --d3:#d75853; --d2:#b13f3c; --d1:#9e3432;
    --u1:#1c5cab; --u2:#256abf; --u3:#3987e5;
    --thin-bg:#232322;
  }
}
:root[data-theme="dark"] .viz-root{
  color-scheme: dark;
  --surface-1:#1a1a19; --plane:#0d0d0d;
  --text-primary:#ffffff; --text-secondary:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
  --neutral:#383835;
  --d3:#d75853; --d2:#b13f3c; --d1:#9e3432;
  --u1:#1c5cab; --u2:#256abf; --u3:#3987e5;
  --thin-bg:#232322;
}

*{box-sizing:border-box;}
body{margin:0; background:var(--plane,#f9f9f7);}
.wrap{
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background:var(--plane); color:var(--text-primary);
  padding:40px 24px 64px; max-width:1180px; margin:0 auto;
  -webkit-font-smoothing:antialiased;
}
h1{font-size:28px; line-height:1.2; margin:0 0 8px; font-weight:640; letter-spacing:-0.01em;}
h2{font-size:16px; margin:0 0 4px; font-weight:620;}
.sub{margin:0 0 10px; color:var(--text-secondary); font-size:15px; line-height:1.5; max-width:70ch;}
.meta{margin:0; color:var(--muted); font-size:13px;}
.page-head{margin-bottom:28px;}

.tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:24px;}
.tile{background:var(--surface-1); border:1px solid var(--border); border-radius:10px; padding:14px 16px;
      display:flex; flex-direction:column; gap:2px;}
.tile-v{font-size:26px; font-weight:640; letter-spacing:-0.02em;}
.tile-l{font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;}

.controls{display:flex; flex-wrap:wrap; gap:12px; align-items:end; margin-bottom:16px;}
.ctl{display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--muted);
     text-transform:uppercase; letter-spacing:0.04em;}
.ctl select{font:inherit; font-size:14px; text-transform:none; letter-spacing:0;
  color:var(--text-primary); background:var(--surface-1); border:1px solid var(--axis);
  border-radius:8px; padding:7px 10px; min-height:36px;}
.seg{display:flex; margin-left:auto; border:1px solid var(--axis); border-radius:8px; overflow:hidden;}
.seg button{font:inherit; font-size:14px; padding:8px 16px; min-height:36px; border:0; cursor:pointer;
  background:var(--surface-1); color:var(--text-secondary);}
.seg button[aria-selected="true"]{background:var(--text-primary); color:var(--surface-1); font-weight:560;}

.card{background:var(--surface-1); border:1px solid var(--border); border-radius:12px;
      padding:20px; margin-bottom:20px;}
.card-head{margin-bottom:16px;}
.card-sub{margin:0; color:var(--text-secondary); font-size:13px; line-height:1.5; max-width:78ch;}
.hidden{display:none;}
.scroll-x{overflow-x:auto; padding-bottom:4px;}

.legend{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:18px; font-size:12px; color:var(--muted);}
.legend-scale{display:flex; gap:2px;}
.legend-scale i{width:32px; height:12px; border-radius:2px; display:block;
  box-shadow:inset 0 0 0 1px var(--border);}
.legend-end{white-space:nowrap;}
.legend-sep{width:1px; height:16px; background:var(--grid);}
.legend-thin{display:flex; align-items:center; gap:6px;}
.sw-thin{width:14px; height:12px; border-radius:2px; background:var(--thin-bg);
         border:1px solid var(--grid); display:block;}

.matrix{display:grid; gap:2px; width:max-content;}
.corner{background:transparent;}
.col-head{writing-mode:vertical-rl; transform:rotate(180deg); font-size:12px; color:var(--text-secondary);
  padding:6px 0; text-align:right; line-height:1.15; height:112px; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; max-height:112px;}
.row-head{font-size:13px; color:var(--text-primary); padding-right:10px; text-align:right;
  display:flex; align-items:center; justify-content:flex-end; gap:8px; white-space:nowrap;
  max-width:178px; overflow:hidden;}
.row-head .lbl{overflow:hidden; text-overflow:ellipsis;}
.row-head .n{color:var(--muted); font-size:11px; font-variant-numeric:tabular-nums;}
.cell{border:0; padding:0; font:inherit; cursor:default; border-radius:3px; height:38px; width:52px;
  display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:560;
  font-variant-numeric:tabular-nums; background:var(--neutral); color:var(--text-primary);}
.cell:focus-visible{outline:2px solid var(--text-primary); outline-offset:2px;}
.cell.diag{background:transparent; color:var(--muted); font-weight:400;}
.cell.thin{background:var(--thin-bg); color:var(--muted); font-weight:400;}

.summary{display:grid; gap:2px; width:max-content; min-width:100%;}
.srow{display:grid; grid-template-columns:190px 1fr 64px 74px; align-items:center; gap:12px; height:30px;}
.sname{font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.strack{position:relative; height:22px; min-width:260px;}
.scentre{position:absolute; top:-2px; bottom:-2px; width:1px; background:var(--axis);}
.sbar{position:absolute; top:6px; height:10px; border-radius:3px;}
.sci{position:absolute; top:10px; height:2px; background:var(--text-secondary); opacity:.55;}
.sci::before,.sci::after{content:""; position:absolute; top:-3px; width:2px; height:8px; background:var(--text-secondary);}
.sci::before{left:0;} .sci::after{right:0;}
.sval{font-size:13px; font-variant-numeric:tabular-nums; text-align:right;}
.sshare{font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; text-align:right;}
.saxis{display:grid; grid-template-columns:190px 1fr 64px 74px; gap:12px; margin-top:6px; font-size:11px; color:var(--muted);}
.saxis .ticks{position:relative; height:14px; min-width:260px;}
.saxis .ticks span{position:absolute; transform:translateX(-50%); font-variant-numeric:tabular-nums;}
.shead{display:grid; grid-template-columns:190px 1fr 64px 74px; gap:12px; font-size:11px; color:var(--muted);
  text-transform:uppercase; letter-spacing:0.04em; margin-bottom:8px;}
.shead .r{text-align:right;}

table{border-collapse:collapse; width:100%; font-size:13px;}
th,td{text-align:left; padding:7px 12px 7px 0; border-bottom:1px solid var(--grid); white-space:nowrap;}
th{font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted); font-weight:600;}
td.num,th.num{text-align:right; font-variant-numeric:tabular-nums;}
tbody tr:hover{background:var(--thin-bg);}

.notes ul{margin:0; padding-left:18px; color:var(--text-secondary); font-size:13px; line-height:1.65;}
.notes li{margin-bottom:5px;}
.notes b{color:var(--text-primary); font-weight:600;}
.foot{color:var(--muted); font-size:12px; line-height:1.6; margin-top:8px;}

.tip{position:fixed; pointer-events:none; opacity:0; transition:opacity .1s; z-index:50;
  background:var(--text-primary); color:var(--surface-1); border-radius:8px; padding:9px 11px;
  font-size:12px; line-height:1.5; max-width:250px; box-shadow:0 4px 16px rgba(0,0,0,.18);}
.tip.on{opacity:1;}
.tip b{font-weight:640;} .tip .dim{opacity:.72;}

@media (max-width:640px){
  .wrap{padding:24px 14px 48px;}
  h1{font-size:23px;}
  .srow,.saxis,.shead{grid-template-columns:130px 1fr 56px 62px;}
}
</style>
</head>
<body>

<div class="wrap viz-root">

<header class="page-head">
  <h1>Deck matchup winrates</h1>
  <p class="sub">Every deck against every other deck, from Limitless TCG tournament pairings.
     Each cell is the row deck&rsquo;s winrate against the column deck.</p>
  <p class="meta" id="metaLine"></p>
</header>

<section class="tiles" aria-label="Sample summary">
  <div class="tile"><span class="tile-v" id="tMatches"></span><span class="tile-l">matches</span></div>
  <div class="tile"><span class="tile-v" id="tTours"></span><span class="tile-l">tournaments</span></div>
  <div class="tile"><span class="tile-v" id="tEntries"></span><span class="tile-l">player entries</span></div>
  <div class="tile"><span class="tile-v" id="tDecks"></span><span class="tile-l">decks shown</span></div>
</section>

<div class="controls" role="group" aria-label="View controls">
  <label class="ctl">Order
    <select id="sortBy">
      <option value="games">Most played</option>
      <option value="winrate">Best overall winrate</option>
      <option value="label">Name (A&ndash;Z)</option>
    </select>
  </label>
  <label class="ctl">Minimum games
    <select id="minGames">
      <option value="0">Show all</option>
      <option value="10">10+</option>
      <option value="20" selected>20+</option>
      <option value="30">30+</option>
    </select>
  </label>
  <div class="seg" role="tablist" aria-label="View">
    <button role="tab" id="tabMatrix" aria-selected="true" aria-controls="panelMatrix">Matrix</button>
    <button role="tab" id="tabTable" aria-selected="false" aria-controls="panelTable">Table</button>
  </div>
</div>

<section class="card" id="panelMatrix" role="tabpanel" aria-labelledby="tabMatrix">
  <div class="card-head">
    <h2>Matchup matrix</h2>
    <p class="card-sub">Row deck&rsquo;s winrate vs column deck. Cells below the minimum-games
       threshold are greyed &mdash; the number is still there, but the sample can&rsquo;t support it.</p>
  </div>

  <div class="legend" aria-hidden="true">
    <span class="legend-end">Row deck loses</span>
    <div class="legend-scale" id="legendScale"></div>
    <span class="legend-end">Row deck wins</span>
    <span class="legend-sep"></span>
    <span class="legend-thin"><i class="sw-thin"></i> too few games</span>
  </div>

  <div class="scroll-x">
    <div class="matrix" id="matrix"></div>
  </div>
</section>

<section class="card" id="panelSummary">
  <div class="card-head">
    <h2>Overall winrate by deck</h2>
    <p class="card-sub">Deviation from an even 50%, with the 95% Wilson interval.
       A deck whose interval crosses the centre line has not shown a real edge.</p>
  </div>
  <div class="scroll-x"><div class="summary" id="summary"></div></div>
</section>

<section class="card hidden" id="panelTable" role="tabpanel" aria-labelledby="tabTable">
  <div class="card-head"><h2>All matchups</h2>
    <p class="card-sub">The same numbers, as text. Ordered pairs, so each matchup appears twice.</p></div>
  <div class="scroll-x"><table id="dataTable">
    <thead><tr><th scope="col">Deck</th><th scope="col">Opponent</th><th scope="col" class="num">Games</th>
      <th scope="col" class="num">Winrate</th><th scope="col" class="num">95% interval</th></tr></thead>
    <tbody></tbody>
  </table></div>
</section>

<section class="card notes">
  <h2>How to read this &mdash; and what it can&rsquo;t tell you</h2>
  <ul>
    <li><b>Ties count as half a win.</b> Byes, unfinished matches and mirrors are excluded;
        mirrors are 50% by construction and carry no information.</li>
    <li><b>The interval is the point.</b> At 20 games a 50% winrate carries roughly
        &plusmn;20 points of uncertainty; at 100 games, about &plusmn;10. Most cells here are
        small, so treat anything short of a lopsided split as unresolved.</li>
    <li><b>Deck, not pilot.</b> An archetype played mostly by strong players looks strong.
        Nothing here separates the two.</li>
    <li><b>One format window.</b> All tournaments fall in a single date range, so the card
        pool is consistent &mdash; widening it would mix incompatible metagames.</li>
    <li><b>&ldquo;Other&rdquo; is excluded</b>, being a bucket of unlike decks rather than an archetype.</li>
  </ul>
</section>

<footer class="foot" id="foot"></footer>
<div class="tip" id="tip" role="status" aria-live="polite"></div>
</div>

<script>
const D = /*__DATA__*/;
const fmtPct = v => (v * 100).toFixed(1) + "%";
const fmtPct0 = v => Math.round(v * 100) + "%";
const nf = n => n.toLocaleString("en-US");

const BINS = [
  { max: 0.35, v: "--d3" }, { max: 0.42, v: "--d2" }, { max: 0.47, v: "--d1" },
  { max: 0.53, v: "--neutral" }, { max: 0.58, v: "--u1" }, { max: 0.65, v: "--u2" },
  { max: 1.01, v: "--u3" },
];
// ink chosen per fill so the value always clears 4.5:1 (verified against both surfaces)
const INK_DARK_FILL = { "--d3": 1, "--u3": 1 };
const binOf = w => BINS.find(b => w < b.max) || BINS[BINS.length - 1];

const cellIndex = new Map();
D.cells.forEach(c => cellIndex.set(c.d + "|" + c.o, c));
const deckById = new Map(D.decks.map(d => [d.id, d]));

const el = id => document.getElementById(id);
const state = { sort: "games", min: 20 };

function sorted() {
  const arr = D.decks.slice();
  if (state.sort === "games") arr.sort((a, b) => b.games - a.games);
  else if (state.sort === "winrate") arr.sort((a, b) => b.winrate - a.winrate);
  else arr.sort((a, b) => a.label.localeCompare(b.label));
  return arr;
}

/* ---------- header ---------- */
el("metaLine").textContent =
  `${nf(D.meta.matches)} matches from ${D.meta.tournaments} tournaments, ` +
  `${D.meta.date_min} to ${D.meta.date_max}. Showing the ${D.decks.length} most-played of ` +
  `${D.meta.decks_total} archetypes.`;
el("tMatches").textContent = nf(D.meta.matches);
el("tTours").textContent = D.meta.tournaments;
el("tEntries").textContent = nf(D.meta.entries);
el("tDecks").textContent = D.decks.length;
el("foot").textContent =
  "Winrates include ties as half a win. Intervals are Wilson score, 95%. " +
  "Source: play.limitlesstcg.com tournament pairings and standings.";

/* ---------- legend ---------- */
el("legendScale").innerHTML = BINS.map((b, i) => {
  const lowEdge = i === 0 ? 0 : BINS[i - 1].max;
  const label = i === 0 ? `under ${fmtPct0(b.max)}`
    : i === BINS.length - 1 ? `over ${fmtPct0(lowEdge)}`
    : `${fmtPct0(lowEdge)}\u2013${fmtPct0(b.max)}`;
  return `<i style="background:var(${b.v})" title="${label}"></i>`;
}).join("");

/* ---------- tooltip ---------- */
const tip = el("tip");
function showTip(html, ev) {
  tip.innerHTML = html; tip.classList.add("on");
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => tip.classList.remove("on");

function cellTip(c) {
  const a = deckById.get(c.d).label, b = deckById.get(c.o).label;
  const wins = c.w * c.n;
  const rec = `${(+wins.toFixed(1))}\u2013${(+(c.n - wins).toFixed(1))}`;
  const thin = c.n < state.min
    ? `<div class="dim" style="margin-top:4px">Below the ${state.min}-game threshold</div>` : "";
  return `<b>${a}</b> vs ${b}<br><b>${fmtPct(c.w)}</b> over ${c.n} games` +
    `<div class="dim">record ${rec} &middot; 95% CI ${fmtPct(c.lo)}\u2013${fmtPct(c.hi)}</div>${thin}`;
}

/* ---------- matrix ---------- */
function renderMatrix() {
  const decks = sorted(), n = decks.length;
  const m = el("matrix");
  m.style.gridTemplateColumns = `max-content repeat(${n}, 52px)`;
  const parts = ['<div class="corner"></div>'];
  decks.forEach(d => parts.push(`<div class="col-head" title="${d.label}">${d.label}</div>`));

  decks.forEach(row => {
    parts.push(`<div class="row-head" title="${row.label}"><span class="lbl">${row.label}</span><span class="n">${nf(row.games)}</span></div>`);
    decks.forEach(col => {
      if (row.id === col.id) { parts.push('<div class="cell diag">&mdash;</div>'); return; }
      const c = cellIndex.get(row.id + "|" + col.id);
      if (!c) { parts.push('<div class="cell thin" title="no games">&middot;</div>'); return; }
      if (c.n < state.min) {
        parts.push(`<button class="cell thin" data-k="${row.id}|${col.id}">${fmtPct0(c.w)}</button>`);
      } else {
        const b = binOf(c.w);
        parts.push(`<button class="cell" data-k="${row.id}|${col.id}" data-bin="${b.v}" ` +
          `style="background:var(${b.v})">${fmtPct0(c.w)}</button>`);
      }
    });
  });
  m.innerHTML = parts.join("");
}

/* Ink is picked per fill so the value always clears 4.5:1 (measured on both surfaces).
   Light mode: every fill is light, so near-black throughout. Dark mode: white, except
   the two brightest steps (--d3 / --u3), which need near-black instead. */
function applyInk() {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches
    ? document.documentElement.getAttribute("data-theme") !== "light"
    : document.documentElement.getAttribute("data-theme") === "dark";
  document.querySelectorAll(".cell[data-bin]").forEach(btn => {
    const bright = INK_DARK_FILL[btn.dataset.bin];
    btn.style.color = dark && !bright ? "var(--ink-on-dark)" : "var(--ink-on-light)";
  });
}

/* ---------- summary ---------- */
function renderSummary() {
  const decks = sorted();
  const [lo, hi] = D.domain, span = hi - lo;
  const pos = v => ((Math.min(hi, Math.max(lo, v)) - lo) / span) * 100;
  const s = el("summary");
  const rows = decks.map(d => {
    const c = pos(d.winrate), mid = pos(0.5);
    const left = Math.min(c, mid), width = Math.abs(c - mid);
    const b = binOf(d.winrate);
    return `<div class="srow" data-deck="${d.id}">
      <div class="sname" title="${d.label}">${d.label}</div>
      <div class="strack">
        <div class="scentre" style="left:${mid}%"></div>
        <div class="sbar" style="left:${left}%; width:${Math.max(width, 0.4)}%; background:var(${b.v})"></div>
        <div class="sci" style="left:${pos(d.ci_low)}%; width:${pos(d.ci_high) - pos(d.ci_low)}%"></div>
      </div>
      <div class="sval">${fmtPct(d.winrate)}</div>
      <div class="sshare">${fmtPct(d.share)}</div>
    </div>`;
  });
  const ticks = [];
  for (let v = Math.ceil(lo * 20) / 20; v <= hi + 1e-9; v += 0.05)
    ticks.push(`<span style="left:${pos(v)}%">${fmtPct0(v)}</span>`);
  s.innerHTML =
    `<div class="shead"><div>Deck</div><div>Winrate vs 50%</div>
       <div class="r">Winrate</div><div class="r">Meta share</div></div>` +
    rows.join("") +
    `<div class="saxis"><div></div><div class="ticks">${ticks.join("")}</div><div></div><div></div></div>`;
}

/* ---------- table ---------- */
function renderTable() {
  const order = new Map(sorted().map((d, i) => [d.id, i]));
  const rows = D.cells.slice()
    .filter(c => order.has(c.d) && order.has(c.o))
    .sort((a, b) => order.get(a.d) - order.get(b.d) || b.n - a.n)
    .map(c => `<tr><td>${deckById.get(c.d).label}</td><td>${deckById.get(c.o).label}</td>
      <td class="num">${c.n}</td><td class="num">${fmtPct(c.w)}</td>
      <td class="num">${fmtPct(c.lo)}\u2013${fmtPct(c.hi)}</td></tr>`);
  el("dataTable").querySelector("tbody").innerHTML = rows.join("");
}

/* ---------- wiring ---------- */
function renderAll() { renderMatrix(); applyInk(); renderSummary(); renderTable(); }

el("matrix").addEventListener("mouseover", e => {
  const b = e.target.closest(".cell[data-k]"); if (!b) return;
  showTip(cellTip(cellIndex.get(b.dataset.k)), e);
});
el("matrix").addEventListener("mousemove", e => {
  const b = e.target.closest(".cell[data-k]"); if (!b) return hideTip();
  showTip(cellTip(cellIndex.get(b.dataset.k)), e);
});
el("matrix").addEventListener("mouseleave", hideTip);
el("matrix").addEventListener("focusin", e => {
  const b = e.target.closest(".cell[data-k]"); if (!b) return;
  const r = b.getBoundingClientRect();
  showTip(cellTip(cellIndex.get(b.dataset.k)), { clientX: r.left + r.width / 2, clientY: r.bottom - 6 });
});
el("matrix").addEventListener("focusout", hideTip);

el("summary").addEventListener("mousemove", e => {
  const r = e.target.closest(".srow"); if (!r) return hideTip();
  const d = deckById.get(r.dataset.deck);
  showTip(`<b>${d.label}</b><br><b>${fmtPct(d.winrate)}</b> over ${nf(d.games)} games` +
    `<div class="dim">95% CI ${fmtPct(d.ci_low)}\u2013${fmtPct(d.ci_high)} &middot; ` +
    `${fmtPct(d.share)} of the field</div>`, e);
});
el("summary").addEventListener("mouseleave", hideTip);

el("sortBy").addEventListener("change", e => { state.sort = e.target.value; renderAll(); });
el("minGames").addEventListener("change", e => { state.min = +e.target.value; renderAll(); });

const tabM = el("tabMatrix"), tabT = el("tabTable");
function setView(matrix) {
  tabM.setAttribute("aria-selected", matrix); tabT.setAttribute("aria-selected", !matrix);
  el("panelMatrix").classList.toggle("hidden", !matrix);
  el("panelTable").classList.toggle("hidden", matrix);
}
tabM.addEventListener("click", () => setView(true));
tabT.addEventListener("click", () => setView(false));

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyInk);
new MutationObserver(applyInk).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

renderAll();
</script>
</body>
</html>
"""
