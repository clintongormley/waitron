import { describe, expect, it } from "vitest";
import { alertMessage, hasAlertMessage } from "./alerts.js";
import { codeMessage } from "./codes.js";
import { ALERT_MESSAGES, ALERT_WORDS } from "./alert-messages.js";
import { formatIsoMinute } from "../date-utils.js";
import { t } from "./t.js";

it.each([
  ["en-GB", "The box keeps failing at checking the box's clock. It keeps trying by itself."],
  [
    "es-ES",
    "El servidor sigue fallando en la comprobación del reloj del servidor. Lo sigue intentando por sí solo.",
  ],
])("words a failing clock check without promising sales can continue (%s)", (locale, expected) => {
  expect(alertMessage("job.failing", { job: "clock.watch" }, locale)).toBe(expected);
});

it("registers the dashboard's alert wording on import", () => {
  expect(hasAlertMessage("payment.refund_unresolved")).toBe(true);
  expect(alertMessage("payment.refund_unresolved", { amount: "12.50" }, "en")).toBe(
    "A card refund of €12.50 has been waiting for over an hour for the card provider to show what happened. Until then its bill cannot take payments or be invoiced, and what it charges cannot be changed. Check the refund in the provider's own dashboard, and record the outcome it confirms. Later checks do not add to this alert while it is open, so there may be more.",
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
    "La hora de este servidor ha retrocedido: ha cambiado -120 segundos. Revisa su fecha y hora.",
  );
});

