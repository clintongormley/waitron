import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import "./equipment-dialog.js";
import type { TillEquipmentDialog } from "./equipment-dialog.js";
import type {
  DeviceEquipment,
  EquipmentChange,
  EquipmentItem,
  EquipmentRole,
  RoleEquipment,
} from "../api/client.js";

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
});
beforeEach(() => setLocale("en"));

function item(id: string, name: string, extra: Partial<EquipmentItem> = {}): EquipmentItem {
  return { id, name, portable: false, available: true, busy: false, heldBy: null, ...extra };
}

const P1 = item("P1", "Counter printer");
const P2 = item("P2", "Bar printer");
const PP = item("PP", "Portable printer", { portable: true });
const R1 = item("R1", "Reader one", { portable: true });
const R2 = item("R2", "Reader two", { portable: true });
const D1 = item("D1", "Counter drawer");
const BAR = { deviceId: "dev-bar", deviceName: "Bar till", personName: "Ana" };

/** A role following its profile's default, resolving to the default unless told otherwise. */
function onDefault(
  role: EquipmentRole,
  fallback: EquipmentItem | null,
  choices: EquipmentItem[],
  resolved: EquipmentItem | null = fallback?.heldBy === null ? fallback : null,
): RoleEquipment {
  return {
    role,
    selection: "default",
    chosenId: null,
    resolved: resolved === null ? null : { ...resolved },
    chosen: null,
    default: fallback,
    choices,
  };
}

/** A role on an item chosen on this device. */
function onItem(
  role: EquipmentRole,
  chosen: EquipmentItem,
  choices: EquipmentItem[],
  fallback: EquipmentItem | null = null,
): RoleEquipment {
  return {
    role,
    selection: "item",
    chosenId: chosen.id,
    resolved: chosen.heldBy === null ? { ...chosen } : null,
    chosen,
    default: fallback,
    choices,
  };
}

function resolvedOf(
  role: RoleEquipment["resolved"],
): { id: string; name: string; available: boolean } | null {
  return role === null ? null : { id: role.id, name: role.name, available: role.available };
}

/** The four roles in the server's order: receipt, slip, drawer, reader. */
function equipment(roles: Partial<Record<EquipmentRole, RoleEquipment>> = {}): DeviceEquipment {
  const all: RoleEquipment[] = [
    roles.receipt ?? onItem("receipt", P1, [P1, P2], P1),
    roles.payment_slip ?? onDefault("payment_slip", PP, [PP]),
    roles.cash_drawer ?? onDefault("cash_drawer", D1, [D1]),
    roles.card_terminal ?? onDefault("card_terminal", R1, [R1, R2]),
  ];
  return { roles: all.map((role) => ({ ...role, resolved: resolvedOf(role.resolved) })) };
}

async function mountDialog(props: Partial<TillEquipmentDialog> = {}): Promise<TillEquipmentDialog> {
  const { el } = await mountWidget<TillEquipmentDialog>("till-equipment-dialog", {
    open: true,
    equipment: equipment(),
    ...props,
  });
  return el;
}

const combobox = (el: TillEquipmentDialog, name: string) =>
  el.shadowRoot!.querySelector<WtCombobox>(`wt-combobox[name="${name}"]`);
