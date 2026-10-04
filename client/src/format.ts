/** Locale-bound formatters shared by every table, chart and readout. */
export function createFormat(locale: string) {
  const numbers = new Intl.NumberFormat(locale);
  const dates = new Intl.DateTimeFormat(locale, { timeZone: "UTC" });
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" });
  const rates = new Map<string, Intl.NumberFormat>();
  const rate = (value: number | null | undefined, digits: number, sign: boolean) => {
    if (value == null) return "—";
    const key = `${digits}-${sign}`;
    let formatter = rates.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, {
        style: sign ? "percent" : "decimal",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        useGrouping: false,
      });
      rates.set(key, formatter);
    }
    return formatter.format(sign ? value : value * 100);
  };
  const count = (value: number) => numbers.format(value);
  return {
    count,
    percent: (value: number | null | undefined, digits = 0) => rate(value, digits, false),
    percentSign: (value: number | null | undefined, digits = 1) => rate(value, digits, true),
    record: (wins: number, losses: number, ties: number) => `${count(wins)}-${count(losses)}-${count(ties)}`,
    date: (iso: string | null) => {
      if (!iso) return "—";
      const value = new Date(iso);
      return Number.isNaN(value.getTime()) ? "—" : dates.format(value);
    },
    relativeTime: (iso: string | null) => {
      if (!iso) return null;
      const timestamp = new Date(iso).getTime();
      if (!Number.isFinite(timestamp)) return null;
      const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
      if (minutes < 60) return relative.format(-minutes, "minute");
      if (minutes < 1440) return relative.format(-Math.round(minutes / 60), "hour");
      return relative.format(-Math.round(minutes / 1440), "day");
    },
  };
}

/**
 * A rate is only news if its interval clears even. Anything spanning 50% is a
 * matchup we cannot call yet, however extreme the point estimate looks.
 */
export const spansEven = (low: number | null, high: number | null) =>
  low == null || high == null || (low <= 0.5 && high >= 0.5);
