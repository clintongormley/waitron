import { describe, expect, it } from "vitest";
import { alertMessage, hasAlertMessage } from "./alerts.js";
import { ALERT_MESSAGES, ALERT_WORDS } from "./alert-messages.js";

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
  const unmarked = Object.entries(ALERT_MESSAGES).flatMap(([code, { en, es }]) =>
    [en, es].flatMap((text) =>
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

it("names only registered word lists in its word-list slots", () => {
  const unknown = Object.entries(ALERT_MESSAGES).flatMap(([code, { en, es }]) =>
    [en, es].flatMap((text) =>
      [...text.matchAll(/\{[A-Za-z0-9_]+:([a-z_]+)\}/g)]
        .filter((m) => m[1] !== "money" && !Object.hasOwn(ALERT_WORDS, m[1]!))
        .map((m) => `${code}: ${m[0]}`),
    ),
  );
  expect(unknown).toEqual([]);
});

describe("a backup that stopped before reaching any destination", () => {
  const LEAD_EN =
    "The last backup stopped before reaching any destination, so no new copy was saved. Sales continue.";
  const LEAD_ES =
    "La última copia de seguridad se detuvo antes de llegar a ningún destino, así que no se ha guardado ninguna copia nueva. Las ventas continúan.";

  it("says the box is short of disk space", () => {
    const params = { errorCode: "backup.staging_space_low" };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(
      `${LEAD_EN} The box does not have enough free disk space to prepare it. Contact support.`,
    );
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      `${LEAD_ES} El equipo no tiene espacio libre suficiente en disco para prepararla. Contacta con soporte.`,
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
