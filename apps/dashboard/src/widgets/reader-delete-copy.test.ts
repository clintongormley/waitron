import { afterEach, describe, expect, it } from "vitest";
import type { DeleteImpactItem } from "@waitron/shared";
import { currentLocale, setLocale } from "../i18n/t.js";
import { readerDeleteCopy } from "./reader-delete-copy.js";

const before = currentLocale();
afterEach(() => setLocale(before));

const providerName = (id: string): string => (id === "sumup" ? "SumUp" : id);
const ana = { id: "d-ana", name: "Handheld Ana" };
const bar = { id: "d-bar", name: "Bar till" };
const waiters = { id: "dp-waiters", name: "Waiters" };
const sumup = { id: "sumup", name: "sumup" };
const item = (key: string, targets = [ana], count = targets.length): DeleteImpactItem => ({
  key,
  count,
  targets,
});

type Language = {
  locale: string;
  fixed: string[];
  paying: string;
  payingUnnamed: string;
  unknownRefusal: string;
  lines: [DeleteImpactItem, string][];
};

const languages: Language[] = [
  {
    locale: "en",
    fixed: [
      "Delete reader?",
      "Why it can't be deleted",
      "What will end",
      "Settings that will be removed",
      "This can't be undone.",
      "Delete",
      "Cancel",
      "Try again",
      "Checking what will change…",
    ],
    paying: "Payment in progress on Handheld Ana, Bar till",
    payingUnnamed: "A payment is in progress",
    unknownRefusal: "That card reader no longer exists: Handheld Ana",
    lines: [
      [item("provider_pairing", [sumup]), "Unpairs it from SumUp"],
      [
        item("provider_registration_kept", [sumup]),
        "SumUp isn't connected, so the reader stays registered at SumUp. Remove it there too.",
      ],
      [item("device_reader", [bar, ana]), "Chosen on 2 devices: Bar till, Handheld Ana"],
      [item("device_reader"), "Chosen on 1 device: Handheld Ana"],
      [item("device_reader_default", [bar, ana]), "Default on 2 devices: Bar till, Handheld Ana"],
      [item("device_reader_default"), "Default on 1 device: Handheld Ana"],
      [item("profile_reader", [waiters, waiters]), "In 2 profiles: Waiters, Waiters"],
      [item("profile_reader", [waiters]), "In 1 profile: Waiters"],
      [
        item("profile_reader_default", [waiters, waiters]),
        "Default of 2 profiles: Waiters, Waiters",
      ],
      [item("profile_reader_default", [waiters]), "Default of 1 profile: Waiters"],
      [item("reader_holder"), "Handheld Ana stops holding it"],
      [item("future_link", [ana, bar], 2), "Handheld Ana, Bar till (2)"],
      [item("future_count", [], 3), "(3)"],
    ],
  },
  {
    locale: "es",
    fixed: [
      "¿Eliminar el lector?",
      "Por qué no se puede eliminar",
      "Qué finalizará",
      "Configuración que se eliminará",
      "Esta acción no se puede deshacer.",
      "Eliminar",
      "Cancelar",
      "Reintentar",
      "Comprobando qué cambiará…",
    ],
    paying: "Cobro en curso en Handheld Ana, Bar till",
    payingUnnamed: "Hay un cobro en curso",
    unknownRefusal: "Ese lector de tarjetas ya no existe: Handheld Ana",
    lines: [
      [item("provider_pairing", [sumup]), "Se desvincula de SumUp"],
      [
        item("provider_registration_kept", [sumup]),
        "SumUp no está conectado, así que el lector sigue registrado en SumUp. Elimínalo también allí.",
      ],
      [item("device_reader", [bar, ana]), "Elegido en 2 dispositivos: Bar till, Handheld Ana"],
      [item("device_reader"), "Elegido en 1 dispositivo: Handheld Ana"],
      [
        item("device_reader_default", [bar, ana]),
        "Predeterminado en 2 dispositivos: Bar till, Handheld Ana",
      ],
      [item("device_reader_default"), "Predeterminado en 1 dispositivo: Handheld Ana"],
      [item("profile_reader", [waiters, waiters]), "En 2 perfiles: Waiters, Waiters"],
      [item("profile_reader", [waiters]), "En 1 perfil: Waiters"],
      [
        item("profile_reader_default", [waiters, waiters]),
        "Predeterminado de 2 perfiles: Waiters, Waiters",
      ],
      [item("profile_reader_default", [waiters]), "Predeterminado de 1 perfil: Waiters"],
      [item("reader_holder"), "Handheld Ana deja de tenerlo"],
      [item("future_link", [ana, bar], 2), "Handheld Ana, Bar till (2)"],
      [item("future_count", [], 3), "(3)"],
    ],
  },
];

describe.each(languages)("a card reader's delete dialog copy ($locale)", (language) => {
  it("words the dialog's fixed text", () => {
    setLocale(language.locale);
    const copy = readerDeleteCopy(providerName);
    expect([
      copy.heading,
      copy.refusals,
      copy.ends,
      copy.removes,
      copy.irreversible,
      copy.confirm,
      copy.cancel,
      copy.retry,
      copy.loading,
    ]).toEqual(language.fixed);
  });

  it.each(language.lines)("words %j", (each, line) => {
    setLocale(language.locale);
    expect(readerDeleteCopy(providerName).item(each)).toBe(line);
  });

  it("words each refusal, naming the devices paying", () => {
    setLocale(language.locale);
    const copy = readerDeleteCopy(providerName);
    expect(
      copy.refusal({
        code: "reader.payment_in_progress",
        params: { readerId: "r1" },
        targets: [ana, bar],
      }),
    ).toBe(language.paying);
    expect(
      copy.refusal({ code: "reader.payment_in_progress", params: { readerId: "r1" }, targets: [] }),
    ).toBe(language.payingUnnamed);
    expect(copy.refusal({ code: "reader.not_found", params: {}, targets: [ana] })).toBe(
      language.unknownRefusal,
    );
    expect(copy.refusal({ code: "reader.not_found", params: {}, targets: [] })).toBe(
      language.unknownRefusal.split(":")[0],
    );
  });

  it("no line shows a key or a target's id, and no two keys share a line", () => {
    setLocale(language.locale);
    const copy = readerDeleteCopy(providerName);
    const keys = [
      "provider_pairing",
      "provider_registration_kept",
      "device_reader",
      "device_reader_default",
      "profile_reader",
      "profile_reader_default",
      "reader_holder",
    ];
    const named = [{ id: "0b6e-uuid", name: "Named" }];
    const lines = [
      // A pairing's target is the provider, named by its id, never a uuid.
      ...keys.map((key) =>
        copy.item(
          item(
            key,
            key === "provider_pairing" || key === "provider_registration_kept" ? [sumup] : named,
            3,
          ),
        ),
      ),
      copy.refusal({
        code: "reader.payment_in_progress",
        params: { readerId: "0b6e-uuid" },
        targets: named,
      }),
    ];
    for (const line of lines) {
      for (const key of keys) expect(line).not.toContain(key);
      expect(line).not.toContain("0b6e-uuid");
      expect(line).not.toContain("_");
      expect(line).not.toMatch(/\b(payments|reader)\.[a-z]/);
    }
    expect(new Set(lines).size).toBe(lines.length);
  });
});
