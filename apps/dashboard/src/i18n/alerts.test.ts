import { describe, expect, it } from "vitest";
import { alertMessage, hasAlertMessage } from "./alerts.js";
import { ALERT_MESSAGES, ALERT_WORDS } from "./alert-messages.js";
import { formatIsoMinute } from "../date-utils.js";
import { t } from "./t.js";

it("registers the dashboard's alert wording on import", () => {
  expect(hasAlertMessage("payment.offline_forward_declined")).toBe(true);
  expect(
    alertMessage("payment.offline_forward_declined", { amount: "12.50", paymentRef: "pi_1" }, "en"),
  ).toBe(
    "A card payment of €12.50 taken while offline was declined when it was sent on (reference pi_1). Collect the money another way.",
  );
});

it("explains station output failures in English and Spanish without promising rerouting", () => {
  for (const code of [
    "station.printer_down",
    "station.default_printer_down",
    "station.screens_dark",
    "station.default_screens_dark",
  ]) {
    const en = alertMessage(code, { station: "Grill", printer: "Epson" }, "en");
    const es = alertMessage(code, { station: "Grill", printer: "Epson" }, "es");
    expect(en, code).toContain("Grill");
    expect(es, code).toContain("Grill");
    if (code !== "station.printer_down") {
      expect(en, code).toContain("till's station view");
      expect(es, code).toContain("vista de estación del TPV");
    }
  }
});

it("names a dark pass screen or monitor and points to the till's Pass view", () => {
  for (const code of ["kitchen_screen.pass_dark", "kitchen_screen.pass_monitor_dark"]) {
    const en = alertMessage(code, { device: "Front pass" }, "en");
    const es = alertMessage(code, { device: "Front pass" }, "es");
    expect(en, code).toContain("Front pass");
    expect(es, code).toContain("Front pass");
    expect(en, code).toContain("till's Pass view");
    expect(es, code).toContain("vista de pase del TPV");
  }
});

// The clock only raises this for a clock that reads earlier, so the number is never positive: a
// backward step under a second is stored, and shown, as 0.
it("reads a backwards clock jump correctly with its negative number", () => {
  const params = { wallClockDeltaSeconds: -120, monotonicElapsedSeconds: 0 };
  expect(alertMessage("clock.jump_detected", params, "en")).toBe(
    "This device's clock went backwards: it changed by -120 seconds. Check its date and time.",
  );
  expect(alertMessage("clock.jump_detected", params, "es")).toBe(
    "La hora de este equipo ha retrocedido: ha cambiado -120 segundos. Revisa su fecha y hora.",
  );
});

it("shows every amount an alert carries with the euro sign, where each language writes it", () => {
  const cases: [string, Record<string, unknown>, string, string][] = [
    [
      "payment.offline_forward_declined",
      { amount: "1279.50", paymentRef: "pi_1" },
      "A card payment of €1,279.50 taken",
      "Un pago con tarjeta de 1279,50\u00a0€ cobrado",
    ],
    [
      "payment.bill_capture_mismatch",
      { captured: "30.00", expected: "25.50" },
      "charged €30.00 for a payment towards a bill that should have been €25.50.",
      "cobró 30,00\u00a0€ por un pago a cuenta de una cuenta que debía ser de 25,50\u00a0€.",
    ],
    [
      "payment.bill_settle_failed",
      { amount: "12.00" },
      "A card payment of €12.00 towards",
      "un pago de 12,00\u00a0€ a cuenta",
    ],
    [
      "payment.refund_outcome_conflict",
      { amount: "4.20" },
      "a refund of €4.20 as made",
      "una devolución de 4,20\u00a0€ que",
    ],
    [
      "payment.refund_unresolved",
      { amount: "4.20" },
      "A card refund of €4.20 has been",
      "Una devolución con tarjeta de 4,20\u00a0€ lleva",
    ],
  ];
  for (const [code, params, en, es] of cases) {
    expect(alertMessage(code, params, "en-GB"), code).toContain(en);
    expect(alertMessage(code, params, "es-ES"), code).toContain(es);
  }
});

it("names the dishes a paid order could not send to the kitchen", () => {
  const params = {
    dishes: "Croquetas, Pulpo",
    workingOrderId: "w1",
    orderNumber: 42,
    orderLabel: null,
  };
  expect(alertMessage("route.dish_not_sent", params, "en")).toBe(
    "Paid order 42 has dishes no prep station could take: Croquetas, Pulpo. They were not sent to the kitchen. Pass them to the kitchen by hand, and check the Prep stations page: a closed station with no replacement, or no active default station, leaves a dish nowhere to go.",
  );
  expect(alertMessage("route.dish_not_sent", params, "es")).toBe(
    "El pedido pagado 42 tiene platos que ninguna estación de preparación podía recibir: Croquetas, Pulpo. No se han enviado a cocina. Pásalos a cocina a mano y revisa la página de Estaciones de preparación: una estación cerrada sin sustituta, o ninguna estación predeterminada activa, deja un plato sin destino.",
  );
});

