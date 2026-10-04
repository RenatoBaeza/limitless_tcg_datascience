/**
 * The diverging scale the matchup matrix is painted with.
 *
 * A matchup rate is a polarity - above or below even - so it takes a diverging
 * scale: two hues that read as opposite either side of a neutral gray
 * midpoint. Blue is favourable, red is unfavourable. Green/red is the usual
 * choice for this and is the one thing it must not be: those two collapse into
 * each other under the most common colour blindness, and a matchup chart is
 * exactly where that matters.
 *
 * The stops are not eyeballed. Each arm mirrors the design system's blue ramp
 * step for step in OKLCH lightness, so the two arms are perceptually the same
 * distance from neutral at the same rate, and both were run through the
 * palette validator (monotone lightness, adjacent dL >= 0.06, one hue per
 * arm). Interpolation happens in OKLCH rather than sRGB so the ramp stays
 * even - a straight sRGB blend through gray goes muddy in the middle.
 *
 * Dark mode is its own set of stops, not an inversion. On a dark surface the
 * neutral end has to recede toward the surface and the poles gain lightness,
 * which is the opposite direction of travel to light mode. Its neutral sits
 * only a step above the board, so an even matchup reads as a quiet tile and
 * the lopsided ones are what light up. (An earlier neutral at L 0.34 put a
 * mid-gray block under every near-even cell, and the low-chroma end of the red
 * arm came out as mud brown.)
 *
 * `ink` comes back with every colour because a heat cell carries its number
 * inside it, and which of a dark or a light ink stays readable flips partway
 * along the ramp. Both inks are tinted toward the cell's own hue rather than
 * pure black and white, so a cell's number reads as part of it rather than
 * stamped on top. The threshold is measured, not guessed: swept over every
 * rate in both modes, solid and muted.
 */

export type Mode = "light" | "dark";

type Arm = { hue: number; stops: Array<[number, number]> };

// [lightness, chroma] per stop, neutral first, running out to the pole.
const RAMPS: Record<Mode, { blue: Arm; red: Arm }> = {
  light: {
    blue: {
      hue: 255,
      stops: [
        [0.952, 0],
        [0.905, 0.041],
        [0.764, 0.097],
        [0.622, 0.161],
        [0.48, 0.142],
      ],
    },
    red: {
      hue: 25,
      stops: [
        [0.952, 0],
        [0.905, 0.048],
        [0.764, 0.102],
        [0.622, 0.169],
        [0.48, 0.149],
      ],
    },
  },
  dark: {
    blue: {
      hue: 255,
      stops: [
        [0.275, 0],
        [0.38, 0.085],
        [0.5, 0.135],
        [0.63, 0.15],
        [0.77, 0.115],
      ],
    },
    red: {
      hue: 25,
      stops: [
        [0.275, 0],
        [0.38, 0.1],
        [0.5, 0.15],
        [0.63, 0.165],
        [0.77, 0.115],
      ],
    },
  },
};

/**
 * Rates saturate outside this band. Real matchups between decks anyone plays
 * live between roughly 35% and 65%, so mapping the full 0-100% would spend
 * almost the whole ramp on rates that never occur and leave every real cell
 * looking the same shade of nothing.
 */
export const SCALE_DOMAIN = 0.25;

/**
 * Above this OKLCH lightness a cell takes dark ink, below it light ink. Swept
 * over the whole ramp in both modes: 0.58 is where the worst case across the
 * flip is highest, 4.2:1 against the most saturated red. Muted cells never
 * come near it - they land at 0.79 or above in light mode and 0.44 or below in
 * dark - so the same threshold serves both.
 */
const INK_THRESHOLD = 0.58;

/**
 * The inks, as OKLCH lightness; chroma is borrowed from the cell, capped. A
 * muted cell's number is pulled toward the middle as well, so it recedes with
 * its fill. Worst case for the muted pair is 5:1, at a 75% rate whose interval
 * still spans 50%.
 */
const INK = {
  solid: { dark: 0.16, light: 1 },
  muted: { dark: 0.3, light: 0.85 },
};

/**
 * The matrix board each mode draws on (`--surface-solid` in base.css). A muted
 * cell is its colour mixed toward this, so it is needed here to measure the
 * ink against what is actually on screen.
 */
const BOARD: Record<Mode, string> = { light: "#ffffff", dark: "#141924" };

/**
 * How much of the colour a muted cell keeps. Muting pulls a cell toward the
 * board, which in both modes is toward the neutral end of the ramp - so an
 * uncertain 62% reads as weaker than a settled one, which is the honest
 * picture. `edge` keeps the full-strength colour for the cell's outline.
 */
const MUTED_WEIGHT = 0.4;

export type CellColor = { background: string; ink: string; lightness: number; edge: string };

/**
 * Colour for a score rate in 0..1, where 0.5 is even. `muted` is for a rate
 * whose interval still spans 50%: same hue and direction, drawn quieter.
 */
export function scoreColor(rate: number, mode: Mode, muted = false): CellColor {
  const t = clamp((rate - 0.5) / SCALE_DOMAIN, -1, 1);
  const arm = t >= 0 ? RAMPS[mode].blue : RAMPS[mode].red;
  const [lightness, chroma] = interpolate(arm.stops, Math.abs(t));
  const edge = oklchToHex(lightness, chroma, arm.hue);

  let shown: Lab = toLab(lightness, chroma, arm.hue);
  if (muted) {
    const board = hexToLab(BOARD[mode]);
    shown = shown.map((value, i) => value * MUTED_WEIGHT + board[i] * (1 - MUTED_WEIGHT)) as Lab;
  }

  const inks = muted ? INK.muted : INK.solid;
  const ink =
    shown[0] > INK_THRESHOLD
      ? oklchToHex(inks.dark, Math.min(0.07, chroma * 0.6), arm.hue)
      : oklchToHex(inks.light, Math.min(0.025, chroma * 0.25), arm.hue);

  return { background: labToHex(shown), ink, lightness: shown[0], edge };
}

/** Evenly spaced swatches from unfavourable to favourable, for the legend. */
export function scaleSwatches(mode: Mode, steps = 9): Array<CellColor & { rate: number }> {
  return Array.from({ length: steps }, (_, i) => {
    const rate = 0.5 + SCALE_DOMAIN * ((2 * i) / (steps - 1) - 1);
    return { rate, ...scoreColor(rate, mode) };
  });
}

function interpolate(stops: Array<[number, number]>, t: number): [number, number] {
  const span = 1 / (stops.length - 1);
  const index = Math.min(Math.floor(t / span), stops.length - 2);
  const local = (t - index * span) / span;
  const [l0, c0] = stops[index];
  const [l1, c1] = stops[index + 1];
  return [l0 + (l1 - l0) * local, c0 + (c1 - c0) * local];
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

type Lab = [number, number, number];

const toLab = (lightness: number, chroma: number, hueDegrees: number): Lab => {
  const hue = (hueDegrees * Math.PI) / 180;
  return [lightness, chroma * Math.cos(hue), chroma * Math.sin(hue)];
};

/** OKLCH -> sRGB hex, clipping anything the display cannot show. */
export function oklchToHex(lightness: number, chroma: number, hueDegrees: number): string {
  return labToHex(toLab(lightness, chroma, hueDegrees));
}

function labToHex([lightness, a, b]: Lab): string {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return (
    "#" +
    linear
      .map((channel) => {
        const clipped = clamp(channel, 0, 1);
        const encoded =
          clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
        return Math.round(encoded * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

/** sRGB hex -> OKLab, the inverse of labToHex. */
function hexToLab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
