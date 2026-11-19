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

it("explains each emergency closure and the code-read wait in both languages", () => {
  for (const locale of ["en", "es"] as const) {
    for (const reason of [
      "setting_off",
      "level_inactive",
      "no_payment_method",
      "not_provisioned",
    ] as const)
      expect(codeMessage("cloud.emergency_hosting_closed", locale, { reason })).toBe(
        { en, es }[locale][`cloud.emergency_${reason}`],
      );
    expect(codeMessage("cloud.emergency_code_rate_limited", locale, { seconds: 17 })).toContain(
      "17",
    );
    expect(codeMessage("cloud.emergency_code_rate_limited", locale, { seconds: 17 })).toContain(
      locale === "en" ? "seconds" : "segundos",
    );
  }
});

it.each([
  ["en", "pair", "Pairing", "try again then"],
  ["es", "forget", "La desvinculación", "inténtalo de nuevo entonces"],
])(
  "explains the running Bluetooth action and retry deadline in %s",
  (locale, kind, action, retry) => {
    const message = codeMessage("printer.bluetooth_command_busy", locale, { kind, seconds: 87 });
    expect(message).toContain(action);
    expect(message).toContain("87");
    expect(message).toContain(retry);
  },
);

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

it("says an inspection-only sign-in reaches Invoices alone, in both languages", () => {
  expect(codeMessage("authorization.inspection_only", "en")).toBe(
    "This sign-in can only see Invoices for the tax office.",
  );
  expect(codeMessage("authorization.inspection_only", "es")).toBe(
    "Esta sesión solo puede ver Facturas para Hacienda.",
  );
});