it("explains a release into a closed station in English and Spanish", () => {
  const params = {
    station: "Upstairs bar",
    dishes: "Mojito, Chips",
    workingOrderId: "w1",
    orderNumber: 42,
    orderLabel: "Table 3",
  };
  expect(alertMessage("route.released_at_closed_station", params, "en")).toBe(
    "Order 42: Mojito, Chips went to Upstairs bar, which is closed or disabled, and the prep station rules sent them nowhere else. If nobody is making them there, move them to another station from the till (Move to station…), or open Upstairs bar for today on the Prep stations page. Dishes left at a closed station later do not add to this alert while it is open, so there may be more.",
  );
  expect(alertMessage("route.released_at_closed_station", params, "es")).toBe(
    "Pedido 42: Mojito, Chips se enviaron a Upstairs bar, que está cerrada o deshabilitada, y las reglas de las estaciones de preparación no los enviaron a ningún otro sitio. Si nadie los está preparando allí, pásalos a otra estación desde el TPV (Cambiar de estación…) o abre Upstairs bar por hoy en la página de Estaciones de preparación. Los platos que queden más tarde en una estación cerrada no se añaden a esta alerta mientras esté abierta, así que puede haber más.",
  );
});

it("marks every amount slot in the alert wording as money", () => {
  const unmarked = Object.entries(ALERT_MESSAGES).flatMap(([code, entry]) =>
    [entry, entry.one, ...Object.values(entry.variants ?? {})]
      .flatMap((words) => (words ? [words.en, words.es] : []))
      .flatMap((text) =>
        [...text.matchAll(/\{(amount|captured|expected)\}/g)].map((m) => `${code}: ${m[0]}`),
      ),
  );
  expect(unmarked).toEqual([]);
});

it("names the undelivered full invoice, and says how to hand an unclaimed one to an agent", () => {
  const params = { invoice: "F1A/7", printer: "Back office" };
  for (const code of [
    "invoice_delivery.failed",
    "invoice_delivery.uncertain",
    "invoice_delivery.office_printer_unclaimed",
  ]) {
    expect(alertMessage(code, params, "en"), code).toContain("F1A/7");
    expect(alertMessage(code, params, "es"), code).toContain("F1A/7");
  }
  const en = alertMessage("invoice_delivery.office_printer_unclaimed", params, "en");
  const es = alertMessage("invoice_delivery.office_printer_unclaimed", params, "es");
  expect(en).toContain("Back office");
  expect(en).toContain("Add a printer");
  expect(en).toContain("“Use this agent”");
  expect(es).toContain("Back office");
  expect(es).toContain("Añadir impresora");
  expect(es).toContain("«Usar este agente»");
  // Only a manager holds `printer.manage`; a supervisor sees this alert too.
  expect(en).toContain("A manager can open Add a printer");
  expect(es).toContain("Un responsable puede abrir Añadir impresora");
});

it("says an uncertain invoice may not have arrived in two short sentences", () => {
  const params = { invoice: "F1A/7" };
  expect(alertMessage("invoice_delivery.uncertain", params, "en")).toBe(
    "Full invoice F1A/7 may not have reached its customer. Check before sending it again.",
  );
  expect(alertMessage("invoice_delivery.uncertain", params, "es")).toBe(
    "Puede que la factura completa F1A/7 no haya llegado a su cliente. Compruébalo antes de volver a enviarla.",
  );
});

