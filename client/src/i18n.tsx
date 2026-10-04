import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createI18n,
  isLanguage,
  LANGUAGE_STORAGE_KEY,
  LEGACY_LANGUAGE_STORAGE_KEY,
  resolveLanguage,
  type Language,
} from "./i18n-core";

type I18n = ReturnType<typeof createI18n> & { setLanguage: (language: Language) => void };
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setCurrentLanguage] = useState<Language>(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
    } catch {
      /* Storage may be disabled. */
    }
    return resolveLanguage(stored, navigator.languages.length ? navigator.languages : [navigator.language]);
  });
  const setLanguage = useCallback((next: Language) => {
    if (!isLanguage(next)) return;
    setCurrentLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* Keep the in-session choice. */
    }
  }, []);
  const value = useMemo(() => ({ ...createI18n(language), setLanguage }), [language, setLanguage]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = value.t("pageTitle");
  }, [language, value]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n requires I18nProvider");
  return context;
}
