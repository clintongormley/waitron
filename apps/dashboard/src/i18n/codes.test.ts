import { afterEach, describe, expect, it } from "vitest";
import { codeMessage, codeOf } from "./codes.js";
import { setLocale } from "./t.js";

afterEach(() => {
  // codes.ts defaults to t.ts's module-level locale (via currentLocale()); reset
  // to the shipped default so a setLocale in one test cannot leak into another.
  setLocale("es-ES");
});

it("resolves a known code to its Spanish copy", () => {
  // Exercises CODE_MESSAGES[code] (first ?? arm) and entry[lang] with lang "es".
  expect(codeMessage("password.invalid", "es")).toBe("Contraseña incorrecta, inténtalo de nuevo");
});

it("degrades an unknown code to the generic message, NEVER the raw code", () => {
  // The load-bearing guarantee: an unmapped code must render human copy, never leak
  // the wire code to the operator. This is the CODE_MESSAGES[code] ?? GENERIC arm.
  const message = codeMessage("totally.made.up", "en");
  expect(message).toBe("Something went wrong, try again");
  expect(message).not.toBe("totally.made.up");
});

it("degrades a prototype-chain code (toString/constructor) to GENERIC, never undefined", () => {
  // A code colliding with an Object.prototype member (`toString`, `constructor`, `valueOf`,
  // `hasOwnProperty`) must still degrade to GENERIC copy — the "only ever a sentence, never the raw
  // code (and never undefined)" guarantee has to hold for EVERY string, not just registry codes. A
  // bare `CODE_MESSAGES[code]` would resolve the inherited method (truthy), skip the `?? GENERIC`
  // arm, and return undefined → an empty banner; an own-key check is what keeps the guarantee true.
  for (const code of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
    expect(codeMessage(code, "en")).toBe("Something went wrong, try again");
  }
});

it("resolves a known code to its English copy", () => {
  // entry[lang] with lang "en" — the other side of the language selection.
  expect(codeMessage("password.invalid", "en")).toBe("Incorrect password, try again");
});

it("falls back to English for a known code in an unknown language", () => {
  // "fr" is not a column, so entry["fr"] is undefined and the `?? entry.en` arm fires.
  expect(codeMessage("password.invalid", "fr")).toBe("Incorrect password, try again");
});

it("strips a region subtag before the language lookup", () => {
  // "es-ES" → "es"; proves locale.replace(/-.*$/, "") runs before indexing entry.
  expect(codeMessage("totp.invalid", "es-ES")).toBe("Código incorrecto, inténtalo de nuevo");
});

it("defaults to the active locale when none is passed", () => {
  // No locale arg → currentLocale(). The shipped default is es-ES.
  expect(codeMessage("passkey.registered")).toBe("Passkey añadida");
  setLocale("en");
  expect(codeMessage("passkey.registered")).toBe("Passkey added");
});

it("has a sentence for each roster/shift/convenio code (shift-planning slice 1)", () => {
  // Every code the roster surface can surface must map to real copy, never the raw wire code and never
  // the GENERIC "something went wrong" fallback — so the banner reads as an actionable message. Proven
  // by deletion: drop any of these from CODE_MESSAGES and codeMessage returns GENERIC_ES → the
  // not.toBe(GENERIC_ES) assertion goes red. GENERIC is not exported, so its Spanish text is inlined.
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  for (const code of [
    "roster.draft_exists",
    "roster.not_draft",
    "roster.not_found",
    "roster.already_published",
    "roster.period_already_published",
    "shift.not_found",
    "shift.invalid",
    "convenio.not_found",
    "swap.not_found",
    "swap.not_decidable",
    "absence.not_found",
  ]) {
    expect(codeMessage(code, "es")).not.toBe(code);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
  }
});

describe("codeOf", () => {
  // codeOf is the companion to codeMessage: it pulls the wire CODE out of a rejected value (the
  // dashboard API client rejects with a bare `{ code }`, see api/client.ts), so the same body that
  // was hand-copied across the screens now lives once beside the code→message seam. Behaviour it
  // must preserve exactly: `.code` when present, else `fallback` (default `server.internal`).
  it("returns the code when the rejection carries one", () => {
    expect(codeOf({ code: "x" })).toBe("x");
  });

  it("falls back to server.internal when the rejection carries no code", () => {
    expect(codeOf({})).toBe("server.internal");
  });

  it("falls back to server.internal for a plain Error (no code)", () => {
    expect(codeOf(new Error("boom"))).toBe("server.internal");
  });

  it("prefers the code over a supplied fallback", () => {
    expect(codeOf({ code: "z" }, "f")).toBe("z");
  });

  it("uses the supplied fallback when the rejection carries no code", () => {
    // The passkey flows pass this fallback so a code-less rejection reads as a verification failure.
    expect(codeOf({}, "passkey.verification_failed")).toBe("passkey.verification_failed");
  });
});

it("has a sentence for each staff self-service code (my-schedule portal)", () => {
  // Every code the staff schedule surface (apps/server/src/me-api.ts) can reject with must map to real
  // copy, never the raw wire code and never the GENERIC fallback — so the banner reads as an actionable
  // message. These four are the staff-only additions beyond the roster codes above (swap.not_found /
  // absence.not_found / shift.not_found are already covered). Proven by deletion: drop any of these from
  // CODE_MESSAGES and codeMessage returns GENERIC_ES → the not.toBe(GENERIC_ES) assertion goes red.
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  for (const code of [
    "swap.not_permitted",
    "swap.not_acceptable",
    "absence.overlaps",
    "absence.invalid",
  ]) {
    expect(codeMessage(code, "es")).not.toBe(code);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
  }
});

it("has a sentence for each printing code (Impresoras screen)", () => {
  // Every code the Impresoras surface (apps/server/src/print-api.ts) can reject with must map to real
  // copy, never the raw wire code and never the GENERIC fallback — so the banner reads as an actionable
  // message. `management.request_invalid` / `shared.invalid_id` (body/id screens) and
  // `management_session.*` / `authorization.not_permitted` (the gate) are already covered above. Proven
  // by deletion: drop any of these from CODE_MESSAGES and codeMessage returns GENERIC_ES → red.
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  for (const code of ["printer.invalid_config", "printer.not_found", "agent.not_found"]) {
    expect(codeMessage(code, "es")).not.toBe(code);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
  }
});

it("has a sentence for the location-menus screen code", () => {
  // The location↔menu writes (apps/server/src/catalogue-api.ts) reject with `catalogue.not_found` when
  // a catalogueId names no catalogue the tenant can see. The Location menus screen renders
  // codeMessage(errorKey), so it must map to real copy, never the raw wire code and never the GENERIC
  // fallback. `management.request_invalid` / `shared.invalid_id` and the gate codes are covered above.
  // Each language is compared against ITS OWN generic (the "es" copy against GENERIC_ES, the "en" copy
  // against GENERIC_EN) — comparing the English result against the Spanish generic would never catch an
  // English regression to the English fallback. Proven by deletion: drop `catalogue.not_found` from
  // CODE_MESSAGES and both codeMessage calls return their language's generic → the assertions go red.
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  const GENERIC_EN = "Something went wrong, try again";
  expect(codeMessage("catalogue.not_found", "es")).not.toBe("catalogue.not_found");
  expect(codeMessage("catalogue.not_found", "es")).not.toBe(GENERIC_ES);
  expect(codeMessage("catalogue.not_found", "en")).not.toBe(GENERIC_EN);
});