describe("an invoice the office printer is holding", () => {
  const holds = {
    paper_out: ["It is out of paper: load paper.", "No tiene papel: carga papel."],
    paper_jam: [
      "Paper is jammed in it: clear the jam.",
      "Tiene un atasco de papel: retira el papel atascado.",
    ],
    cover_open: [
      "A cover or door is open: close it.",
      "Tiene una tapa o una puerta abierta: ciérrala.",
    ],
    tray_missing: [
      "A paper tray is missing: put it back.",
      "Le falta una bandeja de papel: vuelve a colocarla.",
    ],
    ink_or_toner_out: [
      "It is out of ink or toner: replace the cartridge.",
      "Se ha quedado sin tinta o sin tóner: cambia el cartucho.",
    ],
    output_full: [
      "Its output tray is full or missing: empty it or put it back.",
      "Su bandeja de salida está llena o no está puesta: vacíala o vuelve a colocarla.",
    ],
    paused: [
      "It is paused: resume it on the printer itself.",
      "Está en pausa: reanúdala en la propia impresora.",
    ],
    stopped: [
      "It has stopped: check the printer for what it needs.",
      "Se ha detenido: revisa qué necesita la impresora.",
    ],
  } as const;

  it.each(Object.entries(holds))(
    "says what to do at the printer for %s, and not to print the invoice again",
    (hold, [enWords, esWords]) => {
      const params = { invoice: "F1A/7", printer: "Back office", hold };
      expect(alertMessage("invoice_delivery.held", params, "en")).toBe(
        `Full invoice F1A/7 is waiting at office printer “Back office”. ${enWords} The invoice will then print by itself: do not print it again.`,
      );
      expect(alertMessage("invoice_delivery.held", params, "es")).toBe(
        `La factura completa F1A/7 está esperando en la impresora de oficina «Back office». ${esWords} Después la factura se imprimirá sola: no la vuelvas a imprimir.`,
      );
    },
  );

  it.each(Object.entries(holds))(
    "names the hold %s ahead of a waiting invoice and offers the receipt printer, not Use this agent",
    (hold, [enWords, esWords]) => {
      const params = { invoice: "F1A/7", printer: "Back office", hold };
      expect(alertMessage("invoice_delivery.queued_behind_hold", params, "en")).toBe(
        `Full invoice F1A/7 is waiting for office printer “Back office”, which is holding an earlier job. ${enWords} The invoice will then print after it. To give the customer the invoice on the receipt printer instead, open the order on the till.`,
      );
      expect(alertMessage("invoice_delivery.queued_behind_hold", params, "es")).toBe(
        `La factura completa F1A/7 está esperando a la impresora de oficina «Back office», que tiene retenido un trabajo anterior. ${esWords} Después la factura se imprimirá tras él. Para darle al cliente la factura en la impresora de tickets, abre el pedido en el TPV.`,
      );
    },
  );

  it("says a hold it has no words for only sends the reader to the printer, never the raw code", () => {
    for (const code of ["invoice_delivery.held", "invoice_delivery.queued_behind_hold"]) {
      for (const hold of ["media_low", undefined]) {
        const params = { invoice: "F1A/7", printer: "Back office", hold };
        const en = alertMessage(code, params, "en");
        const es = alertMessage(code, params, "es");
        expect(en, code).toContain(
          " It is waiting for something: check the printer for what it needs. ",
        );
        expect(es, code).toContain(" Está esperando algo: revisa qué necesita la impresora. ");
        for (const text of [en, es]) {
          expect(text).not.toContain("media_low");
          expect(text).not.toMatch(/[{}]/);
        }
      }
    }
  });

  it("says an invoice that ended while held may still print, and to check the printer first", () => {
    const params = { invoice: "F1A/7", printer: "Back office" };
    expect(alertMessage("invoice_delivery.uncertain_held", params, "en")).toBe(
      "Full invoice F1A/7 may still print on office printer “Back office”: the printer was holding it when Waitron lost track of it. Check the printer first; only if it did not print, send it again from the order, on the till or on the Orders page.",
    );
    expect(alertMessage("invoice_delivery.uncertain_held", params, "es")).toBe(
      "Puede que la factura completa F1A/7 aún se imprima en la impresora de oficina «Back office»: la impresora la tenía retenida cuando Waitron perdió su rastro. Comprueba primero la impresora; solo si no se ha imprimido, vuelve a enviarla desde el pedido, en el TPV o en la página de Pedidos.",
    );
  });
});

it("names only registered word lists in its word-list slots, variants and words for one included", () => {
  const unknown = Object.entries(ALERT_MESSAGES).flatMap(([code, entry]) =>
    [entry, entry.one, ...Object.values(entry.variants ?? {})]
      .flatMap((words) => (words ? [words.en, words.es] : []))
      .flatMap((text) =>
        [...text.matchAll(/\{[A-Za-z0-9_]+:([a-z_]+)\}/g)]
          .filter(
            (m) =>
              m[1] !== "money" &&
              m[1] !== "date" &&
              m[1] !== "bytes" &&
              m[1] !== "minute" &&
              m[1] !== "duration" &&
              !Object.hasOwn(ALERT_WORDS, m[1]!),
          )
          .map((m) => `${code}: ${m[0]}`),
      ),
  );
  expect(unknown).toEqual([]);
});

