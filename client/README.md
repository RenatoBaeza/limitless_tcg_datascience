# Limitless TCG client

Vite + React + TypeScript. Reads the gold layer through the FastAPI service in
`../server`.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
```

`npm run dev` proxies `/api` to `http://127.0.0.1:8000`, so the browser stays on
one origin and CORS never comes into it. Override with `API_TARGET` for dev, or
set `VITE_API_URL` to call a deployed API directly.

The API has to be running, and the gold layer has to be populated — see
`../server/README.md`. The page says so if either is missing.

## What's on screen

One filter row (date range, how many decks, minimum matches, whether to include
the unclassified "Other" bucket) scoping three things below it: headline stat
tiles, the matchup matrix, and the deck table. Clicking any deck opens its
detail panel — that deck against every opponent it faced, as a dot plot with
confidence whiskers.

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
nothing is encoded by colour alone, and the matrix has a table view twin. Three
kinds of cell mean three different things: a painted cell is a real record, the
diagonal is a mirror (50% by construction, excluded from the data), and a blank
cell means the two decks never met often enough to clear the minimum-matches
filter — which is a different claim from 0%.

A dotted underline under a cell's number means its 95% interval still spans 50%:
the point estimate is there, but the data cannot call the matchup either way
yet. Raising the minimum-matches filter is how you clear those out.

**Date presets count back from the last event in the data**, not from today.
Results land days after an event happens and the ingest runs every six hours, so
counting from today would quietly clip the most recent weekend off the window.

## Assets

`public/decks/` is generated, not authored — `../server/scripts/download_deck_sprites.py`
writes it. One composited PNG per deck, keyed on `deck_id`.
