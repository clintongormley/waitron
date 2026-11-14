import { en, es } from "./strings.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codeMessage, codeOf, fieldOf } from "./codes.js";
import { currentLocale, setLocale, t } from "./t.js";

let previousLocale: string;
beforeEach(() => {
  previousLocale = currentLocale();
  setLocale("es-ES");
});
afterEach(() => setLocale(previousLocale));

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

it("words an office printer refused as a receipt printer in both languages", () => {
  expect(codeMessage("printer.office_printer", "en")).toBe(
    "That is an office printer, not a receipt printer",
  );
  expect(codeMessage("printer.office_printer", "es")).toBe(
    "Es una impresora de oficina, no una impresora de tickets",
  );
});

it("words the office-printer refusals in both languages", () => {
  for (const code of [
    "page_printer.not_found",
    "page_printer.not_printable",
    "page_printer.no_agent",
  ]) {
    for (const locale of ["en", "es"] as const) {
      expect(codeMessage(code, locale)).not.toBe(codeMessage("unknown.code", locale));
    }
  }
  expect(codeMessage("page_printer.not_found", "en")).toBe(
    "That office printer wasn't found. Scan again and retry",
  );
});

it("words an unknown stuck payment in both languages", () => {
  expect(codeMessage("stuck_payment.not_found", "en")).toBe("There is no such stuck payment.");
  expect(codeMessage("stuck_payment.not_found", "es")).toBe("No existe ese cobro pendiente.");
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
  for (const code of ["device_profile.in_use"]) {
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

it("places a translation refusal beside its language's name, and any other by the field it names", () => {
  expect(fieldOf({ code: "menu_section.translation_required", params: { language: "en" } })).toBe(
    "names-en",
  );
  expect(fieldOf({ code: "menu_section.invalid", params: { field: "internalName" } })).toBe(
    "internalName",
  );
  // A translation refusal naming no language falls back like any other.
  expect(fieldOf({ code: "menu_section.translation_required", params: { field: "names" } })).toBe(
    "names",
  );
  expect(fieldOf({ code: "management.request_invalid" })).toBe("_form");
  expect(fieldOf(new Error("down"))).toBe("_form");
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

it("has English and Spanish copy for an archive Save's refusal of unreadable bucket copy settings", () => {
  const code = "backup.stream_settings_unreadable";
  expect(codeMessage(code, "en")).not.toBe(codeMessage("test.unmapped_code", "en"));
  expect(codeMessage(code, "es")).not.toBe(codeMessage("test.unmapped_code", "es"));
  expect(codeMessage(code, "es")).not.toBe(codeMessage(code, "en"));
});

it("has English and Spanish copy for a failed archive bucket test and a key change whose record failed", () => {
  for (const code of ["backup.archive_test_failed", "backup.rotation_metadata_failed"]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("has English and Spanish copy for each way one backup destination's call can fail", () => {
  for (const code of [
    "backup.destination_timed_out",
    "backup.destination_cancelled",
    "backup.destination_key_invalid",
    "backup.destination_object_too_large",
  ]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("has English and Spanish copy for the two refusals that keep variants out of extras lists", () => {
  for (const code of ["extras.product_has_variants", "product.offered_as_extra"]) {
    expect(codeMessage(code, "en")).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es")).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es")).not.toBe(codeMessage(code, "en"));
  }
});

it("has English and Spanish copy for a bucket Save refused while the venue has a standby", () => {
  const code = "backup.spare_stream_active";
  expect(codeMessage(code, "en")).not.toBe(codeMessage("test.unmapped_code", "en"));
  expect(codeMessage(code, "es")).not.toBe(codeMessage("test.unmapped_code", "es"));
  expect(codeMessage(code, "en")).toContain("choose Remove on its row under Servers");
  expect(codeMessage(code, "es")).toContain("elige Retirar en su fila de Servidores");
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
    "backup.recovery_key_too_short",
    "backup.not_primary",
    "backup.reload_in_progress",
    "backup.stream_test_failed",
    "backup.stream_not_configured",
    "backup.archive_namespace_overlap",
    "backup.archive_settings_unreadable",
    "backup.stream_signer_missing",
    "backup.recovery_key_missing",
    "backup.stream_request_failed",
  ]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("has English and Spanish copy for each menu section code", () => {
  for (const code of [
    "menu_section.not_found",
    "menu_section.invalid",
    "menu_section.translation_required",
    "menu_section.member_cycle",
    "menu_section.member_duplicate",
    "menu_section.wrong_role",
    "menu_section.membership_invalid",
  ]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("has English and Spanish copy for each theme code", () => {
  for (const code of ["theme.name_taken", "theme.not_found"]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("has English and Spanish copy for each Device Home Page code", () => {
  for (const code of ["menu.shortcut_unreachable", "menu.home_display_invalid"]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it.each(["en", "es"])(
  "names the Device Home Page in a refused shortcut as the Home page tab's order choice does (%s)",
  (language) => {
    setLocale(language);
    const name = language === "en" ? "device home page" : "página de inicio del dispositivo";
    expect(t("home.order_home_first").toLowerCase()).toContain(name);
    expect(codeMessage("menu.shortcut_unreachable", language).toLowerCase()).toContain(name);
  },
);

it("has English and Spanish copy for each menu publication code", () => {
  for (const code of [
    "menu_publication.overtakes_queued",
    "menu_publication.not_found",
    "menu_publication.not_queued",
    "menu_publication.time_past",
    "menu_publication.unchanged",
    "menu_publication.time_skipped",
    "menu_publication.time_repeated",
    "time_zone.unreadable",
  ]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
  expect(codeMessage("menu_publication.overtakes_queued", "en")).toBe(
    "A version that is already scheduled would go live in the wrong order. Cancel it or change its time, then try again.",
  );
  expect(codeMessage("menu_publication.overtakes_queued", "es")).toBe(
    "Una versión ya programada se publicaría en el orden equivocado. Cancélala o cambia su hora y vuelve a intentarlo.",
  );
});

it("has English and Spanish copy for a publish refused because the menu changed", () => {
  const code = "menu.changed_since_preview";
  expect(codeMessage(code, "en")).toBe(
    "This menu changed after the preview was shown, so it was not published. Check the new preview and publish again.",
  );
  expect(codeMessage(code, "es")).toBe(
    "Esta carta ha cambiado después de mostrar la vista previa, así que no se ha publicado. Revisa la nueva vista previa y vuelve a publicarla.",
  );
});

it("has English and Spanish copy for each refusal of a live menu patch", () => {
  const english: Record<string, string> = {
    "menu_patch.base_changed":
      "Another version went live while you were patching. Reload to patch it instead; changes that still fit are kept.",
    "menu_patch.unchanged": "These values are already live. Nothing was saved.",
    "menu_patch.not_published":
      "This menu has never been published, so there is nothing live to patch. Publish it first.",
    "menu_patch.invalid": "Check this value.",
  };
  const spanish: Record<string, string> = {
    "menu_patch.base_changed":
      "Otra versión se ha publicado mientras corregías la carta. Vuelve a cargar para corregir esa versión; se conservan las correcciones que todavía encajan.",
    "menu_patch.unchanged": "Estos valores ya están publicados. No se ha guardado nada.",
    "menu_patch.not_published":
      "Esta carta no se ha publicado nunca, así que no hay nada publicado que corregir. Publícala primero.",
    "menu_patch.invalid": "Revisa este valor.",
  };
  for (const [code, text] of Object.entries(english)) {
    expect(codeMessage(code, "en"), code).toBe(text);
    expect(codeMessage(code, "es"), code).toBe(spanish[code]);
  }
});

it("has a sentence of its own for each refusal of a stuck card payment's check", () => {
  const GENERIC_EN = codeMessage("test.unmapped_code", "en");
  const GENERIC_ES = codeMessage("test.unmapped_code", "es");
  for (const code of [
    "payment.not_stuck",
    "payment.resolve_unsupported",
    "payment.outcome_unknown",
  ]) {
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
  }
});

it("has the sentence of its own for each refusal of recording a held payment's outcome", () => {
  expect(codeMessage("payment.hold_not_found", "en")).toBe("That payment is no longer held.");
  expect(codeMessage("payment.hold_not_found", "es")).toBe("Ese pago ya no está retenido.");
  expect(codeMessage("payment.hold_already_recorded", "en")).toBe(
    "Someone has already recorded what was done with that payment.",
  );
  expect(codeMessage("payment.hold_already_recorded", "es")).toBe(
    "Alguien ya ha registrado qué se hizo con ese pago.",
  );
});

it("has a sentence in both languages for each refusal of a manager's action on a bill payment or refund", () => {
  const GENERIC_EN = codeMessage("test.unmapped_code", "en");
  const GENERIC_ES = codeMessage("test.unmapped_code", "es");
  for (const code of [
    "bill.payment_not_found",
    "bill.payment_not_stuck",
    "bill.payment_outcome_unconfirmed",
    "bill.refund_not_found",
    "bill.refund_not_stuck",
    "bill.refund_outcome_unconfirmed",
    "bill.attestation_contradicted",
    "pin.invalid",
    "pin.throttled",
    "payment.not_refundable",
    "payment.refund_exceeds_capture",
  ]) {
    expect(codeMessage(code, "en"), code).not.toBe(GENERIC_EN);
    expect(codeMessage(code, "es"), code).not.toBe(GENERIC_ES);
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("has a sentence in both languages for each refusal of a server's removal", () => {
  const GENERIC_EN = codeMessage("test.unmapped_code", "en");
  const GENERIC_ES = codeMessage("test.unmapped_code", "es");
  for (const code of [
    "membership.node_not_found",
    "membership.not_primary",
    "membership.node_is_primary",
    "membership.node_has_served",
    "membership.standby_joined",
    "membership.write_contended",
  ]) {
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
    expect(codeMessage(code, "es")).not.toBe(codeMessage(code, "en"));
  }
});

it.each([
  ["membership.standby_joined", "switched off", "apagado"],
  ["backup.spare_stream_active", "then save again", "vuelve a guardar"],
  [
    "handover.operation_in_progress",
    "before starting another handover or removing a server",
    "antes de iniciar otro traspaso o retirar un servidor",
  ],
])("words %s as the next step a person can take", (code, enStep, esStep) => {
  expect(codeMessage(code, "en")).toContain(enStep);
  expect(codeMessage(code, "es")).toContain(esStep);
  for (const language of ["en", "es"] as const)
    expect(codeMessage(code, language)).not.toMatch(/cannot be removed|no se puede retirar/);
});

it("has a sentence in both languages for each refusal of clearing a server", () => {
  const GENERIC_EN = codeMessage("test.unmapped_code", "en");
  const GENERIC_ES = codeMessage("test.unmapped_code", "es");
  for (const code of [
    "membership.node_not_removed",
    "membership.chart_too_large",
    "membership.cleared_list_full",
    "membership.revoked_duplicate",
    "membership.revoked_node_listed",
  ]) {
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
    expect(codeMessage(code, "es")).not.toBe(codeMessage(code, "en"));
  }
  for (const language of ["en", "es"] as const) {
    expect(codeMessage("membership.cleared_list_full", language)).not.toBe(
      codeMessage("membership.chart_too_large", language),
    );
  }
});

it("words the refusals Remove and Clear share so they fit both actions", () => {
  for (const code of ["membership.not_primary", "membership.node_is_primary"]) {
    expect(codeMessage(code, "en")).toMatch(/remove.*clear|clear.*remove/i);
    expect(codeMessage(code, "es")).toMatch(/retirar.*quitar|quitar.*retirar/i);
  }
});

it("has English and Spanish copy for each unit code", () => {
  for (const code of [
    "unit.precision_invalid",
    "unit.not_found",
    "unit.in_use",
    "unit.translation_required",
  ]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("says a booking's table needs clearing on the till first, in both languages", () => {
  expect(codeMessage("table.needs_clearing", "en")).toBe(
    "That table needs clearing first. Mark it cleared on the till, then try again",
  );
  expect(codeMessage("table.needs_clearing", "es")).toBe(
    "Esa mesa está por recoger. Márcala como recogida en la caja e inténtalo de nuevo",
  );
});

it("says a booking's table needs moving on the till first, in both languages", () => {
  expect(codeMessage("table.needs_moving", "en")).toBe(
    "That table needs moving first. Mark it moved on the till, then try again",
  );
  expect(codeMessage("table.needs_moving", "es")).toBe(
    "Esa mesa está por mover. Márcala como movida en la caja e inténtalo de nuevo",
  );
});

it("has a sentence of its own for an unsupported language, in both languages", () => {
  expect(codeMessage("locale.unsupported", "en")).toBe(
    "That language isn't available. Choose another.",
  );
  expect(codeMessage("locale.unsupported", "es")).toBe(
    "Ese idioma no está disponible. Elige otro.",
  );
});

it("says a required content language cannot be removed, in both languages", () => {
  expect(codeMessage("content.language_required", "en")).toBe(
    "Waitron keeps this language enabled for venues in this region, so it cannot be removed.",
  );
  expect(codeMessage("content.language_required", "es")).toBe(
    "Waitron mantiene este idioma activado en los locales de esta región, así que no se puede quitar.",
  );
});

it("says why a receipt language cannot be changed, in both languages", () => {
  expect(codeMessage("receipt.language_fixed", "en")).toBe(
    "This venue's region fixes the receipt language, so another one cannot be chosen.",
  );
  expect(codeMessage("receipt.language_fixed", "es")).toBe(
    "La región del local fija el idioma del recibo, así que no se puede elegir otro.",
  );
  expect(codeMessage("receipt.language_orders_open", "en")).toBe(
    "Some orders at this venue are still in progress in the current receipt language, so it cannot be changed yet.",
  );
  expect(codeMessage("receipt.language_orders_open", "es")).toBe(
    "Algunos pedidos de este local siguen en curso en el idioma actual del recibo, así que todavía no se puede cambiar.",
  );
});

it("says a category delete deleted nothing because the categories' contents changed", () => {
  expect(codeMessage("category.contents_changed", "en")).toBe(
    "What these categories hold has changed, so nothing was deleted. Check the new counts and try again.",
  );
  expect(codeMessage("category.contents_changed", "es")).toBe(
    "Lo que contienen estas categorías ha cambiado, así que no se ha eliminado nada. Revisa las nuevas cifras y vuelve a intentarlo.",
  );
});

it("says a printer a device cannot use may have been disabled, in the Printers screen's word", () => {
  expect(codeMessage("device.binding_invalid", "en")).toBe(
    "This profile cannot use that printer or card reader, or it has been disabled. Choose another",
  );
  expect(codeMessage("device.binding_invalid", "es")).toBe(
    "Este perfil no puede usar esa impresora o lector de tarjetas, o se ha deshabilitado. Elige otro",
  );
});

it("says disabled, never deactivated, for a record that is switched off and kept", () => {
  expect(codeMessage("person.self_deactivation", "es")).toBe(
    "No puedes deshabilitar tu propia cuenta. Pídeselo a otro administrador.",
  );
  expect(codeMessage("person.suspended", "es")).toBe(
    "Esta cuenta está deshabilitada. Avisa a un responsable",
  );
  expect(codeMessage("payment.provider_in_use", "es")).toBe(
    "Elimina o desvincula los lectores de tarjetas de este proveedor antes de desconectarlo",
  );
});

it("explains that unsupported published menus require a venue reset in both languages", () => {
  expect(codeMessage("menu.reset_required", "en")).toBe(
    "This venue has a menu in an unsupported format. Reset the venue before using menus.",
  );
  expect(codeMessage("menu.reset_required", "es-ES")).toBe(
    "Este local tiene una carta en un formato no compatible. Restablece el local antes de usar las cartas.",
  );
});

it("tells a person whose variant can no longer be used to refresh the page and try again, in English and Spanish", () => {
  expect(codeMessage("product.variant_not_found", "en")).toBe(
    "This variant can no longer be used here. Refresh the page and try again.",
  );
  expect(codeMessage("product.variant_not_found", "es")).toBe(
    "Esta variante ya no se puede usar aquí. Actualiza la página y vuelve a intentarlo.",
  );
});

it("says a product that no longer exists needs a refresh, in English and Spanish", () => {
  expect(codeMessage("product.not_found", "en")).toBe(
    "This product no longer exists. Refresh the page and try again.",
  );
  expect(codeMessage("product.not_found", "es")).toBe(
    "Este producto ya no existe. Actualiza la página y vuelve a intentarlo.",
  );
});

it.each([
  "content.translation_stale",
  "content.translation_unavailable",
  "content.translation_batch_invalid",
  "content.translation_refused",
])("has actionable English and Spanish copy for %s", (code) => {
  for (const language of ["en", "es"]) {
    expect(codeMessage(code, language)).not.toBe(codeMessage("unmapped", language));
  }
});

it("says a card reader the provider could not unpair is left unavailable, in English and Spanish", () => {
  expect(codeMessage("reader.unpair_failed", "en")).toBe(
    "The provider did not confirm the unpairing. The reader is unavailable; try again.",
  );
  expect(codeMessage("reader.unpair_failed", "es")).toBe(
    "El proveedor no confirmó la desvinculación. El lector no está disponible; inténtalo de nuevo.",
  );
});

it("says a card reader another request is unpairing or deleting can be tried again, in English and Spanish", () => {
  expect(codeMessage("reader.unpair_in_progress", "en")).toBe(
    "That card reader is being unpaired or deleted. Try again when that finishes.",
  );
  expect(codeMessage("reader.unpair_in_progress", "es")).toBe(
    "Ese lector de tarjetas se está desvinculando o eliminando. Vuelve a intentarlo cuando termine.",
  );
});

it.each(["en", "es"])("hierarchy deletion refusals have actionable %s messages", (language) => {
  for (const code of [
    "service_zone.not_found",
    "department.not_found",
    "department.last_active",
    "zone.order_in_progress",
    "zone.transfer_pending",
    "zone.profile_in_use",
    "department.order_in_progress",
    "department.transfer_pending",
    "department.profile_in_use",
    "zone.table_in_use",
    "table.delivery_in_progress",
    "table.booked",
  ]) {
    expect(codeMessage(code, language)).not.toBe(codeMessage("test.unmapped_code", language));
    expect(codeMessage(code, language)).not.toBe(code);
  }
});

it("explains why an extra cannot move independently in both languages", () => {
  expect(codeMessage("ticket.extra_not_movable", "en")).toBe("Extras cannot be moved separately");
  expect(codeMessage("ticket.extra_not_movable", "es")).toBe(
    "Los extras no se pueden pasar por separado",
  );
});

it("has its own English and Spanish copy for a reader id the provider does not know", () => {
  const code = "reader.reference_unknown";
  expect(codeMessage(code, "en")).toBe("The payment provider has no reader with this ID");
  expect(codeMessage(code, "es")).toBe("El proveedor de pagos no tiene ningún lector con este ID");
});

it("ends the already-waiting delivery refusal with a full stop, like the delivery lines beside it", () => {
  expect(codeMessage("invoice_delivery.active", "en")).toBe(
    "This invoice is already waiting for delivery. Check its status before trying again.",
  );
  expect(codeMessage("invoice_delivery.active", "es")).toBe(
    "Esta factura ya está pendiente de entrega. Comprueba su estado antes de intentarlo de nuevo.",
  );
});

// The order detail's email routes (`STATUS` in apps/server/src/orders-api.ts, and the codes
// `requestEmailDelivery` and `retryEmailDelivery` throw).
it("says what to check when invoice email is unavailable, in English and Spanish", () => {
  expect(codeMessage("invoice_delivery.email_unavailable", "en")).toBe(
    "Invoice email is unavailable. Check the mail server and the Email field on the department's Receipts tab in Departments and zones",
  );
  expect(codeMessage("invoice_delivery.email_unavailable", "es")).toBe(
    "No se puede enviar la factura por correo. Revisa el servidor de correo y el campo Correo electrónico de la pestaña Recibos del departamento en Departamentos y zonas",
  );
});

// The order detail's Print invoice and Download PDF routes (`STATUS` in apps/server/src/orders-api.ts,
// and the codes `requestPrintDelivery` and `readInvoiceDocument` throw).
it("has English and Spanish copy for every refusal of Print invoice and Download PDF", () => {
  for (const code of [
    "device.forbidden_action",
    "invoice_delivery.active",
    "invoice_delivery.printer_invalid",
    "invoice_delivery.full_invoice_required",
    "invoice_delivery.not_found",
    "submission.id_reused",
    "working_order.not_found",
    "authorization.not_permitted",
  ]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("says a box holds no recovery key rather than asking for one to be entered, since Edit and the recovery pack reach it", () => {
  expect(codeMessage("backup.recovery_key_missing", "en")).toBe("This box holds no recovery key.");
  expect(codeMessage("backup.recovery_key_missing", "es")).toBe(
    "Este servidor no tiene clave de recuperación.",
  );
});

it("words each Translate all code in both languages", () => {
  for (const code of [
    "content.suggestion_job_running",
    "content.suggestion_consent_required",
    "content.suggestion_limit_reached",
    "content.suggestion_service_unavailable",
    "content.suggestion_expired",
    "content.suggestion_not_found",
  ])
    for (const locale of ["en", "es"] as const)
      expect(codeMessage(code, locale)).not.toBe(codeMessage("unknown.code", locale));
  expect(codeMessage("content.suggestion_limit_reached", "en")).toBe(
    "This month's translation limit is reached.",
  );
  expect(codeMessage("content.suggestion_limit_reached", "es")).toBe(
    "Se ha alcanzado el límite de traducción de este mes.",
  );
});

it("explains each manager refusal for a post-invoice refund in both languages", () => {
  for (const code of [
    "tender.refund_not_found",
    "tender.refund_not_stuck",
    "tender.refund_outcome_unconfirmed",
    "tender.attestation_contradicted",
  ]) {
    for (const language of ["en", "es"] as const) {
      const message = codeMessage(code, language);
      expect(message, code).not.toBe(codeMessage("test.unmapped_code", language));
      expect(message.length, code).toBeGreaterThan(15);
    }
  }
});

it("words a missing or expired clock check in both languages", () => {
  expect(codeMessage("clock.check_expired", "en")).toBe("The check took too long. Try again.");
  expect(codeMessage("clock.check_expired", "es")).toBe(
    "La comprobación ha tardado demasiado. Vuelve a intentarlo.",
  );
});

it("words a refused confirmation of the clock in both languages", () => {
  expect(codeMessage("clock.confirm_refused", "en")).toBe(
    "The clock could not be confirmed. Look at the Box status page.",
  );
  expect(codeMessage("clock.confirm_refused", "es")).toBe(
    "No se ha podido confirmar la hora. Mira Estado del servidor.",
  );
});

it("words a refusal while the start's time is unconfirmed in both languages", () => {
  expect(codeMessage("clock.unconfirmed", "en")).toBe(
    "Not recorded: the box is waiting for its time to be confirmed. Use “Check the time” on a till.",
  );
  expect(codeMessage("clock.unconfirmed", "es")).toBe(
    "No se ha registrado: el servidor espera a que se confirme su hora. Usa «Comprobar la hora» en una caja.",
  );
});

it("words a note refused on an already handled alert in both languages", () => {
  expect(codeMessage("alert.already_handled", "en")).toBe(
    "This alert was already marked handled, so the note was not saved. Add it from Handled lists on the Box status page.",
  );
  const spanish = codeMessage("alert.already_handled", "es");
  expect(spanish).not.toBe(codeMessage("unknown.code", "es"));
  expect(spanish).not.toBe(codeMessage("alert.already_handled", "en"));
});

it("words a refused note on an alert in both languages", () => {
  expect(codeMessage("alert.note_exists", "en")).toBe(
    "This alert already has a note, which cannot be changed. Close this window to see it under Handled lists.",
  );
  expect(codeMessage("alert.not_handled", "en")).toBe(
    "This alert has not been marked handled yet. Close this window and use Mark handled, which takes a note too.",
  );
  for (const code of ["alert.note_exists", "alert.not_handled"]) {
    const spanish = codeMessage(code, "es");
    expect(spanish).not.toBe(codeMessage("unknown.code", "es"));
    expect(spanish).not.toBe(codeMessage(code, "en"));
  }
});

it("words a short name another table already uses, in English and Spanish", () => {
  const code = "table.short_name_taken";
  expect(codeMessage(code, "en")).toBe("Another table already uses that short name");
  const spanish = codeMessage(code, "es");
  expect(spanish).not.toBe(codeMessage("unknown.code", "es"));
  expect(spanish).not.toBe(codeMessage(code, "en"));
});

it("has English and Spanish copy for a recovery pack asked for insecurely or from another site", () => {
  for (const code of ["recovery.pack_connection_insecure", "recovery.pack_origin_refused"]) {
    expect(codeMessage(code, "en"), code).not.toBe(codeMessage("test.unmapped_code", "en"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage("test.unmapped_code", "es"));
    expect(codeMessage(code, "es"), code).not.toBe(codeMessage(code, "en"));
  }
});

it("has English and Spanish copy for a change sent from another page", () => {
  const code = "management.origin_refused";
  expect(codeMessage(code, "en")).not.toBe(codeMessage("test.unmapped_code", "en"));
  expect(codeMessage(code, "es")).not.toBe(codeMessage("test.unmapped_code", "es"));
  expect(codeMessage(code, "es")).not.toBe(codeMessage(code, "en"));
});

it("has English and Spanish copy for a recovery pack request the box could not read", () => {
  const code = "recovery.pack_invalid";
  expect(codeMessage(code, "en")).not.toBe(codeMessage("test.unmapped_code", "en"));
  expect(codeMessage(code, "es")).not.toBe(codeMessage("test.unmapped_code", "es"));
  expect(codeMessage(code, "es")).not.toBe(codeMessage(code, "en"));
});

it("has a sentence in both languages for the box's refused or failed clock set", () => {
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  const GENERIC_EN = "Something went wrong, try again";
  for (const code of ["clock.set_refused", "clock.set_failed"]) {
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
  }
});

it.each([
  ["unchecked", "venue.time_zone_wait"],
  ["missing", "venue.time_zone_confirm"],
  ["invalid", "venue.time_zone_confirm"],
  ["restart_required", "venue.time_zone_restart"],
  ["unexpected", "venue.time_zone_wait"],
] as const)("explains zone admission %s without offering the wrong action", (reason, key) => {
  expect(codeMessage("venue.time_zone_not_ready", "en-GB", { reason })).toBe(en[key]);
  expect(codeMessage("venue.time_zone_not_ready", "es-ES", { reason })).toBe(es[key]);
  expect(codeMessage("venue.time_zone_not_ready", "en-GB", { reason })).not.toBe(
    codeMessage("unknown", "en-GB"),
  );
});

describe("receipt language refusal while orders are open", () => {
  const code = "receipt.language_orders_open";

  it("names a single open order in English and Spanish", () => {
    expect(codeMessage(code, "en-GB", { count: 1 })).toBe(
      "1 order at this venue is still in progress in the current receipt language, so it cannot be changed yet.",
    );
    expect(codeMessage(code, "es-ES", { count: 1 })).toBe(
      "1 pedido de este local sigue en curso en el idioma actual del recibo, así que todavía no se puede cambiar.",
    );
  });

  it("names how many open orders in English and Spanish", () => {
    expect(codeMessage(code, "en-GB", { count: 3 })).toBe(
      "3 orders at this venue are still in progress in the current receipt language, so it cannot be changed yet.",
    );
    expect(codeMessage(code, "es-ES", { count: 3 })).toBe(
      "3 pedidos de este local siguen en curso en el idioma actual del recibo, así que todavía no se puede cambiar.",
    );
  });

  it("keeps the general sentence when the refusal carries no count", () => {
    for (const params of [undefined, {}, { count: "3" }]) {
      expect(codeMessage(code, "en-GB", params)).toBe(
        "Some orders at this venue are still in progress in the current receipt language, so it cannot be changed yet.",
      );
      expect(codeMessage(code, "es-ES", params)).toBe(
        "Algunos pedidos de este local siguen en curso en el idioma actual del recibo, así que todavía no se puede cambiar.",
      );
    }
  });
});

it("has a sentence in both languages for these handover refusals", () => {
  const GENERIC_EN = codeMessage("test.unmapped_code", "en");
  const GENERIC_ES = codeMessage("test.unmapped_code", "es");
  for (const code of [
    "handover.request_invalid",
    "handover.step_out_of_order",
    "handover.promotion_running",
    "handover.superseded_during_start",
  ]) {
    expect(codeMessage(code, "en")).not.toBe(GENERIC_EN);
    expect(codeMessage(code, "es")).not.toBe(GENERIC_ES);
    expect(codeMessage(code, "es")).not.toBe(codeMessage(code, "en"));
  }
});

it("words a handover a newer list of boxes stopped as what happened, not as a fault", () => {
  expect(codeMessage("handover.superseded_during_start", "en")).toBe(
    "Another box took over or the venue’s list of boxes changed. Open the current main box’s address to continue.",
  );
  expect(codeMessage("handover.superseded_during_start", "es")).toBe(
    "Otro servidor ha pasado a llevar el local o ha cambiado la lista de servidores. Abre la dirección del servidor principal actual para continuar.",
  );
});

it("keeps the fault wording for a true restriction conflict", () => {
  expect(codeMessage("handover.restriction_conflict", "en")).toContain("fault in Waitron");
  expect(codeMessage("handover.restriction_conflict", "es")).toContain("fallo de Waitron");
});

it("words a test email no longer in the inbox in both languages", () => {
  expect(codeMessage("email.message_not_found", "en")).toBe(
    "That email is no longer in the test inbox",
  );
  expect(codeMessage("email.message_not_found", "es")).toBe(
    "Ese correo ya no está en el buzón de prueba",
  );
});

// A deferred close's refusals (apps/server/src/deferred-close.ts).
it.each([
  [
    "deferred_close.ineligible",
    "This bill can't be closed as a deferred payment: it has already been paid, changed or cancelled, it belongs to another server, or its total is zero",
    "Esta cuenta no se puede cerrar como pago aplazado: ya se ha pagado, modificado o anulado, pertenece a otro servidor o su total es cero",
  ],
  [
    "deferred_close.conflict",
    "This bill's total or invoice details have changed since you opened it. Reload the bill, check them and try again",
    "El total o los datos de factura de esta cuenta han cambiado desde que la abriste. Vuelve a cargarla, revísalos e inténtalo de nuevo",
  ],
  [
    "deferred_close.day_frozen",
    "This business day already has its daily close. Close the bill as a deferred payment once the next business day starts",
    "Este día de trabajo ya tiene su cierre diario. Cierra la cuenta como pago aplazado cuando empiece el siguiente día de trabajo",
  ],
])("explains close-deferred refusal %s in English and Spanish", (code, english, spanish) => {
  expect(codeMessage(code, "en")).toBe(english);
  expect(codeMessage(code, "es")).toBe(spanish);
});

it("says a standby server cannot be switched on from another device, in English and Spanish", () => {
  expect(codeMessage("promotion.from_box_only", "en")).toBe(
    "In this version a standby server cannot be switched on from another device. Nothing was changed.",
  );
  expect(codeMessage("promotion.from_box_only", "es")).toBe(
    "En esta versión, un servidor en espera no se puede activar desde otro dispositivo. No se ha cambiado nada.",
  );
});

it("the backup-settings refusal says this box keeps selling and to try again in a minute", () => {
  expect(codeMessage("handover.backup_settings_differ", "en")).toBe(
    "The spare does not hold this box's backup settings, so it did not accept the handover. This box keeps selling, and sends the spare its settings by itself. Try again in a minute.",
  );
  expect(codeMessage("handover.backup_settings_differ", "es")).toBe(
    "El servidor de reserva no tiene los ajustes de copia de seguridad de este servidor, así que no ha aceptado el traspaso. Este servidor sigue vendiendo y le envía sus ajustes solo. Vuelve a intentarlo dentro de un minuto.",
  );
});