it("words the box's disk alerts, writing the free space in each language", () => {
  expect(alertMessage("storage.space_low", { freeBytes: 1_800_000_000 }, "en")).toBe(
    "The box has 1.8 GB of disk space left. Everything still works, but if it fills up nothing can be saved. See what is using it on the Box status page.",
  );
  const es = alertMessage("storage.space_low", { freeBytes: 1_800_000_000 }, "es");
  expect(es).toBe(ALERT_MESSAGES["storage.space_low"]!.es.replace("{freeBytes:bytes}", "1,8 GB"));
  expect(es).not.toContain("{");
  expect(alertMessage("storage.disk_full", {}, "en")).toBe(
    "The box is out of disk space: nothing can be saved.",
  );
  expect(alertMessage("storage.disk_full", {}, "es")).toBe(ALERT_MESSAGES["storage.disk_full"]!.es);
  expect(hasAlertMessage("storage.space_low")).toBe(true);
  expect(hasAlertMessage("storage.disk_full")).toBe(true);
});

it("points the disk warning at the Box status page, in three sentences, in both languages", () => {
  const { en, es } = ALERT_MESSAGES["storage.space_low"]!;
  for (const text of [en, es]) {
    expect(text.split(/(?<=\.)\s+/).length).toBe(3);
  }
  expect(en.endsWith("See what is using it on the Box status page.")).toBe(true);
  expect(es).toContain(t("nav.box_status", "es-ES"));
});

describe("a backup that stopped before reaching any destination", () => {
  const LEAD_EN =
    "The last backup stopped before reaching any destination, so no new copy was saved. Sales continue.";
  const LEAD_ES =
    "La última copia de seguridad se detuvo antes de llegar a ningún destino, así que no se ha guardado ninguna copia nueva. Las ventas continúan.";

  it("says how much room the backup needs and how much the disk has", () => {
    const params = {
      errorCode: "backup.staging_space_low",
      spaceLow: true,
      neededBytes: 6_300_000_000,
      availableBytes: 1_900_000_000,
    };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(
      "Backup not made: it needs 6.3 GB free and the disk has 1.9 GB.",
    );
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      "Copia no hecha: necesita 6,3 GB libres y el disco tiene 1,9 GB.",
    );
  });

  it("keeps no staging-space words in the backup stop word list", () => {
    expect(Object.hasOwn(ALERT_WORDS["backup_stop"]!.words, "backup.staging_space_low")).toBe(
      false,
    );
  });

  it("draws a dash for each size a space refusal does not carry", () => {
    const params = { errorCode: "backup.staging_space_low", spaceLow: true };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(
      "Backup not made: it needs — free and the disk has —.",
    );
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      "Copia no hecha: necesita — libres y el disco tiene —.",
    );
  });

  it("says files every backup must include are missing", () => {
    const params = { errorCode: "recovery.state_incomplete" };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(
      `${LEAD_EN} Some of the box's own files that every backup must include are missing. Contact support.`,
    );
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      `${LEAD_ES} Faltan algunos archivos propios del equipo que toda copia debe incluir. Contacta con soporte.`,
    );
  });

  it("sends any other cause to support, never showing the raw code", () => {
    const params = { errorCode: "unknown" };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(`${LEAD_EN} Contact support.`);
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      `${LEAD_ES} Contacta con soporte.`,
    );
  });
});

it("says the box deleted its oldest backups for low disk space, and the day they were taken", () => {
  const one = { count: 1, date: "2026-10-28", lastDate: "2026-10-28", severalDays: false };
  const three = { count: 3, date: "2026-10-28", lastDate: "2026-10-28", severalDays: false };
  expect(alertMessage("backup.archives_deleted", one, "en")).toBe(
    "Low disk space: the box deleted its oldest backup (28 Oct 2026).",
  );
  expect(alertMessage("backup.archives_deleted", three, "en")).toBe(
    "Low disk space: the box deleted its 3 oldest backups (28 Oct 2026).",
  );
  expect(alertMessage("backup.archives_deleted", one, "es")).toBe(
    "Poco espacio en disco: el equipo borró su copia de seguridad más antigua (28 oct 2026).",
  );
  expect(alertMessage("backup.archives_deleted", three, "es")).toBe(
    "Poco espacio en disco: el equipo borró sus 3 copias más antiguas (28 oct 2026).",
  );
});