const row = (el: TillEquipmentDialog, role: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-equipment-row="${role}"]`);
const resolvedText = (el: TillEquipmentDialog, role: string) =>
  row(el, role)?.querySelector("[data-equipment-resolved]")?.textContent?.trim();
const contextText = (el: TillEquipmentDialog, role: string) =>
  row(el, role)?.querySelector("[data-equipment-context]")?.textContent?.trim();
const optionLabels = (box: WtCombobox) => box.options.map((option) => option.label);
const confirmation = (el: TillEquipmentDialog) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-confirm]");
const bottom = (el: TillEquipmentDialog) =>
  el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error;

function changes(el: TillEquipmentDialog): EquipmentChange[] {
  const seen: EquipmentChange[] = [];
  el.addEventListener("equipment-change", (event) =>
    seen.push((event as CustomEvent<EquipmentChange>).detail),
  );
  return seen;
}

describe("till-equipment-dialog", () => {
  it("shows each role's resolved equipment, including None, in the order staff use them", async () => {
    const el = await mountDialog({
      equipment: equipment({ cash_drawer: onDefault("cash_drawer", null, [D1]) }),
    });

    const rows = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-equipment-row]")];
    expect(rows.map((each) => each.dataset.equipmentRow)).toEqual([
      "receipt",
      "payment_slip",
      "card_terminal",
      "cash_drawer",
    ]);
    expect(
      rows.map((each) => each.querySelector("[data-equipment-label]")!.textContent!.trim()),
    ).toEqual([
      t("equipment.receipt"),
      t("equipment.payment_slip"),
      t("equipment.card_terminal"),
      t("equipment.cash_drawer"),
    ]);
    expect(resolvedText(el, "receipt")).toBe("Counter printer");
    expect(resolvedText(el, "payment_slip")).toBe("Portable printer");
    expect(resolvedText(el, "card_terminal")).toBe("Reader one");
    expect(resolvedText(el, "cash_drawer")).toBe(t("equipment.none"));
    expect(combobox(el, "receiptPrinterId")!.label).toBe(t("equipment.receipt"));
    expect(combobox(el, "paymentSlipPrinterId")).not.toBeNull();
    expect(combobox(el, "cardReaderId")).not.toBeNull();
    expect(combobox(el, "cashDrawerPrinterId")).not.toBeNull();
  });

  it("says where each role's equipment comes from", async () => {
    const el = await mountDialog();

    expect(contextText(el, "receipt")).toBe(t("equipment.chosen_here"));
    expect(contextText(el, "card_terminal")).toBe(t("equipment.from_default"));
  });

  it("leaves out a role with nothing to choose, nothing chosen and no default", async () => {
    const el = await mountDialog({
      equipment: equipment({ cash_drawer: onDefault("cash_drawer", null, []) }),
    });

    expect(row(el, "cash_drawer")).toBeNull();
    expect(row(el, "receipt")).not.toBeNull();
  });

  it("Use default shows what it resolves to, and None where the profile has no default", async () => {
    const el = await mountDialog({
      equipment: equipment({ cash_drawer: onDefault("cash_drawer", null, [D1]) }),
    });

    const reader = combobox(el, "cardReaderId")!;
    expect(reader.options[0]).toEqual({
      value: "",
      label: t("equipment.use_default").replace("{name}", "Reader one"),
    });
    expect(reader.value).toBe("");
    expect(optionLabels(combobox(el, "cashDrawerPrinterId")!)[0]).toBe(
      t("equipment.use_default").replace("{name}", t("equipment.none")),
    );
    const receipt = combobox(el, "receiptPrinterId")!;
    expect(receipt.options.map((option) => option.value)).toEqual(["", "P1", "P2"]);
    expect(receipt.value).toBe("P1");
  });

  it("a closed list on Use default reads as its Use default choice", async () => {
    const el = await mountDialog({
      equipment: equipment({ cash_drawer: onDefault("cash_drawer", null, [D1]) }),
    });

    expect(combobox(el, "cardReaderId")!.placeholder).toBe(
      t("equipment.use_default").replace("{name}", "Reader one"),
    );
    expect(combobox(el, "cashDrawerPrinterId")!.placeholder).toBe(
      t("equipment.use_default").replace("{name}", t("equipment.none")),
    );
  });

  it("a held item is labelled with its holder, and a held default says who carries it", async () => {
    const held = { ...PP, heldBy: BAR };
    const el = await mountDialog({
      equipment: equipment({ payment_slip: onDefault("payment_slip", held, [P2, held]) }),
    });

    expect(optionLabels(combobox(el, "paymentSlipPrinterId")!)).toEqual([
      t("equipment.use_default").replace("{name}", "Portable printer"),
      "Bar printer",
      t("equipment.option_held")
        .replace("{item}", "Portable printer")
        .replace("{device}", "Bar till"),
    ]);
    expect(resolvedText(el, "payment_slip")).toBe(t("equipment.none"));
    expect(contextText(el, "payment_slip")).toBe(
      t("equipment.held_by_person")
        .replace("{item}", "Portable printer")
        .replace("{device}", "Bar till")
        .replace("{person}", "Ana"),
    );
  });

  it("names only the device when nobody is signed in on it", async () => {
    const held = { ...PP, heldBy: { ...BAR, personName: null } };
    const el = await mountDialog({
      equipment: equipment({ payment_slip: onDefault("payment_slip", held, [held]) }),
    });

    expect(contextText(el, "payment_slip")).toBe(
      t("equipment.held_by").replace("{item}", "Portable printer").replace("{device}", "Bar till"),
    );
  });

  it("a busy reader is labelled busy", async () => {
    const busy = { ...R2, busy: true };
    const el = await mountDialog({
      equipment: equipment({ card_terminal: onDefault("card_terminal", R1, [R1, busy]) }),
    });

    expect(optionLabels(combobox(el, "cardReaderId")!)[2]).toBe(
      t("equipment.option_busy").replace("{item}", "Reader two"),
    );
  });

  it("a busy reader another device carries is labelled busy, and picking it sends at once with no question", async () => {
    const heldAndBusy = { ...R2, heldBy: BAR, busy: true };
    const el = await mountDialog({
      equipment: equipment({ card_terminal: onDefault("card_terminal", R1, [R1, heldAndBusy]) }),
    });
    const seen = changes(el);

    expect(optionLabels(combobox(el, "cardReaderId")!)[2]).toBe(
      t("equipment.option_busy").replace("{item}", "Reader two"),
    );
    await chooseOption(combobox(el, "cardReaderId")!, "R2");
    await el.updateComplete;

    expect(confirmation(el)).toBeNull();
    expect(seen).toEqual([
      { role: "card_terminal", selection: { id: "R2" }, via: "list", takeOver: false },
    ]);
  });

  it("picking a held item asks, naming the device and person, and only a confirm sends takeOver", async () => {
    const held = { ...R2, heldBy: BAR };
    const el = await mountDialog({
      equipment: equipment({ card_terminal: onDefault("card_terminal", R1, [R1, held]) }),
    });
    const seen = changes(el);
    const reader = combobox(el, "cardReaderId")!;

    await chooseOption(reader, "R2");
    await el.updateComplete;

    expect(seen).toEqual([]);
    expect(confirmation(el)!.textContent).toContain(
      t("equipment.take_question_person")
        .replace("{item}", "Reader two")
        .replace("{device}", "Bar till")
        .replace("{person}", "Ana"),
    );
    confirmation(el)!.querySelector<HTMLElement>("[data-equipment-cancel]")!.click();
    await el.updateComplete;
    expect(confirmation(el)).toBeNull();
    expect(seen).toEqual([]);
    expect(reader.value).toBe("");

    await chooseOption(reader, "R2");
    await el.updateComplete;
    confirmation(el)!.querySelector<HTMLElement>("[data-equipment-take]")!.click();
    await el.updateComplete;

    expect(seen).toEqual([
      { role: "card_terminal", selection: { id: "R2" }, via: "list", takeOver: true },
    ]);
    expect(confirmation(el)).toBeNull();
  });

  it("asks without a person's name when nobody is signed in on the holder", async () => {
    const held = { ...R2, heldBy: { ...BAR, personName: null } };
    const el = await mountDialog({
      equipment: equipment({ card_terminal: onDefault("card_terminal", R1, [R1, held]) }),
    });

    await chooseOption(combobox(el, "cardReaderId")!, "R2");
    await el.updateComplete;

    expect(confirmation(el)!.textContent).toContain(
      t("equipment.take_question").replace("{item}", "Reader two").replace("{device}", "Bar till"),
    );
  });

  it("puts the list back when the question is dismissed", async () => {
    const held = { ...R2, heldBy: BAR };
    const el = await mountDialog({
      equipment: equipment({ card_terminal: onDefault("card_terminal", R1, [R1, held]) }),
    });
    const seen = changes(el);

    await chooseOption(combobox(el, "cardReaderId")!, "R2");
    await el.updateComplete;
    confirmation(el)!.dispatchEvent(new CustomEvent("wt-close"));
    await el.updateComplete;

    expect(confirmation(el)).toBeNull();
    expect(combobox(el, "cardReaderId")!.value).toBe("");
    expect(seen).toEqual([]);
  });

  it("picking a free item sends at once, with no question", async () => {
    const el = await mountDialog();
    const seen = changes(el);

    await chooseOption(combobox(el, "receiptPrinterId")!, "P2");

    expect(confirmation(el)).toBeNull();
    expect(seen).toEqual([
      { role: "receipt", selection: { id: "P2" }, via: "list", takeOver: false },
    ]);
  });

  it("choosing Use default sends the role back to its default", async () => {
    const el = await mountDialog();
    const seen = changes(el);

    await chooseOption(combobox(el, "receiptPrinterId")!, "");

    expect(seen).toEqual([{ role: "receipt", selection: "default", via: "list", takeOver: false }]);
  });

  it("goes back to the device's choice after a pick the app could not make", async () => {
    const el = await mountDialog();
    const picker = combobox(el, "receiptPrinterId")!;

    await chooseOption(picker, "P2");
    el.error = { code: "server.internal" };
    await el.updateComplete;

    expect(picker.value).toBe("P1");
  });

  it("a reader.payment_in_progress refusal shows under the reader row", async () => {
    const el = await mountDialog();

    el.error = { code: "reader.payment_in_progress" };
    await el.updateComplete;

    expect(combobox(el, "cardReaderId")!.error).toBe(codeMessage("reader.payment_in_progress"));
    expect(combobox(el, "receiptPrinterId")!.error).toBe("");
    expect(bottom(el)).toBe(t("form.fix_fields"));
  });

  it.each([
    ["receiptPrinterId", "device.binding_invalid"],
    ["paymentSlipPrinterId", "device.equipment_held"],
    ["cashDrawerPrinterId", "device.binding_invalid"],
    ["cardReaderId", "device.binding_invalid"],
  ])(
    "shows a refusal naming %s under that field, and the generic sentence at the bottom",
    async (field, code) => {
      const el = await mountDialog();

      el.error = { code, field };
      await el.updateComplete;

      expect(combobox(el, field)!.error).toBe(codeMessage(code));
      expect(combobox(el, field)!.invalid).toBe(true);
      expect(bottom(el)).toBe(t("form.fix_fields"));
    },
  );

  it("shows a refusal naming no field it shows at the bottom in its own words", async () => {
    const el = await mountDialog({
      equipment: equipment({ cash_drawer: onDefault("cash_drawer", null, []) }),
    });

    el.error = { code: "device.binding_invalid", field: "cashDrawerPrinterId" };
    await el.updateComplete;

    expect(combobox(el, "receiptPrinterId")!.error).toBe("");
    expect(bottom(el)).toBe(codeMessage("device.binding_invalid"));
  });

  it("a switched-off chosen printer stays shown as chosen, marked switched off", async () => {
    const off = { ...P2, available: false };
    const el = await mountDialog({
      equipment: equipment({ receipt: onItem("receipt", off, [P1], P1) }),
    });

    const picker = combobox(el, "receiptPrinterId")!;
    expect(picker.value).toBe("P2");
    expect(picker.options.at(-1)).toEqual({
      value: "P2",
      label: t("equipment.switched_off").replace("{item}", "Bar printer"),
    });
    expect(resolvedText(el, "receipt")).toBe("Bar printer");
    expect(contextText(el, "receipt")).toBe(
      t("equipment.switched_off").replace("{item}", "Bar printer"),
    );
  });

  it("an explicit choice another device now holds shows as held, resolving None", async () => {
    const held = { ...PP, heldBy: BAR };
    const el = await mountDialog({
      equipment: equipment({ receipt: onItem("receipt", held, [P1, held], P1) }),
    });

    expect(combobox(el, "receiptPrinterId")!.value).toBe("PP");
    expect(resolvedText(el, "receipt")).toBe(t("equipment.none"));
    expect(contextText(el, "receipt")).toBe(
      t("equipment.held_by_person")
        .replace("{item}", "Portable printer")
        .replace("{device}", "Bar till")
        .replace("{person}", "Ana"),
    );
  });

  it("sends nothing when the current choice is picked again", async () => {
    const el = await mountDialog();
    const seen = changes(el);

    await chooseOption(combobox(el, "receiptPrinterId")!, "P1");

    expect(seen).toEqual([]);
  });

  it("offers Scan on the receipt, slip and reader rows, not the cash drawer", async () => {
    const el = await mountDialog();

    const scans = [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-equipment-scan]")];
    expect(
      scans.map((each) => each.closest<HTMLElement>("[data-equipment-row]")!.dataset.equipmentRow),
    ).toEqual(["receipt", "payment_slip", "card_terminal"]);
    expect(scans[0]!.textContent!.trim()).toBe(t("equipment.scan"));
  });

  it("offers no Scan where the browser has no camera access", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    try {
      const el = await mountDialog();
      expect(el.shadowRoot!.querySelector("[data-equipment-scan]")).toBeNull();
    } finally {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });

  it("Scan films for that row's kind, and a scanned label is sent as a scan", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const el = await mountDialog();
    const seen = changes(el);

    row(el, "card_terminal")!.querySelector<HTMLElement>("[data-equipment-scan]")!.click();
    await el.updateComplete;
    const scanner = el.shadowRoot!.querySelector("till-equipment-scanner")!;
    expect(scanner.kind).toBe("reader");
    expect(combobox(el, "receiptPrinterId")).toBeNull();
    scanner.dispatchEvent(
      new CustomEvent("equipment-scanned", { detail: { id: "R2" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;

    expect(seen).toEqual([
      { role: "card_terminal", selection: { id: "R2" }, via: "scan", takeOver: false },
    ]);
    expect(el.shadowRoot!.querySelector("till-equipment-scanner")).toBeNull();
    expect(combobox(el, "cardReaderId")).not.toBeNull();
  });

  it("a printer row's Scan films for a printer, and Back returns to the list sending nothing", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const el = await mountDialog();
    const seen = changes(el);

    row(el, "payment_slip")!.querySelector<HTMLElement>("[data-equipment-scan]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-equipment-scanner")!.kind).toBe("printer");
    el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-scan-back]")!.click();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("till-equipment-scanner")).toBeNull();
    expect(combobox(el, "paymentSlipPrinterId")).not.toBeNull();
    expect(seen).toEqual([]);
  });

  it("opens on the list again after it was closed while scanning", async () => {
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    const el = await mountDialog();
    row(el, "receipt")!.querySelector<HTMLElement>("[data-equipment-scan]")!.click();
    await el.updateComplete;

    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("till-equipment-scanner")).toBeNull();
    expect(combobox(el, "receiptPrinterId")).not.toBeNull();
  });

  it("draws nothing while closed, or before the equipment is known", async () => {
    expect((await mountDialog({ open: false })).shadowRoot!.querySelector("wt-dialog")).toBeNull();
    const unknown = await mountDialog({ equipment: null });
    expect(unknown.shadowRoot!.querySelector("[data-equipment-row]")).toBeNull();
  });

  it("closes when the dialog is dismissed", async () => {
    const el = await mountDialog();
    let closed = 0;
    el.addEventListener("close", () => (closed += 1));

    el.shadowRoot!.querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));

    expect(closed).toBe(1);
  });

  it("closes from its Close button", async () => {
    const el = await mountDialog();
    let closed = 0;
    el.addEventListener("close", () => (closed += 1));

    el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-close]")!.click();

    expect(closed).toBe(1);
  });
});