it("has a sentence for each gate and request-screen code the management routes answer", () => {
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  const GENERIC_EN = "Something went wrong, try again";
  for (const code of [
    "management_session.required",
    "management_session.expired",
    "person.suspended",
    "authorization.not_permitted",
    "authorization.inspection_only",
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

it("has a sentence for a missing menu", () => {
  const GENERIC_ES = "Algo salió mal, inténtalo de nuevo";
  const GENERIC_EN = "Something went wrong, try again";
  expect(codeMessage("menu.not_found", "es")).not.toBe("menu.not_found");
  expect(codeMessage("menu.not_found", "es")).not.toBe(GENERIC_ES);
  expect(codeMessage("menu.not_found", "en")).not.toBe(GENERIC_EN);
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
    "handover.operation_in_progress",
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

it("says a booking's table taken off today is put back from the till, in both languages", () => {
  expect(codeMessage("table.taken_off", "en")).toBe(
    "That table is off today's plan. Put it back from the till, then try again",
  );
  expect(codeMessage("table.taken_off", "es")).toBe(
    "Esa mesa está quitada hoy. Vuelve a ponerla desde la caja e inténtalo de nuevo",
  );
});

it("says a booking's table is in an area with no table service, in both languages", () => {
  expect(codeMessage("service_zone.mode_incompatible", "en")).toBe(
    "That table's area has no table service. Edit the booking and choose a table in an area with table service",
  );
  expect(codeMessage("service_zone.mode_incompatible", "es")).toBe(
    "La zona de esa mesa no tiene servicio de mesa. Edita la reserva y elige una mesa de una zona con servicio de mesa",
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
  expect(codeMessage("person.self_deactivation", "en")).toBe(
    "You cannot disable the account you are signed in with. To disable it, sign out, then sign in with another account that can manage it.",
  );
  expect(codeMessage("person.self_deactivation", "es")).toBe(
    "No puedes deshabilitar la cuenta con la que has iniciado sesión. Para deshabilitarla, cierra la sesión e inicia sesión con otra cuenta que pueda gestionarla.",
  );
  expect(codeMessage("person.suspended", "en")).toBe(
    "The account you were signed in with is disabled. Log in with another account. An account that can manage it can enable it again under Users and send it a new invitation.",
  );
  expect(codeMessage("person.suspended", "es")).toBe(
    "La cuenta con la que habías iniciado sesión está deshabilitada. Inicia sesión con otra cuenta. Una cuenta con permiso para gestionarla puede volver a habilitarla en Usuarios y enviarle una nueva invitación.",
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
    "Invoice email is unavailable. Check the mail server and the Email field on the department's Receipts tab in Departments and zones.",
  );
  expect(codeMessage("invoice_delivery.email_unavailable", "es")).toBe(
    "No se puede enviar la factura por correo. Revisa el servidor de correo y el campo Correo electrónico de la pestaña Recibos del departamento en Departamentos y zonas.",
  );
});

it.each([
  "invoice_delivery.active",
  "invoice_delivery.printer_invalid",
  "invoice_delivery.email_unavailable",
  "invoice_delivery.full_invoice_required",
  "invoice_delivery.not_found",
])("ends %s with a full stop in English and Spanish", (code) => {
  expect(codeMessage(code, "en")).toMatch(/[^.]\.$/);
  expect(codeMessage(code, "es")).toMatch(/[^.]\.$/);
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

it("words a refusal while the start's time is unconfirmed in both languages", () => {
  expect(codeMessage("clock.unconfirmed", "en")).toBe(
    "Not recorded: the box is waiting for its time to be confirmed. Confirm it on the Box status page, or with “Check the time” on a till.",
  );
  expect(codeMessage("clock.unconfirmed", "es")).toBe(
    "No se ha registrado: el servidor espera a que se confirme su hora. Confírmala en Estado del servidor o con «Comprobar la hora» en una caja.",
  );
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

it("says a stopped venue time zone is confirmed by reloading the dashboard, not by somebody else", () => {
  expect(en["venue.time_zone_confirm"]).toContain("Reload the dashboard");
  expect(es["venue.time_zone_confirm"]).toContain("Vuelve a cargar el panel");
  expect(en["venue.time_zone_confirm"]).not.toMatch(/manager/i);
  expect(es["venue.time_zone_confirm"]).not.toMatch(/responsable|encargado/i);
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

it("words a handover a newer list of servers stopped as what happened, not as a fault", () => {
  expect(codeMessage("handover.superseded_during_start", "en")).toBe(
    "Another box took over or the venue’s list of servers changed. Open the current main box’s address to continue.",
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

it.each(["en", "es"] as const)(
  "explains the next step for retained-money refusals (%s)",
  (locale) => {
    for (const code of [
      "bill.allocation_changed",
      "bill.tip_not_allowed",
      "bill.nothing_outstanding",
      "order.payment_in_flight",
      "bill.refund_in_progress",
    ]) {
      expect(codeMessage(code, locale)).not.toBe(codeMessage("unknown.code", locale));
    }
  },
);

it.each([
  ["en", "Orders", "week", "refund receipts", "dashboard"],
  ["es", "Pedidos", "semana", "recibos de devolución", "panel"],
])(
  "explains expired print payloads and their next step in %s",
  (locale, orders, week, refunds, dashboard) => {
    const sale = codeMessage("print_job.sale_payload_expired", locale);
    expect(sale).toContain(orders);
    expect(sale).toContain(dashboard);
    expect(sale).toContain(week);
    const opaque = codeMessage("print_job.payload_expired", locale);
    expect(opaque).toContain(refunds);
    expect(opaque).toContain(week);
    expect(opaque).not.toContain(orders);
  },
);

it("explains an invalid contains tag in both languages", () => {
  expect(codeMessage("diet.invalid_contains_tag", "en")).toBe(
    "Choose a valid dietary contains tag",
  );
  expect(codeMessage("diet.invalid_contains_tag", "es")).toBe(
    "Elige una etiqueta dietética válida",
  );
});

it.each([
  [
    "handover.stepping_down",
    "This server is handing over or has handed over the venue, so it refused this action. Use the main server’s address once that server is taking sales.",
    "Este servidor está traspasando el local o ya lo ha traspasado, así que ha rechazado esta acción. Usa la dirección del servidor principal cuando ese servidor acepte ventas.",
  ],
  [
    "handover.known_handover",
    "This server has already handed over the venue. Open the current main server’s address to continue.",
    "Este servidor ya ha traspasado el local. Abre la dirección del servidor principal actual para continuar.",
  ],
  [
    "handover.peer_unknown",
    "The sending server is not trusted for this request. Check the list of servers on the current main server before trying again.",
    "El servidor que envía la solicitud no está autorizado para hacerla. Revisa la lista de servidores en el servidor principal actual antes de volver a intentarlo.",
  ],
  [
    "handover.not_stepped_down",
    "The old server has not confirmed that it stopped for this handover. Keep both servers connected and check the handover’s progress on the old server.",
    "El servidor antiguo no ha confirmado que se haya detenido para este traspaso. Mantén ambos servidores conectados y consulta el progreso del traspaso en el servidor antiguo.",
  ],
  [
    "handover.operation_unknown",
    "That server has no record of this handover. Open Servers on the current main server to check the current handover.",
    "Ese servidor no tiene constancia de este traspaso. Abre Servidores en el servidor principal actual para consultar el traspaso actual.",
  ],
  [
    "handover.final_copy_changed",
    "The old server’s venue data changed after its final copy was made. Keep both servers connected while the copy is requested again.",
    "Los datos del local en el servidor antiguo han cambiado después de hacer su copia final. Mantén ambos servidores conectados mientras se vuelve a pedir la copia.",
  ],
  [
    "handover.source_unreachable",
    "This server could not complete this handover step. It retries by itself. Check both servers’ power, connections and free disk space, and the old server’s entry in the list of servers.",
    "Este servidor no ha podido completar este paso del traspaso. Lo reintenta solo. Comprueba la alimentación, las conexiones y el espacio libre de ambos servidores, y la entrada del servidor antiguo en la lista de servidores.",
  ],
  [
    "handover.not_a_spare",
    "This server is not a spare and cannot accept this handover. Open Servers on the main server and choose a joined spare.",
    "Este servidor no es de reserva y no puede aceptar este traspaso. Abre Servidores en el servidor principal y elige un servidor de reserva que ya se haya unido.",
  ],
  [
    "handover.membership_mismatch",
    "The servers disagree about the venue or its list of servers, or the sender is not listed as main. Check Servers on the current main server before trying again.",
    "Los servidores no coinciden en el local o en su lista de servidores, o el remitente no figura como principal. Revisa Servidores en el servidor principal actual antes de volver a intentarlo.",
  ],
  [
    "handover.indicator_untrusted",
    "The final copy’s description could not be verified as coming from the old server. Check the list of servers on the current main server before trying again.",
    "No se ha podido verificar que la descripción de la copia final venga del servidor antiguo. Revisa la lista de servidores en el servidor principal actual antes de volver a intentarlo.",
  ],
  [
    "handover.copy_damaged",
    "This copy failed its database check. A controlled handover requests another copy, but that cannot repair invalid data on the old server. If the checks keep failing, use the emergency procedure with a working backup.",
    "Esta copia no ha superado la comprobación de su base de datos. Un traspaso controlado pide otra copia, pero eso no repara datos inválidos en el servidor antiguo. Si las comprobaciones siguen fallando, usa el procedimiento de emergencia con una copia de seguridad válida.",
  ],
  [
    "handover.chain_broken",
    "The records in this copy failed their check, so this server has not taken over. Use the emergency procedure with a backup that passes its checks.",
    "Los registros de esta copia no han superado su comprobación, así que este servidor no ha tomado el relevo. Usa el procedimiento de emergencia con una copia de seguridad que supere las comprobaciones.",
  ],
  [
    "handover.preparation_state_too_large",
    "The saved module preparations leave too little room to accept this handover. This is a fault in Waitron; retrying the same copy will not make that file smaller.",
    "Los preparativos de módulos guardados dejan demasiado poco espacio para aceptar este traspaso. Es un fallo de Waitron; reintentar con la misma copia no reduce ese archivo.",
  ],
  [
    "handover.summary_mismatch",
    "The copy’s contents do not match the old server’s description. Repeating the check does not repair that copy. Use the emergency procedure with a working backup.",
    "El contenido de la copia no coincide con la descripción del servidor antiguo. Repetir la comprobación no repara esa copia. Usa el procedimiento de emergencia con una copia de seguridad válida.",
  ],
  [
    "handover.summary_unreadable",
    "This server could not read the copy’s contents to check them. Keep both servers connected while it retries. If it keeps failing, use the emergency procedure with a working backup.",
    "Este servidor no ha podido leer el contenido de la copia para comprobarlo. Mantén ambos servidores conectados mientras lo reintenta. Si sigue fallando, usa el procedimiento de emergencia con una copia de seguridad válida.",
  ],
  [
    "handover.copy_lacks_destination",
    "This copy has no usable record of this spare. Check the list of servers on the old server; a controlled handover needs a spare that has finished joining.",
    "Esta copia no tiene un registro válido de este servidor de reserva. Revisa la lista de servidores en el servidor antiguo; un traspaso controlado necesita un servidor de reserva que haya terminado de unirse.",
  ],
  [
    "handover.authoriser_not_permitted",
    "The person who authorised this handover lacks Manage boxes permission in this copy. Check their permissions on the main server before starting another handover.",
    "La persona que autorizó este traspaso no tiene permiso de Gestionar servidores en esta copia. Revisa sus permisos en el servidor principal antes de iniciar otro traspaso.",
  ],
  [
    "handover.preparation_state_unusable",
    "This server cannot read or add to its module preparation file, so it has not placed the accepted copy. This is a fault in Waitron or this server’s disk. Retry a normal boot only after that file is repaired.",
    "Este servidor no puede leer o ampliar su archivo de preparación de módulos, así que no ha colocado la copia aceptada. Es un fallo de Waitron o del disco de este servidor. Reintenta un arranque normal solo después de reparar ese archivo.",
  ],
  [
    "handover.accepted_copy_missing",
    "The accepted copy is no longer on this server’s disk. This is a fault in Waitron or this server’s disk. Retry a normal boot only if that copy has been put back.",
    "La copia aceptada ya no está en el disco de este servidor. Es un fallo de Waitron o del disco de este servidor. Reintenta un arranque normal solo si esa copia ha vuelto a su sitio.",
  ],
  [
    "handover.indicator_mismatch",
    "The final copy’s description cannot be read or does not match this handover. Check the handover’s progress on both servers before trying again.",
    "La descripción de la copia final no se puede leer o no corresponde a este traspaso. Consulta el progreso del traspaso en ambos servidores antes de volver a intentarlo.",
  ],
  [
    "handover.copy_check_failed",
    "This server could not finish checking the copy, so it has not taken over. A controlled handover retries by itself. In an emergency, check this copy again, or use a working backup.",
    "Este servidor no ha podido terminar de comprobar la copia, así que no ha tomado el relevo. Un traspaso controlado lo reintenta solo. En una emergencia, vuelve a comprobar esta copia o usa una copia de seguridad válida.",
  ],
  [
    "provisioning.database_ahead",
    "The database contains changes this version of Waitron does not recognise. Install the same or a newer version of Waitron before trying again.",
    "La base de datos contiene cambios que esta versión de Waitron no reconoce. Instala la misma versión de Waitron o una más reciente antes de volver a intentarlo.",
  ],
  [
    "handover.settings_unreadable",
    "This box could not read the settings needed for handover. Choose Stop, restart this box and check its start page before trying again.",
    "Este servidor no ha podido leer los ajustes necesarios para el traspaso. Elige Parar, reinícialo y revisa su página de inicio antes de volver a intentarlo.",
  ],
  [
    "handover.destination_settings_unreadable",
    "The spare could not read the settings needed for handover. Choose Stop, restart the spare and check its start page before trying again.",
    "El servidor de reserva no ha podido leer los ajustes necesarios para el traspaso. Elige Parar, reinícialo y revisa su página de inicio antes de volver a intentarlo.",
  ],
])("gives truthful handover next steps for %s in both languages", (code, english, spanish) => {
  expect(codeMessage(code, "en")).toBe(english);
  expect(codeMessage(code, "es")).toBe(spanish);
});

it("offer-space and key refusals give truthful next steps in EN and ES", () => {
  for (const [locale, copy, reserve, stopped, key, rejoin] of [
    [
      "en",
      "two whole copies",
      "space kept free so the box can start",
      "keeps selling",
      "different",
      "join the spare again",
    ],
    [
      "es",
      "dos copias enteras",
      "espacio que se mantiene libre",
      "sigue vendiendo",
      "distinta",
      "vuelve a unirlo",
    ],
  ] as const) {
    const room = codeMessage("handover.no_room_at_offer", locale);
    expect(room).toContain(copy);
    expect(room).toContain(reserve);
    expect(room).toContain(stopped);
    expect(room).toContain(locale === "en" ? "Stop" : "Parar");
    const keys = codeMessage("handover.key_ring_mismatch", locale);
    expect(keys).toContain(key);
    expect(keys).toContain(rejoin);
  }
});

it("a source preflight refusal keeps trading and names Stop and the handover guide in both languages", () => {
  expect(codeMessage("handover.source_check_failed", "en")).toBe(
    "This box could not verify the venue data for handover. You can keep selling here. Choose Stop and follow the handover guide before trying again.",
  );
  expect(codeMessage("handover.source_check_failed", "es")).toBe(
    "Este servidor no ha podido verificar los datos del local para el traspaso. Puedes seguir vendiendo aquí. Elige Parar y sigue la guía de traspaso antes de volver a intentarlo.",
  );
});

it("says how far a month file had got when the server ran short of space, in the language's style", () => {
  const params = { writtenBytes: 1_200_000_000 };
  expect(codeMessage("tax_office.space_ran_out", "en", params)).toBe(
    "The server ran short of disk space while preparing this file, so it stopped and deleted it. The file had already reached 1.2 GB; free more space than that on the server, for example by keeping fewer backups under Backups, then try again.",
  );
  expect(codeMessage("tax_office.space_ran_out", "es", params)).toBe(
    "El servidor se quedó sin espacio en disco mientras preparaba este archivo, así que lo detuvo y lo borró. El archivo ya ocupaba 1,2 GB; libera más espacio que eso en el servidor, por ejemplo guardando menos copias de seguridad en Copias de seguridad, y vuelve a intentarlo.",
  );
});

it("words the tax office's month-file refusals, with the disk's sizes in the language's style", () => {
  const params = { freeBytes: 2_200_000_000, neededBytes: 2_415_919_104 };
  expect(codeMessage("tax_office.space_low", "en", params)).toBe(
    "The server's disk is nearly full: it has 2.2 GB free, and preparing this file needs 2.4 GB. Keeping fewer backups on the server, under Backups, frees space; then try again.",
  );
  expect(codeMessage("tax_office.space_low", "es", params)).toBe(
    "El disco del servidor está casi lleno: tiene 2,2 GB libres y preparar este archivo necesita 2,4 GB. Guardar menos copias de seguridad en el servidor, en Copias de seguridad, libera espacio; después vuelve a intentarlo.",
  );
  expect(codeMessage("tax_office.download_missing", "en")).toBe(
    "This file is no longer on the server. Choose Download again to prepare it.",
  );
  expect(codeMessage("tax_office.download_missing", "es")).toBe(
    "Este archivo ya no está en el servidor. Elige Descargar para prepararlo de nuevo.",
  );
});

it.each([
  ["en", "setPrice", "0.00 to 10,000.00"],
  ["es", "surcharge", "0,00 a 10.000,00"],
  ["en", "lines", "20 inclusion lines"],
  ["es", "setTakeawayVatClass", "IVA para llevar"],
])("explains an invalid set-menu field in %s (%s)", (locale, field, expected) => {
  expect(codeMessage("set_menu.invalid", locale, { field })).toContain(expected);
});

it.each(["en", "es"])(
  "names the set menu and its problem count in a publication refusal in %s",
  (locale) => {
    const message = codeMessage("set_menu.not_publishable", locale, {
      name: "Daily menu",
      count: 3,
    });
    expect(message).toContain("Daily menu");
    expect(message).toMatch(/3 problem/);
  },
);

it.each([
  ["en", "This dish is no longer on the menu."],
  ["es", "Este plato ya no está en la carta."],
])("explains a missing menu dish in %s", (locale, explanation) => {
  expect(codeMessage("menu_item.not_found", locale)).toContain(explanation);
});
