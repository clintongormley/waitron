import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { WtCombobox } from "@waitron/ui";
import { TillApi, type EquipmentChange } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import {
  FakeNdefReader,
  installNfc,
  NFC_EQUIPMENT,
  PRINTER_ID,
  READER_ID,
} from "../../test/equipment-nfc.js";
import "./equipment-dialog.js";
import type { TillEquipmentDialog } from "./equipment-dialog.js";

beforeEach(() => {
  setLocale("en");
  FakeNdefReader.instances = [];
});
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setLocale("en");
});

async function mount(props: Partial<TillEquipmentDialog> = {}) {
  return (
    await mountWidget<TillEquipmentDialog>("till-equipment-dialog", {
      open: true,
      equipment: NFC_EQUIPMENT,
      ...props,
    })
  ).el;
}
async function reader() {
  await vi.waitFor(() => expect(FakeNdefReader.instances.at(-1)?.signal).toBeDefined());
  return FakeNdefReader.instances.at(-1)!;
}
function changes(el: TillEquipmentDialog) {
  const seen: EquipmentChange[] = [];
  el.addEventListener("equipment-change", (event) =>
    seen.push((event as CustomEvent<EquipmentChange>).detail),
  );
  return seen;
}
function scanRow(el: TillEquipmentDialog, role: string) {
  el.shadowRoot!.querySelector<HTMLElement>(
    `[data-equipment-row="${role}"] [data-equipment-scan]`,
  )!.click();
}
const code = (kind: string, id: string) => `waitron-equipment:${kind}:${id}`;

