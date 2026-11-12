import { afterEach, expect, it } from "vitest";
import {
  carriedText,
  clockBehindText,
  clockDateTime,
  clockTime,
  clockUnusableText,
  countText,
  currentLocale,
  differentPeopleText,
  fill,
  pickLocale,
  setLocale,
  subscribeLocale,
  t,
} from "./t.js";
import { catalogues, en } from "./strings.js";
import { refusalText } from "../widgets/pay-refusal.js";
import { staffNoticeText } from "./staff-notices.js";

it.each(["constructor", "toString", "__proto__"])(
  "falls back to English for inherited locale key %s",
  (locale) => {
    expect(pickLocale({ en: "Milk", es: "Leche" }, locale)).toBe("Milk");
  },
);

it.each([
  ["en", "Milk"],
  ["en-GB", "Milk"],
  ["es", "Leche"],
  ["es-ES", "Leche"],
  ["fr-FR", "Milk"],
  ["", "Milk"],
])("selects the entry's text for locale %s", (locale, expected) => {
  expect(pickLocale({ en: "Milk", es: "Leche" }, locale)).toBe(expected);
});

it("falls back to English when the Spanish translation is inherited", () => {
  const entry = new (class {
    en = "Milk";
    get es(): string {
      return "Leche";
    }
  })();
  expect(pickLocale(entry, "es-ES")).toBe("Milk");
});

it("preserves an empty own translation", () => {
  expect(pickLocale({ en: "Milk", es: "" }, "es-ES")).toBe("");
});

it.each([null, undefined])("falls back to English for an own nullish translation %s", (es) => {
  const entry = { en: "Milk", es } as unknown as { en: string; es: string };
  expect(pickLocale(entry, "es-ES")).toBe("Milk");
});

it("selects an entry's text using the active locale when no locale is passed", () => {
  const previous = currentLocale();
  try {
    setLocale("es-ES");
    expect(pickLocale({ en: "Milk", es: "Leche" })).toBe("Leche");
    setLocale("constructor");
    expect(pickLocale({ en: "Milk", es: "Leche" })).toBe("Milk");
  } finally {
    setLocale(previous);
  }
});

afterEach(() => {
  // t.ts's locale is module-level, so a setLocale in one test would leak into the next.
  setLocale("en-GB");
});

it("fills every named slot in one pass, printing a value's own slot spelling as it is and leaving unnamed slots", () => {
  expect(fill("{a} and {b}, {c}", { a: "{b}", b: "two" })).toBe("{b} and two, {c}");
});

it("says a count of one with its singular key and any other count with the plural, in the active locale", () => {
  const many = "table.submitted_fired" as const;
  const one = "table.submitted_fired_one" as const;
  expect(countText(1, many, one)).toBe("Fired: 1 group.");
  expect(countText(2, many, one)).toBe("Fired: 2 groups.");
  expect(countText(0, many, one)).toBe("Fired: 0 groups.");
  setLocale("es-ES");
  expect(countText(3, many, one)).toBe(t(many, "es-ES").replace("{n}", "3"));
  expect(countText(1, many, one)).toBe(t(one, "es-ES"));
});

it("writes a time of day as two-digit hours and minutes in the active locale, from a date or a timestamp", () => {
  const fivePastNine = new Date(2026, 8, 28, 9, 5);
  setLocale("en-GB");
  expect(clockTime(fivePastNine)).toBe("09:05");
  expect(clockTime(fivePastNine.getTime())).toBe("09:05");
  setLocale("fi-FI");
  expect(clockTime(fivePastNine)).toBe("09.05");
});

it("names the item, the device carrying it and the person signed in there, or the device alone", () => {
  const ana = { deviceName: "Bar till", personName: "Ana" };
  expect(carriedText("Reader", ana, "equipment.held_by", "equipment.held_by_person")).toBe(
    "Reader is carried by Bar till (Ana)",
  );
  expect(
    carriedText(
      "Reader",
      { ...ana, personName: null },
      "equipment.held_by",
      "equipment.held_by_person",
    ),
  ).toBe("Reader is carried by Bar till");
  // A name holding a placeholder or a replacement pattern is written as it is.
  expect(carriedText("{device} $&", ana, "equipment.held_by", "equipment.held_by_person")).toBe(
    "{device} $& is carried by Bar till (Ana)",
  );
});

it("names the server's large-bill limit in the different-people question, in English and Spanish", () => {
  setLocale("en-GB");
  expect(differentPeopleText("3000.00")).toBe(
    "Confirm that the resulting bills belong to different people. A bill over €3,000.00 needs a full invoice unless it is genuinely shared between people.",
  );
  setLocale("es-ES");
  expect(differentPeopleText("3000.00")).toBe(
    "Confirma que las cuentas resultantes pertenecen a personas distintas. Una cuenta superior a 3000,00\u00a0€ necesita una factura completa salvo que se comparta realmente entre varias personas.",
  );
});

it("resolves an English base key to Spanish", () => {
  expect(t("action.pay", "es-ES")).toBe("Cobrar");
});

it("falls back to the English base when a locale lacks the key", () => {
  expect(t("action.pay", "en")).toBe("Pay");
});

it("falls back to the English base for an unknown locale", () => {
  expect(t("action.pay", "fr")).toBe("Pay");
});

// The startup default is asserted in t.default.test.ts: afterEach's reset here would mask it.

it("uses the active locale when none is passed, and setLocale switches it", () => {
  expect(t("action.pay")).toBe("Pay");
  setLocale("es-ES");
  expect(currentLocale()).toBe("es-ES");
  expect(t("action.pay")).toBe("Cobrar");
});