it("says the first and last day the deleted backups were taken when they span several days", () => {
  const params = { count: 3, date: "2026-10-21", lastDate: "2026-10-24", severalDays: true };
  expect(alertMessage("backup.archives_deleted", params, "en")).toBe(
    "Low disk space: the box deleted its 3 oldest backups (21 Oct 2026 to 24 Oct 2026).",
  );
  expect(alertMessage("backup.archives_deleted", params, "es")).toBe(
    "Poco espacio en disco: el equipo borró sus 3 copias más antiguas (del 21 oct 2026 al 24 oct 2026).",
  );
});

it("says how many Translate all suggestions wait, and how many could not be done", () => {
  expect(alertMessage("content.suggestions_ready", { count: 1050, failed: 0 }, "en")).toBe(
    "Translations ready: 1050 suggestions are waiting for review.",
  );
  expect(alertMessage("content.suggestions_ready", { count: 1050, failed: 0 }, "es")).toBe(
    "Traducciones listas: 1050 sugerencias pendientes de revisar.",
  );
  expect(alertMessage("content.suggestions_ready_partly", { count: 1050, failed: 88 }, "en")).toBe(
    "Translations ready: 1050 suggestions are waiting for review. 88 couldn't be done this time.",
  );
  expect(alertMessage("content.suggestions_ready_partly", { count: 1050, failed: 88 }, "es")).toBe(
    "Traducciones listas: 1050 sugerencias pendientes de revisar. 88 no se han podido hacer esta vez.",
  );
});

it("explains conflicting settled-tender evidence without implying a fiscal correction", () => {
  expect(
    alertMessage("payment.tender_refund_outcome_conflict", { amount: "2.00" }, "en"),
  ).toContain("refund of €2.00 conflicts");
  expect(
    alertMessage("payment.tender_refund_outcome_conflict", { amount: "2.00" }, "es"),
  ).toContain("devolución de 2,00\u00a0€ contradice");
});

it("explains an unresolved post-invoice return without claiming the invoice is blocked", () => {
  expect(alertMessage("payment.tender_refund_unresolved", { amount: "2.00" }, "en")).toContain(
    "refund of €2.00 has been waiting for over an hour",
  );
  expect(alertMessage("payment.tender_refund_unresolved", { amount: "2.00" }, "en")).toContain(
    "original invoice is unchanged",
  );
  expect(alertMessage("payment.tender_refund_unresolved", { amount: "2.00" }, "es")).toContain(
    "devolución de 2,00\u00a0€ lleva más de una hora",
  );
  expect(alertMessage("payment.tender_refund_unresolved", { amount: "2.00" }, "es")).toContain(
    "factura original no cambia",
  );
});

it("never says the payments check may not look at a payment again", () => {
  for (const code of [
    "payment.reconcile_unsettled",
    "payment.reconcile_lost_settlement",
    "payment.reconcile_orphan",
    "payment.reconcile_missing_local",
    "payment.reconcile_drift",
  ]) {
    const en = alertMessage(code, { count: 2 }, "en");
    const es = alertMessage(code, { count: 2 }, "es");
    expect(en, code).toContain("Marking it handled does not fix it.");
    expect(es, code).toContain("Marcarla como resuelta no lo soluciona.");
    expect(en, code).not.toContain("may not check");
    expect(es, code).not.toContain("no vuelva a comprobar");
  }
});

describe("the box's clock reading behind its last sale", () => {
  const params = { clockAt: "2025-03-14T09:12:00.000Z", lastRecordAt: "2026-10-22T19:43:00.000Z" };

  it("writes both times as the dashboard writes an instant, and says payments stop, in English", () => {
    expect(alertMessage("clock.behind_chain", params, "en")).toBe(
      `The box's clock (${formatIsoMinute(params.clockAt)}) reads earlier than its last sale (${formatIsoMinute(params.lastRecordAt)}), so no payment can be taken. Orders and the kitchen still work. Sort it out on the Box status page.`,
    );
  });

  it("fills both times into the Spanish words", () => {
    expect(alertMessage("clock.behind_chain", params, "es")).toBe(
      ALERT_MESSAGES["clock.behind_chain"]!.es.replace(
        "{clockAt:minute}",
        formatIsoMinute(params.clockAt),
      ).replace("{lastRecordAt:minute}", formatIsoMinute(params.lastRecordAt)),
    );
  });

  it("says it in three sentences in each language, pointing at the Box status page", () => {
    const { en, es } = ALERT_MESSAGES["clock.behind_chain"]!;
    for (const text of [en, es]) expect(text.split(/(?<=\.)\s+/).length).toBe(3);
    expect(es).toContain(t("nav.box_status", "es-ES"));
    expect(es).toContain("{clockAt:minute}");
    expect(es).toContain("{lastRecordAt:minute}");
  });

  it("shows a dash for a time it cannot read", () => {
    expect(alertMessage("clock.behind_chain", { clockAt: null }, "en")).toContain("(—)");
  });
});

