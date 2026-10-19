import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./pay-equipment.js";
import type { TillPayEquipment } from "./pay-equipment.js";
import type { DeviceEquipment, EquipmentItem, RoleEquipment } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es"));

function item(id: string, name: string, extra: Partial<EquipmentItem> = {}): EquipmentItem {
  return { id, name, portable: false, available: true, busy: false, heldBy: null, ...extra };
}

const L1 = item("r1", "Lector 1", { portable: true, provider: "sumup" });
const L2 = item("r2", "Lector 2", { portable: true, provider: "sumup" });
const L3 = item("r3", "Lector 3", { portable: true, provider: "sumup", busy: true });
const HELD = item("r4", "Lector 4", {
  portable: true,
  provider: "sumup",
  heldBy: { deviceId: "d2", deviceName: "Móvil 2", personName: "Marc" },
});
const BARRA = item("p1", "Barra");
const TERRAZA = item("p2", "Terraza");

function role(name: RoleEquipment["role"], overrides: Partial<RoleEquipment> = {}): RoleEquipment {
  return {
    role: name,
    selection: "default",
    chosenId: null,
    resolved: null,
    chosen: null,
    default: null,
    choices: [],
    ...overrides,
  };
}

const chosen = (it: EquipmentItem, choices: EquipmentItem[]): Partial<RoleEquipment> => ({
  selection: "item",
  chosenId: it.id,
  chosen: it,
  resolved: { id: it.id, name: it.name, available: it.available, provider: it.provider },
  choices,
});
const byDefault = (it: EquipmentItem, choices: EquipmentItem[]): Partial<RoleEquipment> => ({
  selection: "default",
  default: it,
  resolved: { id: it.id, name: it.name, available: it.available, provider: it.provider },
  choices,
});

function equipment(
  receipt: Partial<RoleEquipment> = chosen(BARRA, [BARRA, TERRAZA]),
  reader: Partial<RoleEquipment> = chosen(L2, [L2, L1, L3, HELD]),
): DeviceEquipment {
  return {
    roles: [
      role("receipt", receipt),
      role("payment_slip"),
      role("cash_drawer"),
      role("invoice"),
      role("card_terminal", reader),
    ],
  };
}

async function mount(props: Partial<TillPayEquipment> = {}): Promise<TillPayEquipment> {
  const { el } = await mountWidget<TillPayEquipment>("till-pay-equipment", {
    equipment: equipment(),
    ...props,
  });
  return el;
}

const q = <T extends Element = HTMLElement>(el: TillPayEquipment, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const summary = (el: TillPayEquipment) =>
  q(el, "[data-pay-equipment-summary]")!.textContent!.replace(/\s+/g, " ").trim();
const box = (el: TillPayEquipment, name: string) =>
  q<WtCombobox>(el, `wt-combobox[name="${name}"]`);
const note = (el: TillPayEquipment, role: string) =>
  q(el, `[data-pay-note="${role}"]`)?.textContent!.trim();
const disabledOf = (node: Element | null) => (node as unknown as { disabled: boolean }).disabled;

function events<T>(el: TillPayEquipment, type: string): T[] {
  const seen: T[] = [];
  el.addEventListener(type, (event) => seen.push((event as CustomEvent<T>).detail));
  return seen;
}

/** Opens the drop-down and clicks the row labelled `label` as a person would. */
async function pick(combobox: WtCombobox, label: string): Promise<void> {
  const trigger = combobox.shadowRoot!.querySelector<HTMLElement>(".trigger")!;
  await userEvent.click(trigger);
  await combobox.updateComplete;
  const option = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")].find(
    (each) => each.textContent!.trim().startsWith(label),
  );
  if (!option) throw new Error(`no option ${label}`);
  await userEvent.click(option);
  await combobox.updateComplete;
}

