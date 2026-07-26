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
 * which is the opposite direction of travel to light mode.
 *
 * `ink` comes back with every colour because a heat cell carries its number
 * inside it, and which of black or white stays readable flips partway along
 * the ramp. The threshold is measured, not guessed - see checkContrast in
 * scale.check.ts.
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
        [0.34, 0],
        [0.48, 0.142],
        [0.622, 0.161],
        [0.764, 0.097],
      ],
    },
    red: {
      hue: 25,
      stops: [
        [0.34, 0],
        [0.48, 0.149],
        [0.622, 0.169],
        [0.764, 0.102],
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
 * flip is highest, at 4.4:1 against the most saturated red.
 */
const INK_THRESHOLD = 0.58;

export const INK_ON_LIGHT_CELL = "#0b0b0b";
export const INK_ON_DARK_CELL = "#ffffff";

export type CellColor = { background: string; ink: string; lightness: number };

/** Colour for a score rate in 0..1, where 0.5 is even. */
export function scoreColor(rate: number, mode: Mode): CellColor {
  const t = clamp((rate - 0.5) / SCALE_DOMAIN, -1, 1);
  const arm = t >= 0 ? RAMPS[mode].blue : RAMPS[mode].red;
  const [lightness, chroma] = interpolate(arm.stops, Math.abs(t));

  return {
    background: oklchToHex(lightness, chroma, arm.hue),
    ink: lightness > INK_THRESHOLD ? INK_ON_LIGHT_CELL : INK_ON_DARK_CELL,
    lightness,
  };
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

/** OKLCH -> sRGB hex, clipping anything the display cannot show. */
export function oklchToHex(lightness: number, chroma: number, hueDegrees: number): string {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

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