describe("the box's clock was stepped", () => {
  const before = "2026-10-19T07:10:00.000Z";
  const after = "2026-10-21T10:10:00.000Z";
  const base = {
    confirmationId: "c1",
    source: "authority",
    person: null,
    deviceId: null,
    device: null,
    before,
    beforeOffsetMinutes: 60,
    after,
    afterOffsetMinutes: 60,
    stepMs: (2 * 24 + 3) * 3_600_000,
    direction: "forward",
    verified: true,
    unverified: false,
    byAdmin: false,
    byStaff: false,
  };
  const from = formatIsoMinute(before);
  const to = formatIsoMinute(after);

  function both(params: Record<string, unknown>) {
    const english = alertMessage("clock.corrected", params, "en");
    const spanish = alertMessage("clock.corrected", params, "es");
    for (const text of [english, spanish]) {
      expect(text).not.toContain("—");
      expect(text).not.toMatch(/[{}]/);
    }
    return { english, spanish };
  }

  it("says the tax agency's time set it, which way, how far, and from when to when", () => {
    const { english, spanish } = both(base);
    expect(english).toBe(
      `The box set its clock from the tax agency's time: moved forward 2 days and 3 hours, from ${from} to ${to}.`,
    );
    expect(spanish).toBe(
      `El equipo puso su reloj con la hora de Hacienda: adelantado 2 días y 3 horas, de ${from} a ${to}.`,
    );
  });

  it("names the till and the staff member who confirmed it", () => {
    const params = {
      ...base,
      source: "staff",
      person: "Ana",
      deviceId: "till-1",
      device: "Barra 1",
      byStaff: true,
      stepMs: -5 * 60_000,
      direction: "back",
    };
    const { english, spanish } = both(params);
    expect(english).toBe(
      `The box's clock was set from till Barra 1, confirmed by Ana: moved back 5 minutes, from ${from} to ${to}.`,
    );
    expect(spanish).toBe(
      `El reloj del equipo se puso con la hora de la caja Barra 1, confirmada por Ana: atrasado 5 minutos, de ${from} a ${to}.`,
    );
  });

  it("names the administrator whose device set it", () => {
    const { english, spanish } = both({ ...base, source: "admin", person: "Luis", byAdmin: true });
    expect(english).toBe(
      `The box's clock was set from Luis's device: moved forward 2 days and 3 hours, from ${from} to ${to}.`,
    );
    expect(spanish).toBe(
      `El reloj del equipo se puso con la hora del dispositivo de Luis: adelantado 2 días y 3 horas, de ${from} a ${to}.`,
    );
  });

  it("says a change it could not confirm was tried, and only what the clock read, whoever asked", () => {
    for (const who of [{}, { source: "staff", person: "Ana", device: "Barra 1", byStaff: true }]) {
      const params = { ...base, ...who, confirmationId: null, verified: false, unverified: true };
      const { english, spanish } = both(params);
      expect(english).toBe(
        `The box tried to set its clock but could not confirm the change took. Its clock read ${from} before and ${to} after (moved forward 2 days and 3 hours). Check the box's clock on the Box status page.`,
      );
      expect(spanish).toBe(
        `El equipo intentó poner su reloj, pero no ha podido confirmar que el cambio se aplicara. Su reloj marcaba ${from} antes y ${to} después (adelantado 2 días y 3 horas). Comprueba la hora del equipo en Estado del equipo.`,
      );
    }
  });

  it("words a direction it does not know neutrally", () => {
    expect(ALERT_WORDS["clock_step_direction"]!.otherwise).toEqual({ en: "moved", es: "cambiado" });
    expect(both({ ...base, direction: "sideways" }).english).toContain(
      ": moved 2 days and 3 hours,",
    );
  });
});

