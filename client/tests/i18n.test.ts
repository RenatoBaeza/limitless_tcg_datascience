import assert from "node:assert/strict";
import { test } from "node:test";
import { createI18n, resolveLanguage } from "../src/i18n-core.ts";
import { en, type Message, type MessageKey } from "../src/locales/en.ts";
import { es } from "../src/locales/es.ts";

test("saved choice wins, regional browser locales resolve, unsupported languages fall back", () => {
  assert.equal(resolveLanguage("en", ["es-CL"]), "en");
  assert.equal(resolveLanguage("es", ["en-US"]), "es");
  assert.equal(resolveLanguage(null, ["es-CL", "en-US"]), "es");
  assert.equal(resolveLanguage("invalid", ["fr", "ES-mx"]), "es");
  assert.equal(resolveLanguage(null, ["en-GB", "es"]), "en");
  assert.equal(resolveLanguage(null, ["ja"]), "en");
  assert.equal(resolveLanguage(null, []), "en");
});

test("both catalogs cover the same keys, plural forms and interpolation parameters", () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  const forms = (message: Message) => typeof message === "string" ? [message] : [message.one, message.other];
  for (const key of Object.keys(en) as MessageKey[]) {
    const english = forms(en[key]);
    const spanish = forms(es[key]);
    assert.equal(spanish.length, english.length, key);
    english.forEach((text, index) => {
      assert.ok(spanish[index].length > 0, key);
      assert.deepEqual(placeholders(spanish[index]), placeholders(text), key);
    });
  }
});

test("counts select singular/plural forms and interpolate without interpreting content", () => {
  const english = createI18n("en");
  const spanish = createI18n("es");
  assert.equal(english.t("matchCount", { count: 1 }), "1 match");
  assert.equal(english.t("matchCount", { count: 0 }), "0 matches");
  assert.equal(spanish.t("matchCount", { count: 1 }), "1 partida");
  assert.equal(spanish.t("matchCount", { count: 2 }), "2 partidas");
  assert.equal(spanish.t("entryCount", { count: 1 }), "1 participación");
  assert.equal(spanish.t("entryCount", { count: 12000 }), "12.000 participaciones");
  assert.equal(spanish.t("overOpponent", { opponent: "<b>{count}</b>", matches: "2 partidas" }),
    "contra <b>{count}</b> · 2 partidas");
});

test("numbers, rates and records follow the selected language, retaining null placeholders", () => {
  const english = createI18n("en");
  const spanish = createI18n("es");
  assert.equal(english.count(12345), "12,345");
  assert.equal(spanish.count(12345), "12.345");
  assert.equal(english.percent(0.567, 1), "56.7");
  assert.equal(spanish.percent(0.567, 1), "56,7");
  assert.equal(english.percentSign(0.567), "56.7%");
  assert.equal(spanish.percentSign(0.567), "56,7\u00a0%");
  assert.equal(spanish.percentSign(0, 0), "0\u00a0%");
  assert.equal(spanish.percentSign(null), "—");
  assert.equal(english.percent(undefined), "—");
  assert.equal(spanish.record(12345, 20000, 2), "12.345-20.000-2");
});

test("event dates stay on their calendar day and missing timestamps are handled", () => {
  assert.equal(createI18n("en").date("2026-10-04"), "10/4/2026");
  assert.equal(createI18n("es").date("2026-10-04"), "4/10/2026");
  assert.equal(createI18n("es").date(null), "—");
  assert.equal(createI18n("es").date("invalid"), "—");
  assert.equal(createI18n("es").relativeTime(null), null);
  assert.equal(createI18n("es").relativeTime("invalid"), null);
});

test("relative refresh times use the selected language across time units", (context) => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  context.mock.method(Date, "now", () => now);
  for (const language of ["en", "es"] as const) {
    const i18n = createI18n(language);
    const expected = new Intl.RelativeTimeFormat(language, { numeric: "always", style: "short" });
    for (const [minutes, value, unit] of [[5, -5, "minute"], [120, -2, "hour"], [2880, -2, "day"]] as const) {
      assert.equal(i18n.relativeTime(new Date(now - minutes * 60000).toISOString()), expected.format(value, unit));
    }
  }
});
