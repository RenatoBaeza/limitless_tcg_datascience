import { createFormat } from "./format.ts";
import { en, type Catalog, type MessageKey } from "./locales/en.ts";
import { es } from "./locales/es.ts";

export type Language = "en" | "es";
export const LANGUAGE_STORAGE_KEY = "limitless-language";
export const isLanguage = (value: unknown): value is Language => value === "en" || value === "es";

/** Prefer an explicit choice, then the first supported browser language. */
export function resolveLanguage(stored: unknown, preferred: readonly string[]): Language {
  if (isLanguage(stored)) return stored;
  for (const tag of preferred) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(language)) return language;
  }
  return "en";
}

export function createI18n(language: Language) {
  const format = createFormat(language);
  const catalog: Catalog = language === "es" ? es : en;
  const plurals = new Intl.PluralRules(language);
  const t = (key: MessageKey, params: Record<string, string | number> = {}): string => {
    const message = catalog[key] ?? en[key];
    const template = typeof message === "string"
      ? message
      : message[plurals.select(Number(params.count)) === "one" ? "one" : "other"];
    // Plain strings go through React's escaping; never render translation HTML.
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params[name];
      return typeof value === "number" ? format.count(value) : value ?? placeholder;
    });
  };
  return { language, t, ...format };
}