describe("payments restarted on a clock behind the last sale", () => {
  const base = {
    confirmationId: "c1",
    person: null,
    clockAt: "2026-10-19T07:10:00.000Z",
    lastRecordAt: "2026-10-19T21:40:00.000Z",
  };
  const clockAt = formatIsoMinute(base.clockAt);
  const lastRecordAt = formatIsoMinute(base.lastRecordAt);
  const spanish = (confirmedBy: string) =>
    ALERT_MESSAGES["clock.behind_chain_restarted"]!.es.replace("{clockAt:minute}", clockAt)
      .replace("{lastRecordAt:minute}", lastRecordAt)
      .replace("{confirmedBy:clock_confirmed_by}", confirmedBy);

  it.each([
    ["authority", "authority"],
    ["devices", "devices"],
    ["admin", "admin"],
    ["something else", "otherwise"],
  ])("names what confirmed the clock, %s, in each language", (confirmedBy, key) => {
    const list = ALERT_WORDS["clock_confirmed_by"]!;
    const words = key === "otherwise" ? list.otherwise : list.words[key]!;
    const params = { ...base, confirmedBy, person: confirmedBy === "admin" ? "Ana" : null };
    const english = alertMessage("clock.behind_chain_restarted", params, "en");
    const es = alertMessage("clock.behind_chain_restarted", params, "es");
    expect(english).toBe(
      `Payments restarted on the box's clock (${clockAt}), earlier than the last sale (${lastRecordAt}), once ${words.en} confirmed it.`,
    );
    expect(es).toBe(spanish(words.es));
    for (const text of [english, es]) {
      expect(text).not.toContain("—");
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toContain("something else");
    }
  });

  it("names the staff member and the till when a staff member confirmed, in each language", () => {
    const params = { ...base, confirmedBy: "staff", person: "Ana", byStaff: true, device: "Bar" };
    expect(alertMessage("clock.behind_chain_restarted", params, "en")).toBe(
      `Payments restarted on the box's clock (${clockAt}), earlier than the last sale (${lastRecordAt}), once Ana, a staff member, confirmed it on till Bar.`,
    );
    expect(alertMessage("clock.behind_chain_restarted", params, "es")).toBe(
      `Se reanudaron los cobros con la hora del equipo (${clockAt}), anterior a la última venta (${lastRecordAt}), al confirmarla Ana, miembro del personal, en la caja Bar.`,
    );
  });

  it("words each way the clock can be confirmed", () => {
    expect(ALERT_WORDS["clock_confirmed_by"]!.words).toEqual({
      authority: { en: "the tax agency's time", es: expect.any(String) },
      devices: { en: "two tills or handhelds", es: expect.any(String) },
      admin: { en: "an administrator", es: expect.any(String) },
      staff: { en: "a staff member", es: expect.any(String) },
    });
    expect(ALERT_WORDS["clock_confirmed_by"]!.otherwise).toEqual({
      en: "a check recorded on the box",
      es: "una comprobación anotada en el equipo",
    });
  });
});

describe("sales recorded with a time later than the real time", () => {
  const params = {
    confirmationId: "c1",
    count: 3,
    from: "2026-10-19T21:41:00.000Z",
    fromOffsetMinutes: 120,
    to: "2026-10-19T22:05:00.000Z",
    toOffsetMinutes: 120,
    partial: false,
    unconfirmed: false,
  };
  const from = formatIsoMinute(params.from);
  const to = formatIsoMinute(params.to);
  const entry = ALERT_MESSAGES["clock.records_misdated"]!;
  const fill = (text: string) =>
    text.replace("{count}", "3").replace("{from:minute}", from).replace("{to:minute}", to);
  const LIST_EN = `3 sales were recorded with a time later than the real time (from ${from} to ${to}). They stay as recorded. Go through them with your tax adviser; the list is on the Box status page.`;

  it("counts them, names the first and last times, and points at the list", () => {
    expect(alertMessage("clock.records_misdated", params, "en")).toBe(LIST_EN);
    expect(alertMessage("clock.records_misdated", params, "es")).toBe(fill(entry.es));
    expect(entry.es).toContain(t("nav.box_status", "es-ES"));
  });

  it("says one sale in the singular, in each language, and the list may be short after it", () => {
    const one = { ...params, count: 1, to: params.from };
    expect(alertMessage("clock.records_misdated", one, "en")).toBe(
      `One sale was recorded with a time later than the real time, at ${from}. It stays as recorded. Go through it with your tax adviser; the list is on the Box status page.`,
    );
    expect(alertMessage("clock.records_misdated", one, "es")).toBe(
      `Se registró una venta con una hora posterior a la real, el ${from}. Queda como se registró. Revísala con tu asesor; la lista está en Estado del equipo.`,
    );
    expect(alertMessage("clock.records_misdated", { ...one, partial: true }, "en")).toBe(
      `One sale was recorded with a time later than the real time, at ${from}. It stays as recorded. Go through it with your tax adviser; the list is on the Box status page. The box restarted during the stop, so the list may be short.`,
    );
  });

  it("keeps the plural for two sales, in each language", () => {
    const two = { ...params, count: 2 };
    expect(alertMessage("clock.records_misdated", two, "en")).toBe(LIST_EN.replace("3 ", "2 "));
    expect(alertMessage("clock.records_misdated", two, "es")).toBe(
      `Se registraron 2 ventas con una hora posterior a la real (de ${from} a ${to}). Quedan como se registraron. Revísalas con tu asesor; la lista está en Estado del equipo.`,
    );
  });

  it("adds that the list may be short when the box restarted during the stop", () => {
    const partial = { ...params, partial: true };
    expect(alertMessage("clock.records_misdated", partial, "en")).toBe(
      `${LIST_EN} The box restarted during the stop, so the list may be short.`,
    );
    expect(alertMessage("clock.records_misdated", partial, "es")).toBe(
      `${fill(entry.es)} ${entry.variants!["partial"]!.es}`,
    );
  });

  it("says nothing confirmed the clock, and counts no sales, when it cannot tell which", () => {
    const unconfirmed = {
      confirmationId: "c1",
      count: 0,
      from: "2026-10-19T21:41:00.000Z",
      fromOffsetMinutes: 120,
      partial: true,
      unconfirmed: true,
    };
    const english = alertMessage("clock.records_misdated", unconfirmed, "en");
    const es = alertMessage("clock.records_misdated", unconfirmed, "es");
    expect(english).toBe(
      `The payment stop that began at ${from} ended by itself, but nothing confirmed the box's clock, so the box cannot tell which sales were dated wrongly. Check the box's clock, and go through the sales since then with your tax adviser.`,
    );
    expect(es).toBe(entry.variants!["unconfirmed"]!.es.replace("{from:minute}", from));
    for (const text of [english, es]) {
      expect(text).not.toContain("—");
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toMatch(/\b0 /);
    }
  });
});

