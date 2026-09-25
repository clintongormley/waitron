import { afterEach, describe, expect, it } from "vitest";
import { codeMessage, codeOf } from "./codes.js";
import { setLocale } from "./t.js";

afterEach(() => {
  // Reset to the shipped default so a setLocale in one test cannot leak into another.
  setLocale("es-ES");
});

it("resolves a known code to its Spanish copy", () => {
  expect(codeMessage("password.invalid", "es")).toBe("Contraseña incorrecta, inténtalo de nuevo");
});

it("degrades an unknown code to the generic message, NEVER the raw code", () => {
  const message = codeMessage("totally.made.up", "en");
  expect(message).toBe("Something went wrong, try again");
  expect(message).not.toBe("totally.made.up");
});

it("degrades a prototype-chain code (toString/constructor) to GENERIC, never undefined", () => {
  for (const code of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
    expect(codeMessage(code, "en")).toBe("Something went wrong, try again");
  }
});

it("resolves a known code to its English copy", () => {
  expect(codeMessage("password.invalid", "en")).toBe("Incorrect password, try again");
});

it("falls back to English for a known code in an unknown language", () => {
  expect(codeMessage("password.invalid", "fr")).toBe("Incorrect password, try again");
});

it("strips a region subtag before the language lookup", () => {
  expect(codeMessage("totp.invalid", "es-ES")).toBe("Código incorrecto, inténtalo de nuevo");
});

it("defaults to the active locale when none is passed", () => {
  expect(codeMessage("passkey.registered")).toBe("Passkey añadida");
  setLocale("en");
  expect(codeMessage("passkey.registered")).toBe("Passkey added");
});

it("has actionable copy for Google login failures", () => {
  const GENERIC_EN = codeMessage("test.unmapped_code", "en");
  const GENERIC_ES = codeMessage("test.unmapped_code", "es");
  for (const code of ["google.invalid", "google.already_linked", "google.second_factor_required"]) {
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
  }
});

it("has a sentence for each roster/shift/convenio code (shift-planning slice 1)", () => {
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

it("has a sentence for each in-use delete code (device-profile follow-ons)", () => {
  const GENERIC_ES = codeMessage("test.unmapped_code", "es");
  const GENERIC_EN = codeMessage("test.unmapped_code", "en");
  for (const code of ["canvas.in_use", "device_profile.in_use"]) {
    expect(codeMessage(code, "es")).not.toBe(code);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
    expect(codeMessage(code, "en")).not.toBe(code);
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
  }
});

describe("codeOf", () => {
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

it("has a sentence for each gate and request-screen code the management routes answer", () => {
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  const GENERIC_EN = "Something went wrong, try again";
  for (const code of [
    "management_session.required",
    "management_session.expired",
    "person.suspended",
    "authorization.not_permitted",
    "management.request_invalid",
    "shared.invalid_id",
  ]) {
    expect(codeMessage(code, "es")).not.toBe(code);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
  }
});

it("has a sentence for each printing code (Impresoras screen)", () => {
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  for (const code of ["printer.invalid_config", "printer.not_found", "agent.not_found"]) {
    expect(codeMessage(code, "es")).not.toBe(code);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
  }
});

it("has a sentence for each purchase-invoice code (Compras screen)", () => {
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  const GENERIC_EN = "Something went wrong, try again";
  for (const code of [
    "purchase.not_found",
    "purchase.duplicate",
    "purchase.invalid",
    "shared.invalid_decimal",
    "shared.decimal_overflow",
  ]) {
    expect(codeMessage(code, "es")).not.toBe(code);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
  }
});

it("has a sentence for a missing catalogue", () => {
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  const GENERIC_EN = "Something went wrong, try again";
  expect(codeMessage("catalogue.not_found", "es")).not.toBe("catalogue.not_found");
  expect(codeMessage("catalogue.not_found", "es")).not.toBe(GENERIC_ES);
  expect(codeMessage("catalogue.not_found", "en")).not.toBe(GENERIC_EN);
});

it("has a sentence for the allergen declaration codes", () => {
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  for (const code of ["allergen.invalid_code"]) {
    expect(codeMessage(code, "es")).not.toBe(code);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
  }
});
it.each(["modifier.invalid", "modifier.not_found", "modifier.in_use"])(
  "explains %s in both languages",
  (code) => {
    for (const locale of ["en", "es"])
      expect(codeMessage(code, locale)).not.toBe(codeMessage("test.unmapped_code", locale));
  },
);

it("has a sentence for each options/extras list code the dashboard can be answered with", () => {
  const GENERIC_ES = codeMessage("test.unmapped_code", "es");
  const GENERIC_EN = codeMessage("test.unmapped_code", "en");
  for (const code of [
    "options.invalid",
    "options.not_found",
    "options.translation_required",
    "extras.invalid",
    "extras.not_found",
    "extras.translation_required",
  ]) {
    expect(codeMessage(code, "es")).not.toBe(code);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
    expect(codeMessage(code, "en")).not.toBe(code);
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
  }
});

it("has English and Spanish copy for the two refusals that keep variants out of extras lists", () => {
  for (const code of ["extras.product_has_variants", "product.offered_as_extra"]) {
    expect(codeMessage(code, "en")).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es")).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es")).not.toBe(codeMessage(code, "en"));
  }
});

// The bucket-copy routes' status map (`STATUS` in apps/server/src/stream-api.ts). Its fallback tag,
// `backup.stream_failed`, is a log tag only: the error boundary answers an error that is not an
// application error as `server.internal` (packages/server-kit/src/error-boundary.ts).
it("has English and Spanish copy for every code in the bucket-copy routes' status map", () => {
  for (const code of [
    "management_session.required",
    "management_session.expired",
    "person.suspended",
    "authorization.not_permitted",
    "backup.request_invalid",
    "backup.stream_config_unsafe",
    "backup.managed_by_environment",
    "backup.recovery_key_too_short",
    "backup.not_primary",
    "backup.reload_in_progress",
    "backup.stream_test_failed",
    "backup.stream_not_configured",
    "backup.stream_signer_missing",
    "backup.recovery_key_missing",
    "backup.stream_request_failed",
  ]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("has a sentence for each label code and the category reassignment refusal", () => {
  for (const code of [
    "label.invalid",
    "label.duplicate",
    "label.not_found",
    "category.reassign_invalid",
  ]) {
    expect(codeMessage(code, "en")).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es")).not.toBe(codeMessage("test.unmapped_code", "es"));
  }
});