it("notifies subscribers on setLocale and stops after unsubscribe", () => {
  let calls = 0;
  const off = subscribeLocale(() => {
    calls += 1;
  });
  setLocale("en-GB");
  expect(calls).toBe(1);
  off();
  setLocale("es-ES");
  expect(calls).toBe(1);
});

it("registers en-GB as a first-class catalogue entry", () => {
  // Checks the map directly: a t() comparison passes either way, because a missing en-GB catalogue
  // falls back to the same English base.
  expect(catalogues["en-GB"]).toBe(en);
});

it.each(["en-GB", "es-ES"])(
  "keeps each of a clock stop's readings on one line, its date and time joined by a no-break space (%s)",
  (locale) => {
    setLocale(locale);
    const text = clockBehindText({
      clockAt: "2025-03-14T08:12:00.000Z",
      offsetMinutes: 60,
      lastRecordAt: "2026-10-18T21:40:00.000Z",
      lastRecordOffsetMinutes: 120,
    });
    expect(text).toContain("(14/03/2025\u00a009:12)");
    expect(text).toContain("(18/10/2026\u00a023:40)");
  },
);

const BEHIND = {
  clockAt: "2025-03-14T08:12:00.000Z",
  offsetMinutes: 60,
  lastRecordAt: "2026-10-18T21:40:00.000Z",
  lastRecordOffsetMinutes: 120,
};

it.each([
  ["en-GB", "Use “Check the time” at the top of the screen.", "Tell a manager"],
  ["es-ES", "Usa «Comprobar la hora» arriba.", "Avisa al encargado"],
])(
  "points a clock refusal at Check the time while the box offers it, and nowhere else (%s)",
  (locale, check, tell) => {
    setLocale(locale);
    const unusable = clockUnusableText("2001-01-01T10:00:00.000Z", 60, true);
    expect(unusable).toContain(check);
    expect(unusable).not.toContain(tell);
    expect(clockUnusableText("2001-01-01T10:00:00.000Z", 60)).not.toContain(check);
    const behind = clockBehindText(BEHIND, { checkTime: true });
    expect(behind).toContain(check);
    expect(behind).toContain("(14/03/2025\u00a009:12)");
    expect(clockBehindText(BEHIND)).not.toContain(check);
  },
);

it("words a clock.behind_chain payment refusal with Check the time only while it is offered", () => {
  const refusal = { code: "clock.behind_chain", ...BEHIND };
  expect(refusalText(refusal, { checkTime: true })).toBe(
    clockBehindText(BEHIND, { checkTime: true }),
  );
  expect(refusalText(refusal)).toBe(clockBehindText(BEHIND));
  expect(refusalText(refusal)).toContain("tell a manager");
  const unusable = { code: "clock.unusable", clockAt: BEHIND.clockAt, offsetMinutes: 60 };
  expect(refusalText(unusable, { checkTime: true })).toBe(
    clockUnusableText(BEHIND.clockAt, 60, true),
  );
  expect(refusalText(unusable)).toBe(clockUnusableText(BEHIND.clockAt, 60));
});

it.each([
  [
    "en-GB",
    "Payments wait: the server is waiting for devices to connect and agree with its time (1 of 2 so far)",
    "Payment not recorded: the server is waiting for its time to be confirmed. The order stays open. Use “Check the time” at the top of the screen.",
    "Card charged, but the payment is not recorded: the server is waiting for its time to be confirmed. Don't charge again. Once it is confirmed, try this payment again: it is recorded without charging again.",
    "Card charged, but the payment is not recorded: the server is waiting for its time to be confirmed. Don't charge again. Once it is confirmed, the payment is recorded automatically.",
  ],
  [
    "es-ES",
    "Los cobros esperan: el servidor espera a que se conecten dispositivos y coincidan con su hora (1 de 2 por ahora)",
    "Cobro no registrado: el servidor espera a que se confirme su hora. El pedido sigue abierto. Usa «Comprobar la hora» en la parte superior de la pantalla.",
    "Tarjeta cobrada, pero el cobro no está registrado: el servidor espera a que se confirme su hora. No cobres otra vez. Cuando esté confirmada, vuelve a intentar este cobro: se registra sin cobrar otra vez.",
    "Cobrado con tarjeta, pero el pago no se ha registrado: el servidor espera a que se confirme su hora. No vuelvas a cobrar. Cuando esté confirmada, el pago se registra automáticamente.",
  ],
])(
  "words the waiting start's notice, with its count, and its payment refusals, a bill payment's own (%s)",
  (locale, notice, refused, charged, billCharged) => {
    setLocale(locale);
    expect(staffNoticeText({ code: "clock.unconfirmed", params: { agreed: 1 } }).main).toBe(notice);
    expect(staffNoticeText({ code: "clock.unconfirmed", params: { agreed: 0 } }).main).toBe(
      notice.replace("(1 ", "(0 "),
    );
    expect(refusalText({ code: "clock.unconfirmed" })).toBe(refused);
    const chargedRefusal = { code: "sale.charged_not_recorded", reason: "clock_unconfirmed" };
    expect(refusalText(chargedRefusal)).toBe(charged);
    expect(refusalText(chargedRefusal, { billPayment: true })).toBe(billCharged);
  },
);

it.each(["en-GB", "es-ES"])(
  "writes a date and time of day on one line in the till's own time zone (%s)",
  (locale) => {
    setLocale(locale);
    expect(clockDateTime(new Date(2001, 0, 2, 3, 4))).toBe("02/01/2001\u00a003:04");
    expect(clockDateTime(new Date(2026, 9, 31, 17, 45).getTime())).toBe("31/10/2026\u00a017:45");
  },
);
