import { describe, expect, it } from "vitest";

import { resolveLoginLocale } from "./login-locale.js";

describe("resolveLoginLocale", () => {
  it("falls back to the product default when the venue's own language is not installed", () => {
    expect(resolveLoginLocale(undefined, "fr-FR")).toBe("en-GB");
  });

  it("keeps the venue's language when the browser sends no header", () => {
    expect(resolveLoginLocale(undefined, "es-ES")).toBe("es-ES");
  });

  it("takes a language's earliest entry when the browser lists it twice at the same weight", () => {
    expect(resolveLoginLocale("en-US;q=0.5,es;q=0.5,en-GB;q=0.5", "es-ES")).toBe("en-GB");
  });
});
