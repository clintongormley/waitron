import { afterEach, beforeEach } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";

export function useLocale(locale: string): void {
  let previousLocale: string;
  beforeEach(() => {
    previousLocale = currentLocale();
    setLocale(locale);
  });
  afterEach(() => setLocale(previousLocale));
}