it("shows every amount an alert carries with the euro sign, where each language writes it", () => {
  const cases: [string, Record<string, unknown>, string, string][] = [
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

it("explains dishes waiting for the pass at a closed station in English and Spanish", () => {
  const params = {
    station: "Fryer",
    dishes: "Chips, Onion rings",
    workingOrderId: "w1",
    orderNumber: 42,
  };
  expect(alertMessage("route.waiting_at_closed_station", params, "en")).toBe(
    "Order 42: Chips, Onion rings are waiting for the pass at Fryer, which is closed or disabled, and the prep station rules sent them nowhere else. Before the pass fires them, move the dishes to another station from the till (Move to station…), or open Fryer for today on the Prep stations page. Sides that go with a dish cannot be moved: the pass's Fire sends them to Fryer. Dishes left at a closed station later do not add to this alert while it is open, so there may be more.",
  );
  expect(alertMessage("route.waiting_at_closed_station", params, "es")).toBe(
    "Pedido 42: Chips, Onion rings están esperando al pase en Fryer, que está cerrada o deshabilitada, y las reglas de las estaciones de preparación no los enviaron a ningún otro sitio. Antes de que el pase los marche, pasa los platos a otra estación desde el TPV (Cambiar de estación…) o abre Fryer por hoy en la página de Estaciones de preparación. Las guarniciones que acompañan a un plato no se pueden mover: al marcharlas, el pase las envía a Fryer. Los platos que queden más tarde en una estación cerrada no se añaden a esta alerta mientras esté abierta, así que puede haber más.",
  );
});

// Slots shown as the param is. Never money: an amount is written `{name:money}`.
const UNMARKED_SLOTS: readonly string[] = [
  "agent",
  "anchorAgeSeconds",
  "codigo",
  "count",
  "days",
  "destination",
  "device",
  "dishes",
  "externalRef",
  "failed",
  "hostEnvironment",
  "hours",
  "invoice",
  "mensaje",
  "minutes",
  "numSerieFactura",
  "orderNumber",
  "paymentRef",
  "percent",
  "person",
  "printer",
  "reader",
  "recordEnvironment",
  "seconds",
  "station",
  "timeZone",
  "wallClockDeltaSeconds",
];

it("marks every amount slot :money; any other new unmarked slot must be added to UNMARKED_SLOTS", () => {
  const unmarked = new Set(
    Object.values(ALERT_MESSAGES)
      .flatMap((entry) => [entry, entry.one, entry.items, ...Object.values(entry.variants ?? {})])
      .flatMap((words) => (words ? [words.en, words.es] : []))
      .flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])),
  );
  expect([...unmarked].sort()).toEqual([...UNMARKED_SLOTS].sort());
  for (const money of ["amount", "captured", "expected"])
    expect(UNMARKED_SLOTS).not.toContain(money);
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
  // Only a manager holds `hardware.manage`; a supervisor sees this alert too.
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
    [entry, entry.one, entry.items, ...Object.values(entry.variants ?? {})]
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

describe("the copy when it goes to the standby server, not the owner's bucket", () => {
  const CHECK_EN =
    "Check that the standby server is switched on and connected to the restaurant's network.";
  const CHECK_ES =
    "Comprueba que el servidor en espera esté encendido y conectado a la red del restaurante.";

  it.each([
    [
      "backup.stream_behind",
      { minutes: 20 },
      `The standby server is not receiving the restaurant's data: its copy is 20 minutes behind, so your most recent sales are not on it yet. Sales continue. ${CHECK_EN}`,
      `El servidor en espera no está recibiendo los datos del restaurante: su copia lleva 20 minutos de retraso, así que tus ventas más recientes aún no están en ella. Las ventas continúan. ${CHECK_ES}`,
    ],
    [
      "backup.stream_paused",
      {},
      `The copy to the standby server is paused: this box could not reach the standby for so long that it stopped copying to protect its disk. Sales continue. ${CHECK_EN}`,
      `La copia en el servidor en espera está en pausa: este servidor no ha podido contactar con él durante tanto tiempo que ha dejado de copiar para proteger su disco. Las ventas continúan. ${CHECK_ES}`,
    ],
    [
      "backup.stream_bucket_unusable",
      {},
      `The standby server is not receiving the restaurant's data: this box cannot reach it, or the standby is refusing this box. Sales continue. ${CHECK_EN}`,
      `El servidor en espera no está recibiendo los datos del restaurante: este servidor no consigue contactar con él, o el servidor en espera está rechazando este servidor. Las ventas continúan. ${CHECK_ES}`,
    ],
    [
      "backup.disabled",
      {},
      "No up-to-date copy of your data is being kept: there are no scheduled backups, and the standby server is not receiving the restaurant's data. Check that the standby server is switched on and connected to the restaurant's network, or set up scheduled backups on the Backups page.",
      "No se está guardando ninguna copia al día de tus datos: no hay copias de seguridad programadas, y el servidor en espera no está recibiendo los datos del restaurante. Comprueba que el servidor en espera esté encendido y conectado a la red del restaurante, o configura copias programadas en la página de Copias.",
    ],
    [
      "backup.stream_stopped",
      { reason: "start_failed" },
      "The copy to the standby server is not running, so new changes are not reaching the standby server. Sales continue. This box tries again each time it starts: when the restaurant is not serving, open Box status and press Restart the box.",
      "La copia en el servidor en espera no está en marcha, así que los cambios nuevos no llegan al servidor en espera. Las ventas continúan. Este servidor lo vuelve a intentar cada vez que arranca: cuando no haya servicio, abre Estado del servidor y pulsa Reiniciar el servidor.",
    ],
    [
      "backup.stream_refused",
      {},
      "The copy to the standby server has stopped because another box is writing this venue's copy to the standby server. Two boxes must never sell for one venue: if that box replaced this one, switch this box off.",
      "La copia en el servidor en espera se ha detenido porque otro servidor está escribiendo la copia de este local en el servidor en espera. Nunca deben vender dos servidores para un mismo local: si ese servidor sustituyó a este, apaga este servidor.",
    ],
    [
      "backup.stream_settings_unusable",
      {},
      "The copy to the standby server has not started because this box's own configuration could not be used safely. Sales continue. This is a fault in Waitron or this box's installation, and restarting the box does not change it. Scheduled backups on the Backups page can still keep copies of your data.",
      "La copia en el servidor en espera no se ha iniciado porque no se ha podido usar de forma segura la configuración del propio servidor. Las ventas continúan. Es un fallo de Waitron o de la instalación de este servidor, y reiniciar el servidor no lo cambia. Las copias programadas de la página de Copias de seguridad pueden seguir guardando copias de tus datos.",
    ],
  ])("words %s for the standby, never naming a bucket or the internet", (code, params, en, es) => {
    expect(alertMessage(code, { ...params, toSpare: true }, "en")).toBe(en);
    expect(alertMessage(code, { ...params, toSpare: true }, "es")).toBe(es);
    for (const text of [en, es]) expect(text).not.toMatch(/bucket|internet/i);
  });

  it("keeps the bucket wording when the copy goes to a bucket", () => {
    expect(alertMessage("backup.stream_behind", { minutes: 20 }, "en")).toBe(
      "The bucket copy is 20 minutes behind: your most recent sales are not in it yet. Sales continue. Check the box's internet connection, and the bucket on the Backups page.",
    );
    for (const code of [
      "backup.stream_paused",
      "backup.stream_bucket_unusable",
      "backup.disabled",
      "backup.stream_stopped",
      "backup.stream_refused",
      "backup.stream_settings_unusable",
    ]) {
      expect(alertMessage(code, {}, "en")).toBe(ALERT_MESSAGES[code]!.en);
      expect(alertMessage(code, {}, "es")).toBe(ALERT_MESSAGES[code]!.es);
      expect(ALERT_MESSAGES[code]!.en).toMatch(/bucket/);
    }
  });
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

  it("says files every backup must include are missing, and that this is a fault", () => {
    const params = { errorCode: "recovery.state_incomplete" };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(
      `${LEAD_EN} Some of the box's own files that every backup must include are missing. This is a fault in Waitron or this box's disk, or a program other than Waitron removed them.`,
    );
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      `${LEAD_ES} Faltan algunos archivos propios del servidor que toda copia debe incluir. Es un fallo de Waitron o del disco de este servidor, o un programa que no es Waitron los ha quitado.`,
    );
  });

  it("says any other cause is retried at the next backup and is otherwise a fault, never showing the raw code", () => {
    const params = { errorCode: "unknown" };
    expect(alertMessage("backup.run_stopped", params, "en")).toBe(
      `${LEAD_EN} Waitron tries again at the next scheduled backup. If this message stays, this is a fault in Waitron or this box.`,
    );
    expect(alertMessage("backup.run_stopped", params, "es")).toBe(
      `${LEAD_ES} Waitron lo vuelve a intentar en la próxima copia programada. Si el mensaje sigue, es un fallo de Waitron o de este servidor.`,
    );
  });
});

describe("a box that could not update the locked copy of its own keys and settings", () => {
  const LEAD_EN =
    "The box could not update the locked copy of its own keys and settings that it keeps with your data. A box rebuilt from your bucket might come back with out-of-date keys and settings, or without them if none were ever saved.";
  const LEAD_ES =
    "El servidor no ha podido actualizar la copia cifrada de sus propias claves y ajustes que guarda junto con tus datos. Un servidor reconstruido desde tu bucket podría volver con claves y ajustes desactualizados, o sin ellos si nunca se llegaron a guardar.";
  const say = (errorCode: string, lang: "en" | "es") =>
    alertMessage("backup.sealed_state_failed", { errorCode }, lang);

  it("says a full disk stopped it, and to free space on Box status and restart, never that sales continue", () => {
    expect(say("storage.disk_full", "en")).toBe(
      `${LEAD_EN} The box's disk is full. Free space on the Box status page, then press Restart the box there: each start updates the copy again.`,
    );
    expect(say("storage.disk_full", "es")).toBe(
      `${LEAD_ES} El disco del servidor está lleno. Libera espacio en Estado del servidor y después pulsa allí Reiniciar el servidor: cada arranque vuelve a actualizar la copia.`,
    );
    expect(say("storage.disk_full", "en")).toContain(t("nav.box_status", "en-GB"));
    expect(say("storage.disk_full", "es")).toContain(t("nav.box_status", "es-ES"));
  });

  it("says files the copy must include are missing, and that this is a fault", () => {
    expect(say("recovery.state_incomplete", "en")).toBe(
      `${LEAD_EN} Sales continue. Some of the box's own files that the copy must include are missing. This is a fault in Waitron or this box's disk, or a program other than Waitron removed them.`,
    );
    expect(say("recovery.state_incomplete", "es")).toBe(
      `${LEAD_ES} Las ventas continúan. Faltan algunos archivos propios del servidor que la copia debe incluir. Es un fallo de Waitron o del disco de este servidor, o un programa que no es Waitron los ha quitado.`,
    );
  });

  it("says each start tries again for any other cause, never showing the raw code", () => {
    expect(say("unknown", "en")).toBe(
      `${LEAD_EN} Sales continue. Each start tries again, so open Box status and press Restart the box.`,
    );
    expect(say("unknown", "es")).toBe(
      `${LEAD_ES} Las ventas continúan. Cada arranque lo vuelve a intentar, así que abre Estado del servidor y pulsa Reiniciar el servidor.`,
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
    "Poco espacio en disco: el servidor borró su copia de seguridad más antigua (28 oct 2026).",
  );
  expect(alertMessage("backup.archives_deleted", three, "es")).toBe(
    "Poco espacio en disco: el servidor borró sus 3 copias más antiguas (28 oct 2026).",
  );
});

it("says the first and last day the deleted backups were taken when they span several days", () => {
  const params = { count: 3, date: "2026-10-21", lastDate: "2026-10-24", severalDays: true };
  expect(alertMessage("backup.archives_deleted", params, "en")).toBe(
    "Low disk space: the box deleted its 3 oldest backups (21 Oct 2026 to 24 Oct 2026).",
  );
  expect(alertMessage("backup.archives_deleted", params, "es")).toBe(
    "Poco espacio en disco: el servidor borró sus 3 copias más antiguas (del 21 oct 2026 al 24 oct 2026).",
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

describe("the box's clock set before the earliest date", () => {
  it.each([
    ["en", "en-GB", /install|support|manager/i, "an administrator can usually set it"],
    [
      "es",
      "es-ES",
      /instal|soporte|encargad|gerente/i,
      "un administrador normalmente puede ponerla",
    ],
  ] as const)(
    "points %s readers at the Box status page, not the installer or anyone else",
    (lang, locale, elsewhere, administrator) => {
      const text = ALERT_MESSAGES["clock.unusable"]![lang];
      expect(text).toContain(t("nav.box_status", locale));
      expect(text).not.toMatch(elsewhere);
      expect(text).toContain(administrator);
    },
  );
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
      `El servidor puso su reloj con la hora de Hacienda: adelantado 2 días y 3 horas, de ${from} a ${to}.`,
    );
  });

  it("names the till and the staff member who confirmed it", () => {
    const params = {
      ...base,
      source: "staff",
      person: "Ana",
      deviceId: "till-1",
      device: "Bar 1",
      byStaff: true,
      stepMs: -5 * 60_000,
      direction: "back",
    };
    const { english, spanish } = both(params);
    expect(english).toBe(
      `The box's clock was set from till Bar 1, confirmed by Ana: moved back 5 minutes, from ${from} to ${to}.`,
    );
    expect(spanish).toBe(
      `El reloj del servidor se puso con la hora de la caja Bar 1, confirmada por Ana: atrasado 5 minutos, de ${from} a ${to}.`,
    );
  });

  it("names the administrator whose device set it", () => {
    const { english, spanish } = both({ ...base, source: "admin", person: "Luis", byAdmin: true });
    expect(english).toBe(
      `The box's clock was set from Luis's device: moved forward 2 days and 3 hours, from ${from} to ${to}.`,
    );
    expect(spanish).toBe(
      `El reloj del servidor se puso con la hora del dispositivo de Luis: adelantado 2 días y 3 horas, de ${from} a ${to}.`,
    );
  });

  it("says the setup or restore page's device set it, naming the administrator on first setup", () => {
    const named = both({ ...base, source: "setup", person: "Luis", bySetupAdmin: true });
    expect(named.english).toBe(
      `The box's clock was set from the device showing the setup or restore page, by Luis: moved forward 2 days and 3 hours, from ${from} to ${to}.`,
    );
    expect(named.spanish).toBe(
      `El reloj del servidor se puso en hora con el dispositivo que mostraba la página de configuración o restauración, por Luis: adelantado 2 días y 3 horas, de ${from} a ${to}.`,
    );
    const nobody = both({ ...base, source: "setup", bySetup: true });
    expect(nobody.english).toBe(
      `The box's clock was set from the device showing the setup or restore page: moved forward 2 days and 3 hours, from ${from} to ${to}.`,
    );
    expect(nobody.spanish).toBe(
      `El reloj del servidor se puso en hora con el dispositivo que mostraba la página de configuración o restauración: adelantado 2 días y 3 horas, de ${from} a ${to}.`,
    );
  });

  it("says a change it could not confirm was tried, and only what the clock read, whoever asked", () => {
    for (const who of [
      {},
      { source: "staff", person: "Ana", device: "Bar 1", byStaff: true },
      { source: "setup", bySetup: true },
    ]) {
      const params = { ...base, ...who, confirmationId: null, verified: false, unverified: true };
      const { english, spanish } = both(params);
      expect(english).toBe(
        `The box tried to set its clock but could not confirm the change took. Its clock read ${from} before and ${to} after (moved forward 2 days and 3 hours). Check the box's clock on the Box status page.`,
      );
      expect(spanish).toBe(
        `El servidor intentó poner su reloj, pero no ha podido confirmar que el cambio se aplicara. Su reloj marcaba ${from} antes y ${to} después (adelantado 2 días y 3 horas). Comprueba la hora del servidor en Estado del servidor.`,
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
      `Se reanudaron los cobros con la hora del servidor (${clockAt}), anterior a la última venta (${lastRecordAt}), al confirmarla Ana, miembro del personal, en la caja Bar.`,
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
      es: "una comprobación anotada en el servidor",
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
      `Se registró una venta con una hora posterior a la real, el ${from}. Queda como se registró. Revísala con tu asesor; la lista está en Estado del servidor.`,
    );
    expect(alertMessage("clock.records_misdated", { ...one, partial: true }, "en")).toBe(
      `One sale was recorded with a time later than the real time, at ${from}. It stays as recorded. Go through it with your tax adviser; the list is on the Box status page. The box restarted during the stop, so the list may be short.`,
    );
  });

  it("keeps the plural for two sales, in each language", () => {
    const two = { ...params, count: 2 };
    expect(alertMessage("clock.records_misdated", two, "en")).toBe(LIST_EN.replace("3 ", "2 "));
    expect(alertMessage("clock.records_misdated", two, "es")).toBe(
      `Se registraron 2 ventas con una hora posterior a la real (de ${from} a ${to}). Quedan como se registraron. Revísalas con tu asesor; la lista está en Estado del servidor.`,
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
      "This box cannot see or control its time service: the part of the box that does that is not answering. If the box can reach the internet, its time service may still keep the clock right by itself. Check its date and time on the Box status page.",
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

it.each(["en", "es"])("explains affiliate rejection and refund uncertainty in %s", (locale) => {
  expect(hasAlertMessage("payment.affiliate_rejected")).toBe(true);
  const fallback = alertMessage("payment.affiliate_rejected", { paymentRef: "ref-key" }, locale);
  expect(fallback).toContain("ref-key");
  const refund = alertMessage(
    "payment.pending_outcome_unactionable",
    { paymentRef: "ref-refund", status: "refund_pending" },
    locale,
  );
  expect(refund).not.toContain("refund_pending");
  expect(refund).toContain(locale === "en" ? "there may be more" : "puede haber más");
  expect(refund).toContain("ref-refund");
  expect(refund).not.toMatch(/marked the payment as failed|marcado el pago como fallido/);
});

describe("refusals that name a way out the product already has", () => {
  it.each([
    [
      "en",
      "en-GB",
      /install|support|manager/i,
      "Two boxes must never sell for one venue: if that box replaced this one, switch this box off.",
    ],
    [
      "es",
      "es-ES",
      /instal|soporte|encargad|gerente/i,
      "Nunca deben vender dos servidores para un mismo local: si ese servidor sustituyó a este, apaga este servidor.",
    ],
  ] as const)(
    "tells %s readers of a bucket copy another box holds to switch this box off if that box replaced it, and sends nobody elsewhere",
    (lang, locale, elsewhere, switchOff) => {
      for (const text of [
        alertMessage("backup.stream_refused", {}, lang),
        codeMessage("backup.stream_held_by_another_box", locale),
      ]) {
        expect(text.endsWith(switchOff)).toBe(true);
        expect(text).not.toMatch(elsewhere);
      }
    },
  );

  it.each([
    ["en", "en-GB", /install|support|manager/i],
    ["es", "es-ES", /instal|soporte|encargad|gerente/i],
  ] as const)(
    "tells %s readers a failed first start after a restore is tried again at each start, and sends nobody elsewhere",
    (lang, locale, elsewhere) => {
      const text = alertMessage("restore.first_start_failed", {}, lang);
      expect(text).toContain(
        lang === "en"
          ? "Each start tries again, so open Box status and press Restart the box."
          : "Cada arranque lo vuelve a intentar, así que abre Estado del servidor y pulsa Reiniciar el servidor.",
      );
      expect(text).toContain(
        lang === "en" ? "and a bucket copy is set up" : "y hay una copia en el bucket configurada",
      );
      expect(text).toContain(t("nav.backup", locale));
      expect(text).not.toMatch(elsewhere);
    },
  );

  it.each([
    ["en", "en-GB", /install|support|manager/i, "Do not charge the card again."],
    ["es", "es-ES", /instal|soporte|encargad|gerente/i, "No vuelvas a cobrar la tarjeta."],
  ] as const)(
    "sends %s readers of a bill payment that could not be recorded to Check with provider, never elsewhere or to a second charge",
    (lang, locale, elsewhere, noSecondCharge) => {
      const text = alertMessage("payment.bill_settle_failed", { amount: "12.00" }, lang);
      for (const label of [
        "nav.payments",
        "payments.bill.heading",
        "payments.bill.check",
      ] as const) {
        expect(text, label).toContain(t(label, locale));
      }
      expect(text).toContain(noSecondCharge);
      expect(text).not.toMatch(elsewhere);
    },
  );

  it.each([
    [
      "en",
      /install|support|manager/i,
      {
        "chain.verification_failed":
          "The new record was still written, and sales and sending to the tax agency (AEAT) carry on.",
        "fiscal.respuesta_descuadrada":
          "put each record back to be sent again, except any already on hold, which stayed on hold. The records sent and AEAT's lines are on Fiscal filing.",
        "fiscal.record_flagged":
          "It is sent to AEAT like any other record; the invoice and the fields involved are on Fiscal filing.",
        "fiscal.record_totals_disagree": "The tax agency accepts it, but check that sale's prices.",
        "fiscal.environment_mismatch":
          "but this box sends to preproduction. That record and the later ones on its chain are kept on this box and not sent; sales carry on.",
        "fiscal.environment_unknown":
          "That record and the later ones on its chain are kept on this box and not sent; sales carry on.",
        "fiscal.reconcile_no_trace":
          "Waitron has already queued it to be sent once more, so it will not send it again by itself; it asks AEAT about it again every day.",
        "fiscal.reconcile_drift_anulada":
          "Waitron leaves its own record of the invoice as it is and asks AEAT about it again every day.",
      },
    ],
    [
      "es",
      /instal|soporte|encargad|gerente/i,
      {
        "chain.verification_failed":
          "El registro nuevo se ha escrito igualmente, y las ventas y los envíos a la AEAT continúan.",
        "fiscal.respuesta_descuadrada":
          "ha vuelto a dejar cada registro pendiente de enviar, salvo los que ya estaban detenidos, que siguen detenidos. Los registros enviados y las líneas de la AEAT están en Remisión a la AEAT.",
        "fiscal.record_flagged":
          "Se envía a la AEAT como cualquier otro; la factura y los campos afectados están en Remisión a la AEAT.",
        "fiscal.record_totals_disagree": "La AEAT la acepta, pero revisa los precios de esa venta.",
        "fiscal.environment_mismatch":
          "pero este equipo envía a preproduction. Ese registro y los posteriores de su cadena se guardan en este equipo y no se envían; las ventas continúan.",
        "fiscal.environment_unknown":
          "Ese registro y los posteriores de su cadena se guardan en este equipo y no se envían; las ventas continúan.",
        "fiscal.reconcile_no_trace":
          "Waitron ya la ha vuelto a poner en cola para enviarla una vez más, así que no la volverá a enviar por su cuenta; cada día vuelve a consultarla a la AEAT.",
        "fiscal.reconcile_drift_anulada":
          "Waitron deja su propio registro de la factura tal como está y cada día vuelve a consultarla a la AEAT.",
      },
    ],
  ] as const)(
    "tells %s readers of each fiscal record alert what Waitron does with the record, and sends nobody elsewhere",
    (lang, elsewhere, sentences) => {
      const params = {
        numSerieFactura: "T1/9",
        recordEnvironment: "production",
        hostEnvironment: "preproduction",
      };
      for (const [code, sentence] of Object.entries(sentences)) {
        const text = alertMessage(code, params, lang);
        expect(text, code).toContain(sentence);
        expect(text, code).not.toMatch(elsewhere);
      }
    },
  );
});

describe("a correction whose automatic filing was refused", () => {
  it("says how much went back, without the refusal's code", () => {
    const params = {
      correctionId: "c1",
      saleId: "s1",
      moneyBack: "24.20",
      refusal: "authorization.not_permitted",
    };
    expect(alertMessage("invoice_correction.filing_refused", params, "en")).toBe(
      "€24.20 went back to a customer for an invoice correction, but its corrective invoice could not be filed. Do not give the money back again. On a till, open Find a bill, choose the correction under Corrections under way and press Record correction; if it says the invoice can no longer be corrected, press Close keeping the refunds. Later checks do not add to this alert while it is open, so there may be more.",
    );
    expect(alertMessage("invoice_correction.filing_refused", params, "es")).toBe(
      "Se devolvieron 24,20 € a un cliente por una rectificación de factura, pero no se ha podido emitir su factura rectificativa. No vuelvas a devolver el dinero. En una caja, abre Buscar cuenta, elige la rectificación en Rectificaciones en curso y pulsa Registrar la rectificación; si indica que la factura ya no se puede rectificar, pulsa Cerrar y conservar las devoluciones. Mientras esta alerta esté abierta, las comprobaciones posteriores no la amplían, así que puede haber más.",
    );
  });
});

it.each([
  [
    "payment.reconcile_unsettled",
    "not confirmed in the card provider's records",
    "no constan en los registros del proveedor",
  ],
  ["payment.reconcile_lost_settlement", "never finished here", "aquí no se completaron"],
  [
    "payment.reconcile_orphan",
    "may not be refunded automatically",
    "pueden no devolverse automáticamente",
  ],
  [
    "payment.reconcile_missing_local",
    "no matching completed payment here",
    "sin un pago completado correspondiente aquí",
  ],
  [
    "payment.reconcile_drift",
    "different amount in the card provider's records",
    "importe distinto en los registros del proveedor",
  ],
  [
    "payment.reconcile_held",
    "different amount in the card provider's records",
    "importe distinto en los registros del proveedor",
  ],
])("describes provider-record finding %s without asserting a bank payout", (code, en, es) => {
  expect(alertMessage(code, { count: 2 }, "en")).toContain(en);
  expect(alertMessage(code, { count: 2 }, "es")).toContain(es);
});

it("names the payment audit without asserting a bank payout", () => {
  expect(alertMessage("job.failing", { job: "payments.reconcile" }, "en")).toContain(
    "checking card provider records",
  );
  expect(alertMessage("job.failing", { job: "payments.reconcile" }, "es")).toContain(
    "los registros del proveedor de pagos",
  );
});
