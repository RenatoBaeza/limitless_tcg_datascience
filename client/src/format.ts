/** Number formatting, in one place so the matrix and the tables agree. */

export const percent = (value: number | null | undefined, digits = 0) =>
  value == null ? "—" : `${(value * 100).toFixed(digits)}`;

export const percentSign = (value: number | null | undefined, digits = 1) =>
  value == null ? "—" : `${(value * 100).toFixed(digits)}%`;

export const count = (value: number) => value.toLocaleString();

export const record = (wins: number, losses: number, ties: number) =>
  `${count(wins)}-${count(losses)}-${count(ties)}`;

/**
 * A rate is only news if its interval clears even. Anything spanning 50% is a
 * matchup we cannot call yet, however extreme the point estimate looks.
 */
export const spansEven = (low: number | null, high: number | null) =>
  low == null || high == null || (low <= 0.5 && high >= 0.5);

export const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export function daysBefore(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return isoDate(date);
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}
