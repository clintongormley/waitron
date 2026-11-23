import { afterEach, expect, it } from "vitest";
import { currentLocale, format, setLocale, subscribeLocale, t } from "./t.js";

afterEach(() => {
  // The locale is module-level, so a setLocale in one test would leak into the next.
  setLocale("en-GB");
});

it("uses the active locale when none is passed, and setLocale switches it", () => {
  expect(t("shell.document_title")).toBe("Waitron — set up your box");
  setLocale("es-ES");
  expect(currentLocale()).toBe("es-ES");
  expect(t("shell.document_title")).toBe("Waitron — configura tu servidor");
});

it("translates into the locale it is passed, whatever the active one", () => {
  expect(t("shell.document_title", "es-ES")).toBe("Waitron — configura tu servidor");
});

it("falls back to English for a locale it has no catalogue for", () => {
  expect(t("shell.document_title", "fr-FR")).toBe("Waitron — set up your box");
});

it("notifies subscribers on setLocale and stops after unsubscribe", () => {
  let calls = 0;
  const off = subscribeLocale(() => {
    calls += 1;
  });
  setLocale("es-ES");
  expect(calls).toBe(1);
  off();
  setLocale("en-GB");
  expect(calls).toBe(1);
});

it("fills each named placeholder, in the active locale", () => {
  expect(format("connect.waiting.time_left", { minutes: 30 })).toBe("Time left: 30 min");
  setLocale("es-ES");
  expect(format("connect.waiting.time_left", { minutes: 30 })).toBe("Tiempo restante: 30 min");
});

it("inserts a value holding a replacement pattern as written", () => {
  expect(format("shell.bucket.refused_code", { code: "$&x" })).toBe(
    "The copy could not be restored. ($&x) If an earlier restore choice is still saved, it will run when the box starts. Choose another restore to replace it.",
  );
});

it("leaves a placeholder it was given no value for as written", () => {
  expect(format("shell.bucket.refused_code", {})).toBe(
    "The copy could not be restored. ({code}) If an earlier restore choice is still saved, it will run when the box starts. Choose another restore to replace it.",
  );
});