describe("a restarted clock that later proved wrong", () => {
  const params = { from: "2026-10-19T07:10:02.000Z", to: "2026-10-19T07:11:30.000Z" };

  it("names the first and last sale times it dated, in each language", () => {
    const from = formatIsoMinute(params.from);
    const to = formatIsoMinute(params.to);
    expect(alertMessage("clock.behind_chain_disproved", params, "en")).toBe(
      `Sales recorded between ${from} and ${to} were dated by a clock that proved wrong. They stay as recorded; ask your tax adviser.`,
    );
    expect(alertMessage("clock.behind_chain_disproved", params, "es")).toBe(
      `Las ventas registradas entre ${from} y ${to} se fecharon con un reloj que resultó estar mal. Quedan como se registraron; consúltalo con tu asesor.`,
    );
  });
});

describe("the box's time service not keeping its clock right", () => {
  const REASONS = ["off", "stopped", "unsynchronised", "unreachable"] as const;

  it("says what is wrong for each reason, in English", () => {
    expect(alertMessage("clock.sync_off", { reason: "off" }, "en")).toBe(
      "The box's time service is switched off, so nothing keeps its clock right. Check its date and time on the Box status page.",
    );
    expect(alertMessage("clock.sync_off", { reason: "stopped" }, "en")).toBe(
      "The box's time service is on but not running, so nothing keeps its clock right. Check its date and time on the Box status page.",
    );
    expect(alertMessage("clock.sync_off", { reason: "unsynchronised" }, "en")).toBe(
      "The box's time service has not reached a time server, so its clock may drift. Check that the box can reach the internet and look at its date and time on the Box status page.",
    );
    expect(alertMessage("clock.sync_off", { reason: "unreachable" }, "en")).toBe(
      "This box cannot see or control its time service: the part of the box that does that is not answering. If the box can reach the internet, its time service may still keep the clock right by itself.",
    );
  });

  it("words each reason differently in Spanish, with every slot filled", () => {
    const spanish = REASONS.map((reason) => alertMessage("clock.sync_off", { reason }, "es"));
    expect(new Set(spanish).size).toBe(REASONS.length);
    for (const text of spanish) {
      expect(text).not.toContain("{");
      expect(text).not.toBe(alertMessage("clock.sync_off", { reason: "other" }, "es"));
    }
    for (const text of spanish.slice(0, 3)) expect(text).toContain(t("nav.box_status", "es-ES"));
  });

  it("never tells anyone to install anything when the clock service does not answer", () => {
    for (const language of ["en", "es"] as const) {
      const text = alertMessage("clock.sync_off", { reason: "unreachable" }, language);
      expect(text.toLowerCase()).not.toContain("instal");
    }
  });

  it("never shows a reason it has no words for as the raw code", () => {
    const text = alertMessage("clock.sync_off", { reason: "not_a_reason" }, "en");
    expect(text).not.toContain("not_a_reason");
    expect(text).toBe(
      "The box's clock is not being kept right. Check its date and time on the Box status page.",
    );
  });
});