describe("equipment dialog NFC", () => {
  it("an NFC-only row Scan retries after a recoverable reader-start failure", async () => {
    installNfc();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    FakeNdefReader.scanResult = () =>
      Promise.reject(new DOMException("not ready", "NotReadableError"));
    try {
      const el = await mount();
      const seen = changes(el);
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-equipment-nfc-message]")?.textContent).toContain(
          "NFC is not available",
        ),
      );
      FakeNdefReader.scanResult = () => Promise.resolve();
      scanRow(el, "receipt");
      await el.updateComplete;
      await vi.waitFor(() => expect(FakeNdefReader.instances).toHaveLength(2));
      (await reader()).read(code("printer", PRINTER_ID));
      expect(seen).toEqual([
        { role: "receipt", selection: { id: PRINTER_ID }, via: "scan", takeOver: false },
      ]);
    } finally {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });
  it("an unoffered Waitron label explains device availability rather than calling the label foreign", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    (await reader()).read(code("printer", "c45f83b1-3333-4333-8333-333333333333"));
    await el.updateComplete;
    expect(seen).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-equipment-nfc-message]")!.textContent).toContain(
      "not available to this device",
    );
  });
  it("a printer offered only for receipts cannot fill an armed payment-slip row", async () => {
    installNfc();
    const OTHER = "c45f83b1-3333-4333-8333-333333333333";
    const equipment = {
      roles: NFC_EQUIPMENT.roles.map((role) =>
        role.role === "payment_slip"
          ? { ...role, choices: [{ ...role.choices[0]!, id: OTHER, name: "Slip-only printer" }] }
          : role,
      ),
    };
    const el = await mount({ equipment });
    const seen = changes(el);
    const nfc = await reader();
    scanRow(el, "payment_slip");
    await el.updateComplete;
    nfc.read(code("printer", PRINTER_ID));
    expect(seen).toEqual([]);
    nfc.read(code("printer", OTHER));
    expect(seen).toEqual([
      { role: "payment_slip", selection: { id: OTHER }, via: "scan", takeOver: false },
    ]);
  });
  it("invalid UTF-8 bytes in a text label make no selection", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const nfc = await reader();
    const prefix = new TextEncoder().encode(code("reader", READER_ID));
    const bytes = new Uint8Array(prefix.length + 1);
    bytes.set(prefix);
    bytes[bytes.length - 1] = 0xff;
    const event = new Event("reading");
    Object.assign(event, {
      message: {
        records: [{ recordType: "text", encoding: "utf-8", data: new DataView(bytes.buffer) }],
      },
    });
    nfc.dispatchEvent(event);
    expect(seen).toEqual([]);
    nfc.read(code("reader", READER_ID));
    expect(seen).toHaveLength(1);
  });

  it("equipment kind stays significant when a printer and reader share the same id", async () => {
    installNfc();
    const equipment = {
      roles: NFC_EQUIPMENT.roles.map((role) =>
        role.role === "card_terminal"
          ? { ...role, choices: [{ ...role.choices[0]!, id: PRINTER_ID }] }
          : role,
      ),
    };
    const el = await mount({ equipment });
    const seen = changes(el);
    const nfc = await reader();
    scanRow(el, "card_terminal");
    await el.updateComplete;
    nfc.read(code("printer", PRINTER_ID));
    expect(seen).toEqual([]);
    nfc.read(code("reader", PRINTER_ID));
    expect(seen).toEqual([
      { role: "card_terminal", selection: { id: PRINTER_ID }, via: "scan", takeOver: false },
    ]);
  });

  it("a read arriving between open=false and redraw sends nothing", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const nfc = await reader();
    el.open = false;
    nfc.read(code("reader", READER_ID));
    expect(seen).toEqual([]);
    await el.updateComplete;
    expect(nfc.signal!.aborted).toBe(true);
  });
  it("a tap does not dismiss a list's outstanding takeover question", async () => {
    installNfc();
    const held = {
      ...NFC_EQUIPMENT.roles[2]!.choices[0]!,
      heldBy: { deviceId: "other", deviceName: "Other till", personName: "Ana" },
    };
    const equipment = {
      roles: NFC_EQUIPMENT.roles.map((role) =>
        role.role === "card_terminal" ? { ...role, choices: [held] } : role,
      ),
    };
    const el = await mount({ equipment });
    const seen = changes(el);
    const nfc = await reader();
    await chooseOption(
      el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="cardReaderId"]')!,
      READER_ID,
    );
    await el.updateComplete;
    nfc.read(code("printer", PRINTER_ID));
    expect(seen).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-equipment-confirm]")).not.toBeNull();
  });
  it("Back from an NFC row keeps one scanner active", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const nfc = await reader();
    scanRow(el, "receipt");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-scan-back]")!.click();
    await el.updateComplete;
    expect(FakeNdefReader.instances).toHaveLength(1);
    nfc.read(code("printer", PRINTER_ID));
    expect(seen).toEqual([{ kind: "printer", selection: { id: PRINTER_ID }, via: "scan" }]);
  });
  it("two recognised labels on one sticker make no selection", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const nfc = await reader();
    const event = new Event("reading");
    Object.assign(event, {
      message: {
        records: [PRINTER_ID, READER_ID].map((id, i) => ({
          recordType: "text",
          encoding: "utf-8",
          data: new DataView(
            new TextEncoder().encode(code(i === 0 ? "printer" : "reader", id)).buffer,
          ),
        })),
      },
    });
    nfc.dispatchEvent(event);
    expect(seen).toEqual([]);
    nfc.read(code("printer", PRINTER_ID));
    expect(seen).toHaveLength(1);
  });
  it("an absent encoding uses UTF-8 and canonicalises the id", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    (await reader()).read(code("reader", READER_ID.toUpperCase()), "text", "");
    expect(seen).toEqual([{ kind: "reader", selection: { id: READER_ID }, via: "scan" }]);
  });
  it("no equipment snapshot means a tap makes no choice", async () => {
    installNfc();
    const el = await mount({ equipment: null });
    const seen = changes(el);
    (await reader()).read(code("reader", READER_ID));
    expect(seen).toEqual([]);
  });
  it("a printer label cannot fill the card reader row", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const nfc = await reader();
    scanRow(el, "card_terminal");
    await el.updateComplete;
    nfc.read(code("printer", PRINTER_ID));
    await el.updateComplete;
    expect(seen).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-equipment-nfc-message]")!.textContent).toContain(
      "not for a card reader",
    );
  });
  it("the native close aborts scanning", async () => {
    installNfc();
    const el = await mount();
    const nfc = await reader();
    el.shadowRoot!.querySelector("wt-dialog")!.dispatchEvent(new CustomEvent("wt-close"));
    expect(nfc.signal!.aborted).toBe(true);
  });

  it("an old permission grant cannot start NFC in a new prompt-only opening", async () => {
    installNfc();
    let answer!: (value: PermissionStatus) => void;
    vi.mocked(navigator.permissions.query).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const el = await mount();
    el.open = false;
    await el.updateComplete;
    const current = Object.assign(new EventTarget(), { state: "prompt" }) as PermissionStatus;
    vi.mocked(navigator.permissions.query).mockResolvedValue(current);
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-equipment-nfc-allow]")).not.toBeNull(),
    );
    answer(Object.assign(new EventTarget(), { state: "granted" }) as PermissionStatus);
    await Promise.resolve();
    await el.updateComplete;
    expect(FakeNdefReader.instances).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-equipment-nfc-allow]")).not.toBeNull();
  });
  it("a permission answer after close cannot start scanning", async () => {
    installNfc();
    let answer!: (value: PermissionStatus) => void;
    vi.mocked(navigator.permissions.query).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const el = await mount();
    el.open = false;
    await el.updateComplete;
    answer(Object.assign(new EventTarget(), { state: "granted" }) as PermissionStatus);
    await Promise.resolve();
    await el.updateComplete;
    expect(FakeNdefReader.instances).toEqual([]);
  });
  it("revoking permission aborts and a later grant resumes", async () => {
    const permission = installNfc();
    const el = await mount();
    const seen = changes(el);
    const old = await reader();
    Object.assign(permission, { state: "denied" });
    permission.dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(old.signal!.aborted).toBe(true);
    old.read(code("reader", READER_ID));
    expect(seen).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-equipment-nfc]")).toBeNull();
    Object.assign(permission, { state: "granted" });
    permission.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(FakeNdefReader.instances).toHaveLength(2));
    (await reader()).read(code("reader", READER_ID));
    expect(seen).toHaveLength(1);
  });
  it("a late scan rejection cannot replace the reopened dialog's NFC state", async () => {
    installNfc();
    let refuse!: (error: Error) => void;
    FakeNdefReader.scanResult = () =>
      new Promise((_resolve, reject) => {
        refuse = reject;
      });
    const el = await mount();
    const old = await reader();
    el.open = false;
    await el.updateComplete;
    FakeNdefReader.scanResult = () => Promise.resolve();
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(FakeNdefReader.instances).toHaveLength(2));
    refuse(new DOMException("refused", "NotAllowedError"));
    await Promise.resolve();
    await el.updateComplete;
    expect(old.signal!.aborted).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-equipment-nfc-message]")!.textContent).toContain(
      "Tap the equipment",
    );
  });
  it("a reading error makes no request and a later valid sticker still works", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const nfc = await reader();
    nfc.dispatchEvent(new Event("readingerror"));
    await el.updateComplete;
    expect(seen).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-equipment-nfc-message]")!.textContent).toContain(
      "could not be read",
    );
    nfc.read(code("reader", READER_ID));
    expect(seen).toHaveLength(1);
  });
  it("invalid text encoding changes no assignment", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    (await reader()).read(code("reader", READER_ID), "text", "invalid-encoding");
    expect(seen).toEqual([]);
  });
  it("scan permission refusal hides NFC while preserving QR", async () => {
    installNfc("prompt");
    FakeNdefReader.scanResult = () =>
      Promise.reject(new DOMException("refused", "NotAllowedError"));
    const el = await mount();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-equipment-nfc-allow]")).not.toBeNull(),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-nfc-allow]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-equipment-nfc]")).toBeNull());
    scanRow(el, "receipt");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-equipment-scanner")).not.toBeNull();
  });
  it("a scan failure offers QR and dropdown without changing equipment", async () => {
    installNfc();
    FakeNdefReader.scanResult = () =>
      Promise.reject(new DOMException("no NFC", "NotSupportedError"));
    const el = await mount();
    const seen = changes(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-equipment-nfc-message]")?.textContent).toContain(
        "NFC is not available",
      ),
    );
    expect(seen).toEqual([]);
    scanRow(el, "receipt");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-equipment-qr]")).not.toBeNull();
  });
  it("a failed permission query keeps the original QR flow", async () => {
    installNfc();
    vi.mocked(navigator.permissions.query).mockRejectedValue(new TypeError("unavailable"));
    const el = await mount();
    await el.updateComplete;
    expect(FakeNdefReader.instances).toEqual([]);
    scanRow(el, "receipt");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-equipment-scanner")).not.toBeNull();
  });
  it("an NFC-only browser can arm a row without opening a camera", async () => {
    installNfc();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    try {
      const el = await mount();
      const seen = changes(el);
      const nfc = await reader();
      scanRow(el, "payment_slip");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("till-equipment-scanner")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-equipment-qr]")).toBeNull();
      nfc.read(code("printer", PRINTER_ID));
      expect(seen).toEqual([
        { role: "payment_slip", selection: { id: PRINTER_ID }, via: "scan", takeOver: false },
      ]);
    } finally {
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });
  it("NFC and QR of a reader use the same authenticated PUT body for the armed row", async () => {
    installNfc();
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("refused", "NotAllowedError"),
    );
    const requests: { url: string; init: RequestInit }[] = [];
    const api = new TillApi("", async (url, init) => {
      requests.push({ url: String(url), init: init! });
      return new Response(JSON.stringify(NFC_EQUIPMENT));
    });
    const el = await mount();
    const calls: Promise<unknown>[] = [];
    el.addEventListener("equipment-change", (event) =>
      calls.push(api.setDeviceEquipment((event as CustomEvent<EquipmentChange>).detail)),
    );
    const nfc = await reader();
    scanRow(el, "card_terminal");
    await el.updateComplete;
    nfc.read(code("reader", READER_ID));
    await el.updateComplete;
    await Promise.all(calls);
    scanRow(el, "card_terminal");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-qr]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector("till-equipment-scanner")!.dispatchEvent(
      new CustomEvent("equipment-scanned", {
        detail: { id: READER_ID },
        bubbles: true,
        composed: true,
      }),
    );
    await Promise.all(calls);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe("/api/device/equipment");
      expect(request.init.method).toBe("PUT");
      expect(request.init.credentials).toBe("include");
      expect(JSON.parse(request.init.body as string)).toEqual({
        role: "card_terminal",
        selection: { id: READER_ID },
        via: "scan",
        takeOver: false,
      });
    }
  });
  it.each([
    ["reader", READER_ID],
    ["printer", PRINTER_ID],
  ])("an unarmed %s tap delegates the role set to the server", async (kind, id) => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    (await reader()).read(code(kind, id));
    expect(seen).toEqual([{ kind, selection: { id }, via: "scan" }]);
  });
  it.each(["receipt", "payment_slip"])("an armed %s row fills only that row", async (role) => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const nfc = await reader();
    scanRow(el, role);
    await el.updateComplete;
    nfc.read(code("printer", PRINTER_ID));
    expect(seen).toEqual([{ role, selection: { id: PRINTER_ID }, via: "scan", takeOver: false }]);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-equipment-row]")).not.toBeNull();
  });
  it.each([
    ["garbage", "text", "not a Waitron"],
    [code("printer", "bad-id"), "text", "not a Waitron"],
    [
      code("reader", "c45f83b1-3333-4333-8333-333333333333"),
      "text",
      "not available to this device",
    ],
    [code("reader", READER_ID), "url", "not a Waitron"],
    [code("drawer", PRINTER_ID), "text", "not a Waitron"],
  ])("ignores malformed, foreign or non-text record %s/%s", async (text, type, message) => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    (await reader()).read(text, type);
    await el.updateComplete;
    expect(seen).toEqual([]);
    expect(el.equipment).toBe(NFC_EQUIPMENT);
    expect(el.shadowRoot!.querySelector("[data-equipment-nfc-message]")!.textContent).toContain(
      message,
    );
  });
  it("a wrong-kind tap leaves the armed row waiting for its own kind", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const nfc = await reader();
    scanRow(el, "receipt");
    await el.updateComplete;
    nfc.read(code("reader", READER_ID));
    await el.updateComplete;
    expect(seen).toEqual([]);
    expect(el.shadowRoot!.querySelector("[data-equipment-nfc-message]")!.textContent).toContain(
      "not for a printer",
    );
    nfc.read(code("printer", PRINTER_ID));
    expect(seen).toHaveLength(1);
  });
  it.each([
    ["en", "Allow NFC"],
    ["es", "Permitir NFC"],
  ] as const)("asks for permission only from an explicit action (%s)", async (locale, label) => {
    installNfc("prompt");
    setLocale(locale);
    const el = await mount();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-equipment-nfc-allow]")?.textContent?.trim()).toBe(
        label,
      ),
    );
    expect(FakeNdefReader.instances).toHaveLength(0);
    el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-nfc-allow]")!.click();
    const nfc = await reader();
    const seen = changes(el);
    nfc.read(code("reader", READER_ID));
    expect(seen).toEqual([{ kind: "reader", selection: { id: READER_ID }, via: "scan" }]);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-equipment-nfc-allow]")).toBeNull();
  });
  it.each(["absent", "denied"])(
    "shows no NFC controls when %s and keeps QR and dropdown",
    async (state) => {
      if (state === "denied") installNfc("denied");
      else vi.stubGlobal("NDEFReader", undefined);
      const el = await mount();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-equipment-nfc]")).toBeNull();
      expect(el.shadowRoot!.querySelectorAll("wt-combobox")).toHaveLength(3);
      expect(el.shadowRoot!.querySelectorAll("[data-equipment-scan]")).toHaveLength(3);
      expect(FakeNdefReader.instances).toHaveLength(0);
    },
  );
  it("aborts at close and ignores an old read after reopening", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const old = await reader();
    el.open = false;
    await el.updateComplete;
    expect(old.signal!.aborted).toBe(true);
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(FakeNdefReader.instances).toHaveLength(2));
    old.read(code("reader", READER_ID));
    expect(seen).toEqual([]);
    (await reader()).read(code("reader", READER_ID));
    expect(seen).toHaveLength(1);
  });
  it("aborts on removal and resumes when the open dialog is reattached", async () => {
    installNfc();
    const el = await mount();
    const old = await reader();
    const host = el.parentElement!;
    const seen = changes(el);
    el.remove();
    expect(old.signal!.aborted).toBe(true);
    old.read(code("reader", READER_ID));
    expect(seen).toEqual([]);
    host.append(el);
    await vi.waitFor(() => expect(FakeNdefReader.instances).toHaveLength(2));
    (await reader()).read(code("reader", READER_ID));
    expect(seen).toHaveLength(1);
  });
  it("QR camera pauses NFC and Back starts a new scan", async () => {
    installNfc();
    vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(
      new DOMException("refused", "NotAllowedError"),
    );
    const el = await mount();
    const seen = changes(el);
    const old = await reader();
    scanRow(el, "receipt");
    await el.updateComplete;
    expect(old.signal!.aborted).toBe(false);
    el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-qr]")!.click();
    await el.updateComplete;
    expect(old.signal!.aborted).toBe(true);
    old.read(code("printer", PRINTER_ID));
    expect(seen).toEqual([]);
    el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-scan-back]")!.click();
    await el.updateComplete;
    await vi.waitFor(() => expect(FakeNdefReader.instances).toHaveLength(2));
    (await reader()).read(code("printer", PRINTER_ID));
    expect(seen).toEqual([{ kind: "printer", selection: { id: PRINTER_ID }, via: "scan" }]);
  });
  it("close button aborts immediately even before its owner updates open", async () => {
    installNfc();
    const el = await mount();
    const seen = changes(el);
    const nfc = await reader();
    el.shadowRoot!.querySelector<HTMLElement>("[data-equipment-close]")!.click();
    expect(nfc.signal!.aborted).toBe(true);
    nfc.read(code("reader", READER_ID));
    expect(seen).toEqual([]);
  });
});
