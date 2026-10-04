# Limitless TCG client

Vite + React + TypeScript. Reads the gold layer through the FastAPI service in
`../server`.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
npm test           # i18n regression tests (Node 22.6+)
```

`npm run dev` proxies `/api` to `http://127.0.0.1:8000`, so the browser stays on
one origin and CORS never comes into it. Override with `API_TARGET` for dev, or
set `VITE_API_URL` to call a deployed API directly.

The API has to be running, and the gold layer has to be populated — see
`../server/README.md`. The page says so if either is missing.

## What's on screen

One control — the period: last 3, 7, 30, 60 or 90 days, or all six months —
scoping three things below it: headline stat tiles, the matchup matrix, and the
deck table. Everything else is fixed: the top 50 decks, every pairing that met
at least once, and never the unclassified "Other" bucket. Clicking any deck opens its
detail drawer — that deck against every opponent it faced, as a dot plot with
confidence whiskers, sortable, with each opponent clickable through to its own.

## Languages

The header's language selector supports English and Spanish. It remembers an
explicit choice in `localStorage` (`limitless-language`); otherwise the first
supported browser language is used, with English as the fallback. If browser
storage is blocked, switching still works for the current session.

`src/locales/en.ts` and `src/locales/es.ts` contain typed message catalogs.
Components use `useI18n()` for text, plurals, numbers, percentages, dates and
relative times. Add new messages to both catalogs; `npm test` checks their keys,
plural forms and interpolation placeholders. Dates use UTC so date-only event
values do not shift to the previous day in a viewer's time zone.

Switching language updates the document language and title, including text in
memoized tables and portalled tooltips/drawers. It preserves filters, sorting,
selection and cached API data. Deck names and API identifiers remain unchanged.

## Design notes

**The colour scale** (`src/scale.ts`) is the file to read before changing any
colour.

A matchup rate is a polarity, so it takes a diverging scale: two hues that read
as opposite either side of a neutral gray midpoint. Blue is favourable, red
unfavourable. It is deliberately *not* green/red — those two collapse into each
other under the most common colour blindness, and a matchup chart is exactly
where that matters.

The stops mirror the design system's blue ramp step for step in OKLCH lightness,
so both arms are perceptually the same distance from neutral at the same rate,
and each arm was validated for monotone lightness, adjacent ΔL ≥ 0.06 and a
single hue. Interpolation is in OKLCH rather than sRGB, which keeps the ramp
even instead of going muddy through the middle. Dark mode is its own set of
stops rather than an inversion: on a dark surface the neutral end recedes toward
the surface and the poles gain lightness, the opposite direction of travel.

The scale saturates at 25% and 75%. Real matchups between decks anyone plays
live between roughly 35% and 65%, so mapping the full 0–100% would spend most of
the ramp on rates that never occur.

**Reading the cells.** Every cell carries its number as well as its colour, so
nothing is encoded by colour alone. Three kinds of cell mean three different
things: a painted cell is a real record, the diagonal is a mirror (50% by
construction, excluded from the data), and a blank cell means the two decks
never met in the period — which is a different claim from 0%.

Every meeting is drawn, however thin, so a muted cell is how the matrix says its
95% interval still spans 50%: the point estimate is there, but the data cannot
call the matchup either way yet. A longer period is how you firm those up.

**Date presets count back from the last event in the data**, not from today.
Results land days after an event happens and the ingest runs every six hours, so
counting from today would quietly clip the most recent weekend off the window.

**Motion.** The page is meant to feel alive, but no effect carries
information the static page does not, and none is allowed to cost
smoothness:

- An ambient backdrop (drifting aurora, a dot lattice lit around the cursor, a
  canvas of slow particles that parallax on scroll and part around the
  pointer, film grain), in a violet-to-amber palette that stays clear of the
  data's blue and red.
- The stat tiles are holo cards: they tilt toward the cursor, and a foil
  sheen and glare slide with it.
- The matrix enters as a wave along its anti-diagonals. Hovering a cell lights
  its row and column, dims the rest, and slides a marker along the legend to
  that cell's rate.
- Numbers roll up, panels rise in as they scroll into view, re-sorted rows
  glide to their new places, and the theme switch reveals through a circle
  grown from the toggle (View Transitions, where the browser has them).

All of it switches off under `prefers-reduced-motion`. The CSS and the JS
check the same query, so the reduced page is the same page, not a page with
parts missing. No dependency was added for any of it.

## Assets

`public/decks/` is generated, not authored — `../server/scripts/download_deck_sprites.py`
writes it. One composited PNG per deck, keyed on `deck_id`.