describe("till-pay-equipment", () => {
  describe("closed summary", () => {
    it("names the reader and where the ticket prints", async () => {
      const el = await mount();
      expect(q(el, "[data-pay-equipment-heading]")!.textContent!.trim()).toBe("Lector e impresora");
      expect(summary(el)).toBe("Lector 2 · ticket en Barra");
      expect(q(el, "[data-pay-equipment-summary] b")!.textContent).toBe("Lector 2");
      expect(box(el, "cardReaderId")).toBeNull();
    });

    it("marks a printer from the profile's default", async () => {
      const el = await mount({
        equipment: equipment(byDefault(TERRAZA, [BARRA, TERRAZA]), byDefault(L1, [L1])),
      });
      expect(summary(el)).toBe("Lector 1 · ticket en Terraza (predeterminada)");
    });

    it("says sin ticket when the profile names no printer, sin lector without a reader", async () => {
      const el = await mount({ equipment: equipment({}, {}) });
      expect(summary(el)).toBe("sin lector · sin ticket");
    });

    it("says sin lector for a switched-off reader, sin impresora for a switched-off printer", async () => {
      const off = item("p1", "Barra", { available: false });
      const offReader = item("r2", "Lector 2", { available: false, provider: "sumup" });
      const el = await mount({
        equipment: equipment(chosen(off, [BARRA]), chosen(offReader, [L1])),
      });
      expect(summary(el)).toBe("sin lector · sin impresora");
    });

    it("says sin impresora when printers are listed but none is set", async () => {
      const el = await mount({ equipment: equipment({ choices: [BARRA] }) });
      expect(summary(el)).toBe("Lector 2 · sin impresora");
    });

    it("reads Leyendo… before the equipment is read, and draws no drop-downs opened", async () => {
      const el = await mount({ equipment: null });
      expect(summary(el)).toBe("Leyendo…");
      el.open = true;
      await el.updateComplete;
      expect(q(el, "[data-pay-equipment-summary]")!.textContent!.trim()).toBe("Leyendo…");
      expect(box(el, "cardReaderId")).toBeNull();
      expect(box(el, "receiptPrinterId")).toBeNull();
    });

    it("reads in English", async () => {
      setLocale("en");
      const el = await mount({
        equipment: equipment(byDefault(TERRAZA, [TERRAZA]), chosen(L2, [L2])),
      });
      expect(q(el, "[data-pay-equipment-heading]")!.textContent!.trim()).toBe("Reader and printer");
      expect(summary(el)).toBe("Lector 2 · ticket at Terraza (default)");
      expect(q(el, "[data-pay-equipment-change]")!.textContent!.trim()).toBe("Change");
      const none = await mount({ equipment: equipment({}, {}) });
      expect(summary(none)).toBe("no reader · no ticket");
      const unset = await mount({ equipment: equipment({ choices: [TERRAZA] }) });
      expect(summary(unset)).toBe("Lector 2 · no printer");
      const reading = await mount({ equipment: null });
      expect(summary(reading)).toBe("Reading…");
    });

    it("shows a practice venue's fixed reader", async () => {
      const el = await mount({
        equipment: equipment(undefined, {}),
        fixedReader: { id: "demo", name: "Lector de prueba" },
      });
      expect(summary(el)).toBe("Lector de prueba · ticket en Barra");
      el.open = true;
      await el.updateComplete;
      const reader = box(el, "cardReaderId")!;
      expect(reader.value).toBe("demo");
      expect(reader.disabled).toBe(true);
      expect(reader.options.map((each) => each.label)).toEqual(["Lector de prueba"]);
    });

    it("names a practice venue's fixed reader before the equipment has been read", async () => {
      const el = await mount({
        equipment: null,
        fixedReader: { id: "demo", name: "Lector de prueba" },
      });
      expect(summary(el)).toBe("Lector de prueba · Leyendo…");
    });
  });

  it("Cambiar asks to open the row, and never opens it itself", async () => {
    const el = await mount();
    const toggles = events<{ open: boolean }>(el, "pay-equipment-toggle");
    expect(q(el, "[data-pay-equipment-change]")!.textContent!.trim()).toBe("Cambiar");
    await userEvent.click(q(el, "[data-pay-equipment-change]")!);
    expect(toggles).toEqual([{ open: true }]);
    expect(el.open).toBe(false);
    expect(el.hasAttribute("open")).toBe(false);
  });

  describe("opened", () => {
    it("draws both drop-downs with today's labels and no Usar el predeterminado or Ninguno", async () => {
      const el = await mount({ open: true });
      expect(el.hasAttribute("open")).toBe(true);
      expect(q(el, "[data-pay-equipment-change]")).toBeNull();
      const reader = box(el, "cardReaderId")!;
      const printer = box(el, "receiptPrinterId")!;
      expect(reader.label).toBe(t("equipment.card_terminal"));
      expect(reader.search).toBe("never");
      expect(reader.placeholder).toBe("Elige el lector que tienes en la mano");
      expect(reader.value).toBe("r2");
      expect(reader.options.map((each) => each.label)).toEqual([
        "Lector 2",
        "Lector 1",
        "Lector 3, ocupado",
        "Lector 4, lo lleva Móvil 2",
      ]);
      expect(printer.label).toBe(t("equipment.receipt"));
      expect(printer.search).toBe("never");
      expect(printer.placeholder).toBe("Elige una impresora");
      expect(printer.value).toBe("p1");
      expect(printer.options.map((each) => each.label)).toEqual(["Barra", "Terraza"]);
    });

    it("marks the reader required only while a card is the method", async () => {
      const el = await mount({ open: true });
      expect(box(el, "cardReaderId")!.required).toBe(false);
      el.cardRequired = true;
      await el.updateComplete;
      expect(box(el, "cardReaderId")!.required).toBe(true);
      expect(box(el, "receiptPrinterId")!.required).toBe(false);
    });

    it("greys out a busy reader so it cannot be picked", async () => {
      const el = await mount({ open: true });
      const busy = box(el, "cardReaderId")!.options.find((each) => each.value === "r3")!;
      expect(busy.disabled).toBe(true);
      const free = box(el, "cardReaderId")!.options.find((each) => each.value === "r1")!;
      expect(free.disabled).toBeFalsy();
    });

    it("leaves a field empty unless it is ready, and says when a ready one is the default", async () => {
      const off = item("p1", "Barra", { available: false });
      const el = await mount({
        open: true,
        equipment: equipment(chosen(off, [BARRA, TERRAZA]), byDefault(L1, [L1, L2])),
      });
      expect(box(el, "receiptPrinterId")!.value).toBe("");
      expect(box(el, "receiptPrinterId")!.hint).toBe("");
      expect(box(el, "cardReaderId")!.value).toBe("r1");
      expect(box(el, "cardReaderId")!.hint).toBe("Predeterminado del perfil");
      expect(note(el, "card_terminal")).toBe("Predeterminado del perfil");
      expect(note(el, "receipt")).toBeUndefined();
      const none = await mount({ open: true, equipment: equipment({}, { choices: [L1] }) });
      expect(box(none, "cardReaderId")!.value).toBe("");
      expect(box(none, "receiptPrinterId")!.value).toBe("");
    });

    it("keeps showing a ready reader the list no longer offers", async () => {
      const el = await mount({ open: true, equipment: equipment(undefined, chosen(L2, [L1])) });
      expect(box(el, "cardReaderId")!.value).toBe("r2");
      expect(box(el, "cardReaderId")!.options.map((each) => each.label)).toEqual([
        "Lector 2",
        "Lector 1",
      ]);
    });

    it("picking a free reader asks for it at once", async () => {
      const el = await mount({ open: true });
      const picks = events(el, "pay-equipment-pick");
      await pick(box(el, "cardReaderId")!, "Lector 1");
      expect(picks).toEqual([{ role: "card_terminal", id: "r1", takeOver: false }]);
    });

    it("picking a printer asks for the receipt role", async () => {
      const el = await mount({ open: true });
      const picks = events(el, "pay-equipment-pick");
      await pick(box(el, "receiptPrinterId")!, "Terraza");
      expect(picks).toEqual([{ role: "receipt", id: "p2", takeOver: false }]);
    });

    it("picking the reader already in use asks for nothing", async () => {
      const el = await mount({ open: true });
      const picks = events(el, "pay-equipment-pick");
      await pick(box(el, "cardReaderId")!, "Lector 2");
      expect(picks).toEqual([]);
    });

    it("picking a reader another phone holds asks first, and takes it only on Quitárselo", async () => {
      const el = await mount({ open: true });
      const picks = events(el, "pay-equipment-pick");
      await pick(box(el, "cardReaderId")!, "Lector 4");
      expect(picks).toEqual([]);
      expect(q(el, "[data-pay-take-title]")!.textContent!.trim()).toBe(
        "¿Quitárselo a otro dispositivo?",
      );
      expect(q(el, "[data-pay-take-question]")!.textContent!.trim()).toBe(
        "¿Quitar Lector 4 a Móvil 2 (Marc)?",
      );
      expect(box(el, "cardReaderId")!.value).toBe("r2");
      expect(q(el, "[data-pay-take]")!.textContent!.trim()).toBe("Quitárselo");
      await userEvent.click(q(el, "[data-pay-take]")!);
      expect(picks).toEqual([{ role: "card_terminal", id: "r4", takeOver: true }]);
      expect(q(el, "[data-pay-take-title]")).toBeNull();
    });

    it("names only the device when nobody is signed in on it", async () => {
      const lone = { ...HELD, heldBy: { deviceId: "d2", deviceName: "Móvil 2", personName: null } };
      const el = await mount({
        open: true,
        equipment: equipment(undefined, chosen(L2, [L2, lone])),
      });
      await pick(box(el, "cardReaderId")!, "Lector 4");
      expect(q(el, "[data-pay-take-question]")!.textContent!.trim()).toBe(
        "¿Quitar Lector 4 a Móvil 2?",
      );
    });

    it("Cerrar in the question takes nothing", async () => {
      const el = await mount({ open: true });
      const picks = events(el, "pay-equipment-pick");
      await pick(box(el, "cardReaderId")!, "Lector 4");
      expect(q(el, "[data-pay-take-back]")!.textContent!.trim()).toBe("Cerrar");
      await userEvent.click(q(el, "[data-pay-take-back]")!);
      expect(picks).toEqual([]);
      expect(q(el, "[data-pay-take-title]")).toBeNull();
    });

    it("forgets an open question when the row closes", async () => {
      const el = await mount({ open: true });
      await pick(box(el, "cardReaderId")!, "Lector 4");
      el.open = false;
      await el.updateComplete;
      el.open = true;
      await el.updateComplete;
      expect(q(el, "[data-pay-take-title]")).toBeNull();
    });

    it("shows the item being saved with Guardando… under its field", async () => {
      const el = await mount({ open: true, saving: { role: "card_terminal", id: "r1" } });
      expect(box(el, "cardReaderId")!.value).toBe("r1");
      expect(box(el, "cardReaderId")!.hint).toBe("Guardando…");
      expect(note(el, "card_terminal")).toBe("Guardando…");
      expect(box(el, "receiptPrinterId")!.hint).toBe("");
      el.saving = { role: "receipt", id: "p2" };
      await el.updateComplete;
      expect(box(el, "receiptPrinterId")!.value).toBe("p2");
      expect(box(el, "receiptPrinterId")!.hint).toBe("Guardando…");
    });

    it("shows a field's refusal under that field", async () => {
      const el = await mount({
        open: true,
        fieldErrors: { card_terminal: "Ese lector está ocupado" },
      });
      expect(box(el, "cardReaderId")!.error).toBe("Ese lector está ocupado");
      expect(box(el, "cardReaderId")!.invalid).toBe(true);
      expect(box(el, "receiptPrinterId")!.error).toBe("");
      el.fieldErrors = { receipt: "No" };
      await el.updateComplete;
      expect(box(el, "receiptPrinterId")!.error).toBe("No");
    });
  });

  describe("QR and NFC", () => {
    for (const open of [false, true]) {
      it(`show only when asked for, and send their events (${open ? "opened" : "closed"})`, async () => {
        const el = await mount({ open });
        expect(q(el, "[data-pay-qr]")).toBeNull();
        expect(q(el, "[data-pay-nfc]")).toBeNull();
        el.canScan = true;
        el.askNfc = true;
        await el.updateComplete;
        expect(el.shadowRoot!.querySelectorAll("[data-pay-qr]").length).toBe(1);
        expect(el.shadowRoot!.querySelectorAll("[data-pay-nfc]").length).toBe(1);
        const qr = q(el, "[data-pay-qr]")!;
        const nfc = q(el, "[data-pay-nfc]")!;
        expect(qr.textContent!.trim()).toBe("QR");
        expect(qr.getAttribute("aria-label")).toBe(t("equipment.scan_qr"));
        expect(nfc.textContent!.trim()).toBe("NFC");
        expect(nfc.getAttribute("aria-label")).toBe(t("equipment.nfc_allow"));
        const qrs = events(el, "pay-equipment-qr");
        const nfcs = events(el, "pay-equipment-nfc");
        await userEvent.click(qr);
        await userEvent.click(nfc);
        expect(qrs).toHaveLength(1);
        expect(nfcs).toHaveLength(1);
      });
    }

    it("the events bubble out of a shadow root", async () => {
      const el = await mount({ canScan: true });
      const outer: string[] = [];
      document.body.addEventListener("pay-equipment-qr", () => outer.push("qr"), { once: true });
      await userEvent.click(q(el, "[data-pay-qr]")!);
      expect(outer).toEqual(["qr"]);
    });
  });

  it("shows why the reader went, above the row", async () => {
    const el = await mount();
    expect(q(el, "[data-pay-reader-reason]")).toBeNull();
    el.readerReason = "Móvil 2 (Marc) se ha llevado Lector 2";
    await el.updateComplete;
    expect(q(el, "[data-pay-reader-reason]")!.textContent!.trim()).toBe(
      "Móvil 2 (Marc) se ha llevado Lector 2",
    );
  });

  it("disabled disables Cambiar, QR, NFC and both drop-downs", async () => {
    const el = await mount({ canScan: true, askNfc: true, disabled: true });
    expect(disabledOf(q(el, "[data-pay-equipment-change]"))).toBe(true);
    expect(disabledOf(q(el, "[data-pay-qr]"))).toBe(true);
    expect(disabledOf(q(el, "[data-pay-nfc]"))).toBe(true);
    el.open = true;
    await el.updateComplete;
    expect(disabledOf(q(el, "[data-pay-qr]"))).toBe(true);
    expect(disabledOf(q(el, "[data-pay-nfc]"))).toBe(true);
    expect(box(el, "cardReaderId")!.disabled).toBe(true);
    expect(box(el, "receiptPrinterId")!.disabled).toBe(true);
  });

  it("keeps Cambiar, QR and NFC inside the row at 390 px with long names", async () => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(390, 900);
    try {
      expect(window.innerWidth).toBe(390);
      const longReader = item("r9", "Lector de tarjetas de la terraza oeste 2", {
        provider: "sumup",
      });
      const longPrinter = item("p9", "Impresora de tickets de la barra central");
      expect(longReader.name).toHaveLength(40);
      expect(longPrinter.name).toHaveLength(40);
      const el = await mount({
        canScan: true,
        askNfc: true,
        equipment: equipment(chosen(longPrinter, [longPrinter]), chosen(longReader, [longReader])),
      });
      const row = q(el, "[data-pay-equipment]")!.getBoundingClientRect();
      expect(row.right).toBeLessThanOrEqual(390);
      for (const selector of ["[data-pay-equipment-change]", "[data-pay-qr]", "[data-pay-nfc]"]) {
        const button = q(el, selector)!.getBoundingClientRect();
        expect(button.right, selector).toBeLessThanOrEqual(row.right);
        expect(button.left, selector).toBeGreaterThanOrEqual(row.left);
      }
      const text = q(el, "[data-pay-equipment-summary]")!.getBoundingClientRect();
      expect(text.right).toBeLessThanOrEqual(row.right);
    } finally {
      await page.viewport(viewport.width, viewport.height);
    }
  });
});
