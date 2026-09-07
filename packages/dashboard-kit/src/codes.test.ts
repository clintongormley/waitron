import { beforeEach, describe, expect, it } from "vitest";
import { codeMessage, codeOf, registerCodeMessages } from "./codes.js";
import { setLocale } from "./i18n.js";

beforeEach(() => {
  registerCodeMessages({
    "password.invalid": {
      en: "Incorrect password, try again",
      es: "Contraseña incorrecta, inténtalo de nuevo",
    },
  });
  setLocale("es-ES");
});

it("resolves a registered code to its Spanish copy", () => {
  expect(codeMessage("password.invalid", "es")).toBe("Contraseña incorrecta, inténtalo de nuevo");
});

it("resolves a registered code to its English copy", () => {
  expect(codeMessage("password.invalid", "en")).toBe("Incorrect password, try again");
});

it("degrades an unregistered code to GENERIC, never the raw code", () => {
  const message = codeMessage("totally.made.up", "en");
  expect(message).toBe("Something went wrong, try again");
  expect(message).not.toBe("totally.made.up");
});

it("degrades a prototype-chain code (toString/constructor) to GENERIC, never undefined", () => {
  // A code colliding with an Object.prototype member resolves the inherited method under a `??`
  // (truthy → skips GENERIC → pickLocale returns undefined, a blank banner). The Object.hasOwn guard
  // is what keeps GENERIC firing here — proven by deletion: swap the guard for `messages[code] ??
  // GENERIC` and these assertions go red (an inherited function, then undefined from pickLocale).
  for (const code of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
    expect(codeMessage(code, "en")).toBe("Something went wrong, try again");
  }
});

describe("codeOf", () => {
  it("returns the code when the rejection carries one", () => {
    expect(codeOf({ code: "x" })).toBe("x");
  });

  it("falls back to server.internal when the rejection carries no code", () => {
    expect(codeOf({})).toBe("server.internal");
  });

  it("uses the supplied fallback when the rejection carries no code", () => {
    expect(codeOf({}, "x")).toBe("x");
  });

  it("prefers the code over a supplied fallback", () => {
    expect(codeOf({ code: "z" }, "f")).toBe("z");
  });
});
