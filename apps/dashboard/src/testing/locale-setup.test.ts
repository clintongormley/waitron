import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { useLocale } from "./locale-setup.js";

const originalLocale = currentLocale();
afterEach(() => setLocale(originalLocale));

describe.each(["en-GB", "fr-FR"])("a locale fixture opened from %s", (previous) => {
  let cleaned: boolean;
  beforeEach(() => {
    setLocale(previous);
    cleaned = false;
  });
  afterEach(() => {
    expect(cleaned).toBe(true);
    expect(currentLocale()).toBe(previous);
  });
  useLocale("es-ES");
  afterEach(() => {
    cleaned = true;
  });

  it("uses the selected language and restores the captured one after cleanup", () => {
    expect(currentLocale()).toBe("es-ES");
    setLocale("en-US");
  });
});
