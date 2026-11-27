import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton, WtDialog, WtModal } from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { EquipmentNfcSticker } from "./equipment-nfc-sticker.js";
import "./equipment-nfc-sticker.js";

const ID = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";
const OTHER = "7d2c9a10-5b3e-4f61-8a2d-1c0e9b8a7f65";
const FAILED = "Hold the sticker still and try again. A locked sticker can’t be rewritten.";
const READY = "Hold a sticker against the phone.";

class FakeWriter {
  static writes: { message: unknown; options: { signal: AbortSignal } }[] = [];
  static locks: { signal: AbortSignal }[] = [];
  static writeResult = () => Promise.resolve();
  static lockResult = () => Promise.resolve();
  static scans: { signal: AbortSignal }[] = [];
  static scanResult = () => Promise.resolve();
  scan(options: { signal: AbortSignal }) {
    FakeWriter.scans.push(options);
    return FakeWriter.scanResult();
  }
  write(message: unknown, options: { signal: AbortSignal }) {
    FakeWriter.writes.push({ message, options });
    return FakeWriter.writeResult();
  }
  makeReadOnly(options: { signal: AbortSignal }) {
    FakeWriter.locks.push(options);
    return FakeWriter.lockResult();
  }
}

const pending = () => new Promise<void>(() => {});
const refused = () => Promise.reject(new DOMException("IO error", "NetworkError"));

beforeEach(() => {
  setLocale("en");
  FakeWriter.writes = [];
  FakeWriter.locks = [];
  FakeWriter.writeResult = () => Promise.resolve();
  FakeWriter.lockResult = () => Promise.resolve();
  FakeWriter.scans = [];
  FakeWriter.scanResult = () => Promise.resolve();
  vi.stubGlobal("NDEFReader", FakeWriter);
});
afterEach(() => {
  cleanupWidgets();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLocale("en");
});

async function mount(kind: "printer" | "reader" = "reader") {
  const { el } = await mountWidget<EquipmentNfcSticker>("dashboard-equipment-nfc-sticker", {
    kind,
    itemId: ID,
    name: "Terrace",
  });
  await el.updateComplete;
  return el;
}
const q = <T extends Element = WtButton>(el: EquipmentNfcSticker, test: string) =>
  el.shadowRoot!.querySelector<T>(`[data-test=${test}]`);
function button(el: EquipmentNfcSticker, test: string): WtButton {
  const found = q(el, test);
  expect(found, `missing ${test}`).not.toBeNull();
  return found!;
}
const message = (el: EquipmentNfcSticker) =>
  q<HTMLElement>(el, "equipment-nfc-message")!.textContent!.trim();
const footer = (el: EquipmentNfcSticker) =>
  [...el.shadowRoot!.querySelectorAll<WtButton>("wt-modal wt-form-actions wt-button")].map((each) =>
    each.textContent!.trim(),
  );
async function written(el: EquipmentNfcSticker) {
  await vi.waitFor(() => expect(q(el, "lock-equipment-nfc")).not.toBeNull());
}
async function mountWritten(kind: "printer" | "reader" = "reader") {
  const el = await mount(kind);
  await written(el);
  return el;
}
async function confirmLock(el: EquipmentNfcSticker) {
  button(el, "lock-equipment-nfc").click();
  await el.updateComplete;
  button(el, "confirm-lock-equipment-nfc").click();
}
function deepFocus(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}
const focusedIn = (host: WtButton) => deepFocus() === host.shadowRoot!.querySelector("button");
const late = async (el: EquipmentNfcSticker) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};

describe("NFC sticker window", () => {
  it("opens ready to write, with nothing but Close to press", async () => {
    FakeWriter.writeResult = pending;
    const el = await mount("printer");
    expect(q(el, "equipment-nfc-modal")!.getAttribute("heading")).toBe("NFC sticker: Terrace");
    expect(message(el)).toBe(READY);
    expect(footer(el)).toEqual([t("action.close")]);
    expect(FakeWriter.writes).toHaveLength(1);
    el.name = "Garden";
    await el.updateComplete;
    expect(FakeWriter.writes).toHaveLength(1);
  });

  it("puts a name holding a replacement pattern into its heading as written", async () => {
    const el = await mount();
    el.name = "Counter $&";
    await el.updateComplete;
    expect(q(el, "equipment-nfc-modal")!.getAttribute("heading")).toBe("NFC sticker: Counter $&");
  });

  it.each([
    ["reader", "Sticker written. Stick it on the card reader."],
    ["printer", "Sticker written. Stick it on the printer."],
  ] as const)("writes exactly the %s code in a text record and says so", async (kind, words) => {
    const el = await mountWritten(kind);
    expect(FakeWriter.writes).toHaveLength(1);
    expect(FakeWriter.writes[0]!.message).toEqual({
      records: [{ recordType: "text", data: `waitron-equipment:${kind}:${ID}` }],
    });
    expect(FakeWriter.writes[0]!.options.signal.aborted).toBe(false);
    expect(FakeWriter.locks).toEqual([]);
    expect(message(el)).toBe(words);
    expect(q<HTMLElement>(el, "equipment-nfc-lock-hint")!.textContent!.trim()).toBe(
      "Locking stops anyone changing it, for good.",
    );
    expect(footer(el)).toEqual([t("action.close"), "Lock…", "Write another"]);
    expect(button(el, "write-equipment-nfc").variant).toBe("primary");
  });

  it("Write another waits for the next sticker and keeps keyboard focus in the window", async () => {
    const el = await mountWritten();
    FakeWriter.writeResult = pending;
    await userEvent.click(
      page.elementLocator(button(el, "write-equipment-nfc").shadowRoot!.querySelector("button")!),
    );
    await vi.waitFor(() => expect(focusedIn(button(el, "close-equipment-nfc"))).toBe(true));
    expect(FakeWriter.writes).toHaveLength(2);
    expect(message(el)).toBe(READY);
    expect(q(el, "equipment-nfc-lock-hint")).toBeNull();
    expect(footer(el)).toEqual([t("action.close")]);
  });

  it.each(["system font", "phone font"])(
    "fits all three written-sticker actions on one row in Spanish at 333 px with the %s",
    async (font) => {
      setLocale("es");
      const viewport = [innerWidth, innerHeight] as const;
      await page.viewport(333, 720);
      let face: FontFace | undefined;
      try {
        const el = await mountWritten("printer");
        if (font === "phone font") {
          const file = new URL("../../../server/src/assets/invoice-noto-sans.ttf", import.meta.url);
          face = new FontFace("Sticker test phone font", `url(${file.href})`, {
            weight: "100 900",
          });
          document.fonts.add(await face.load());
          el.style.setProperty("--wt-font-family", '"Sticker test phone font"');
        }
        const bounds = (name: string) =>
          button(el, name).shadowRoot!.querySelector("button")!.getBoundingClientRect();
        const close = bounds("close-equipment-nfc");
        const lock = bounds("lock-equipment-nfc");
        const write = bounds("write-equipment-nfc");
        expect(close.top).toBe(lock.top);
        expect(lock.top).toBe(write.top);
        expect(close.left).toBeGreaterThanOrEqual(0);
        expect(close.right).toBeLessThan(lock.left);
        expect(lock.right).toBeLessThan(write.left);
        expect(write.right).toBeLessThanOrEqual(333);
        for (const action of [close, lock, write]) {
          expect(action.width).toBeGreaterThanOrEqual(44);
          expect(action.height).toBeGreaterThanOrEqual(44);
        }
      } finally {
        if (face) document.fonts.delete(face);
        await page.viewport(...viewport);
      }
    },
  );

  it("without Web NFC writes nothing and offers Try again", async () => {
    vi.stubGlobal("NDEFReader", undefined);
    const el = await mount();
    expect(FakeWriter.writes).toEqual([]);
    expect(message(el)).toBe(FAILED);
    button(el, "write-equipment-nfc").click();
    expect(FakeWriter.writes).toEqual([]);
  });

  it.each(["en", "es"] as const)(
    "requires permanent-lock confirmation and leaves the window open on Cancel (%s)",
    async (locale) => {
      setLocale(locale);
      const el = await mountWritten();
      const closed = vi.fn();
      el.addEventListener("wt-close", closed);
      button(el, "lock-equipment-nfc").click();
      await el.updateComplete;
      const dialog = q<WtDialog>(el, "lock-equipment-nfc-confirmation")!;
      expect(dialog.textContent).toContain(t("equipment.nfc_lock_confirmation"));
      expect(FakeWriter.locks).toEqual([]);
      expect(dialog.open).toBe(true);
      const reported = dialogClosed(dialog);
      button(el, "cancel-lock-equipment-nfc").click();
      await reported;
      expect(FakeWriter.locks).toEqual([]);
      expect(closed).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector<WtModal>("wt-modal")!.open).toBe(true);
      await confirmLock(el);
      await vi.waitFor(() => expect(message(el)).toBe(t("equipment.nfc_locked")));
      expect(FakeWriter.locks).toHaveLength(1);
      expect(FakeWriter.locks[0]!.signal.aborted).toBe(false);
      expect(footer(el)).toEqual([t("action.close"), t("equipment.nfc_write_another")]);
      expect(q(el, "equipment-nfc-lock-hint")).toBeNull();
    },
  );

  it("a failed write explains itself, and Try again writes", async () => {
    FakeWriter.writeResult = refused;
    const el = await mount();
    await vi.waitFor(() => expect(message(el)).toBe(FAILED));
    expect(footer(el)).toEqual([t("action.close"), "Try again"]);
    const again = button(el, "write-equipment-nfc");
    expect(again.variant).toBe("primary");
    expect(again.disabled).toBe(false);
    FakeWriter.writeResult = () => Promise.resolve();
    again.click();
    await written(el);
    expect(FakeWriter.writes).toHaveLength(2);
  });

  it("a failed lock stays retryable and explains holding the sticker still", async () => {
    const el = await mountWritten();
    FakeWriter.lockResult = refused;
    await confirmLock(el);
    await vi.waitFor(() => expect(message(el)).toBe("Hold the sticker still and try again."));
    expect(footer(el)).toEqual([t("action.close"), "Lock…", "Write another"]);
    expect(button(el, "write-equipment-nfc").disabled).toBe(false);
    expect(button(el, "lock-equipment-nfc").disabled).toBe(false);
  });

  it("a lock the phone blocks says where to allow NFC, and locks once allowed", async () => {
    const el = await mountWritten();
    FakeWriter.lockResult = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    await confirmLock(el);
    await vi.waitFor(() =>
      expect(message(el)).toBe(
        "NFC is blocked for Waitron. Allow it in this app’s or browser’s permissions, then try again.",
      ),
    );
    expect(footer(el)).toEqual([t("action.close"), "Lock…", "Write another"]);
    expect(button(el, "write-equipment-nfc").disabled).toBe(false);
    expect(button(el, "lock-equipment-nfc").disabled).toBe(false);
    FakeWriter.lockResult = () => Promise.resolve();
    await confirmLock(el);
    await vi.waitFor(() => expect(message(el)).toBe(t("equipment.nfc_locked")));
    expect(FakeWriter.locks).toHaveLength(2);
    expect(FakeWriter.writes).toHaveLength(1);
  });

  it("says in Spanish that a failed write may be a locked sticker", async () => {
    setLocale("es");
    FakeWriter.writeResult = refused;
    const el = await mount();
    await vi.waitFor(() => expect(message(el)).toBe(t("equipment.nfc_write_failed")));
    expect(message(el)).not.toContain("locked sticker");
  });

  it("says where to allow NFC when the phone blocks it, and tries again once allowed", async () => {
    FakeWriter.writeResult = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    const el = await mount();
    await vi.waitFor(() =>
      expect(message(el)).toBe(
        "NFC is blocked for Waitron. Allow it in this app’s or browser’s permissions, then try again.",
      ),
    );
    expect(footer(el)).toEqual([t("action.close"), "Try again"]);
    FakeWriter.writeResult = () => Promise.resolve();
    button(el, "write-equipment-nfc").click();
    await written(el);
  });

  it.each(["close", "remove", "replace"] as const)(
    "aborts an unfinished write on %s and ignores its late success",
    async (exit) => {
      let finish!: () => void;
      FakeWriter.writeResult = () => new Promise<void>((resolve) => (finish = resolve));
      const el = await mount();
      expect(FakeWriter.writes).toHaveLength(1);
      FakeWriter.writeResult = pending;
      if (exit === "close") {
        const modal = el.shadowRoot!.querySelector("wt-modal")!;
        const reported = dialogClosed(modal);
        button(el, "close-equipment-nfc").click();
        await reported;
      } else if (exit === "remove") el.remove();
      else {
        el.itemId = OTHER;
        await el.updateComplete;
      }
      expect(FakeWriter.writes[0]!.options.signal.aborted).toBe(true);
      finish();
      await late(el);
      expect(q(el, "lock-equipment-nfc")).toBeNull();
      expect(message(el)).toBe(exit === "replace" ? READY : "");
      expect(FakeWriter.writes).toHaveLength(exit === "replace" ? 2 : 1);
    },
  );

  it("contains a synchronous writer construction failure", async () => {
    vi.stubGlobal(
      "NDEFReader",
      class {
        constructor() {
          throw new Error("unavailable");
        }
      },
    );
    const el = await mount();
    await vi.waitFor(() => expect(message(el)).toBe(FAILED));
    expect(button(el, "write-equipment-nfc").disabled).toBe(false);
  });

  it("a cancelled write's late refusal cannot describe the replacement sticker", async () => {
    let refuse!: () => void;
    FakeWriter.writeResult = () =>
      new Promise<void>((_, reject) => {
        refuse = () => reject(new DOMException("aborted", "AbortError"));
      });
    const el = await mount();
    const refuseFirst = refuse;
    el.kind = "printer";
    await el.updateComplete;
    refuseFirst();
    await late(el);
    expect(FakeWriter.writes.map((each) => each.options.signal.aborted)).toEqual([true, false]);
    expect(FakeWriter.writes[1]!.message).toEqual({
      records: [{ recordType: "text", data: `waitron-equipment:printer:${ID}` }],
    });
    expect(message(el)).toBe(READY);
  });

  it("confirming a lock returns keyboard focus to the window while the lock waits", async () => {
    FakeWriter.lockResult = pending;
    const el = await mountWritten();
    const click = async (test: string) =>
      userEvent.click(page.elementLocator(button(el, test).shadowRoot!.querySelector("button")!));
    await click("lock-equipment-nfc");
    await el.updateComplete;
    await click("confirm-lock-equipment-nfc");
    await vi.waitFor(() => expect(focusedIn(button(el, "close-equipment-nfc"))).toBe(true));
    expect(FakeWriter.locks).toHaveLength(1);
    expect(FakeWriter.locks[0]!.signal.aborted).toBe(false);
  });

  it("offers only Close while a lock waits, and aborts that lock on close", async () => {
    FakeWriter.lockResult = pending;
    const el = await mountWritten();
    await confirmLock(el);
    await el.updateComplete;
    expect(message(el)).toBe("Hold the sticker against the phone.");
    expect(footer(el)).toEqual([t("action.close")]);
    const reported = dialogClosed(el.shadowRoot!.querySelector("wt-modal")!);
    button(el, "close-equipment-nfc").click();
    await reported;
    expect(FakeWriter.locks[0]!.signal.aborted).toBe(true);
  });

  it("a retained confirmation cannot lock after Cancel, and Write another cannot bypass an open confirmation", async () => {
    const el = await mountWritten();
    button(el, "lock-equipment-nfc").click();
    await el.updateComplete;
    expect(button(el, "write-equipment-nfc").variant).toBe("secondary");
    button(el, "write-equipment-nfc").click();
    expect(FakeWriter.writes).toHaveLength(1);
    const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    expect(dialog.open).toBe(true);
    const confirm = button(el, "confirm-lock-equipment-nfc");
    const reported = dialogClosed(dialog);
    button(el, "cancel-lock-equipment-nfc").click();
    await reported;
    confirm.click();
    expect(FakeWriter.locks).toEqual([]);
  });

  it("Close aborts a write before its native close report", async () => {
    FakeWriter.writeResult = pending;
    const el = await mount();
    button(el, "close-equipment-nfc").click();
    expect(FakeWriter.writes[0]!.options.signal.aborted).toBe(true);
  });

  it("native Escape aborts a write without using Close", async () => {
    FakeWriter.writeResult = pending;
    const el = await mount();
    const reported = dialogClosed(el.shadowRoot!.querySelector("wt-modal")!);
    await userEvent.keyboard("{Escape}");
    await reported;
    expect(FakeWriter.writes[0]!.options.signal.aborted).toBe(true);
  });

  it("scans from the first write and keeps that one scan through a rewrite and a lock", async () => {
    FakeWriter.writeResult = pending;
    const el = await mount();
    expect(FakeWriter.scans).toHaveLength(1);
    FakeWriter.writeResult = () => Promise.resolve();
    el.itemId = OTHER;
    await el.updateComplete;
    await written(el);
    button(el, "write-equipment-nfc").click();
    await vi.waitFor(() => expect(FakeWriter.writes).toHaveLength(3));
    await written(el);
    await confirmLock(el);
    await vi.waitFor(() => expect(message(el)).toContain("locked"));
    expect(FakeWriter.scans.map((scan) => scan.signal.aborted)).toEqual([true, false]);
  });

  it("keeps scanning after a failed write", async () => {
    FakeWriter.writeResult = refused;
    const el = await mount();
    await vi.waitFor(() => expect(message(el)).toBe(FAILED));
    expect(FakeWriter.scans.map((scan) => scan.signal.aborted)).toEqual([false]);
  });

  it.each(["close", "Escape", "remove", "replace"] as const)(
    "stops scanning on %s after a written sticker",
    async (exit) => {
      const el = await mountWritten();
      expect(FakeWriter.scans[0]!.signal.aborted).toBe(false);
      if (exit === "close") button(el, "close-equipment-nfc").click();
      else if (exit === "Escape") {
        const reported = dialogClosed(el.shadowRoot!.querySelector("wt-modal")!);
        await userEvent.keyboard("{Escape}");
        await reported;
      } else if (exit === "remove") el.remove();
      else {
        el.kind = "printer";
        await el.updateComplete;
      }
      expect(FakeWriter.scans).toHaveLength(exit === "replace" ? 2 : 1);
      expect(FakeWriter.scans[0]!.signal.aborted).toBe(true);
    },
  );

  it.each(["rejected", "thrown"] as const)(
    "writes when the scan is %s, and the next write tries the scan again",
    async (how) => {
      FakeWriter.scanResult = () => {
        const error = new DOMException("not ready", "NotReadableError");
        if (how === "thrown") throw error;
        return Promise.reject(error);
      };
      const el = await mountWritten();
      expect(message(el)).toContain("written");
      expect(FakeWriter.scans).toHaveLength(1);
      FakeWriter.scanResult = () => Promise.resolve();
      button(el, "write-equipment-nfc").click();
      expect(FakeWriter.scans).toHaveLength(2);
      expect(FakeWriter.scans[1]!.signal.aborted).toBe(false);
    },
  );

  it("a stopped scan's late refusal does not stop the replacement sticker's scan", async () => {
    let refuse!: () => void;
    FakeWriter.scanResult = () =>
      new Promise<void>((_, reject) => {
        refuse = () => reject(new DOMException("aborted", "AbortError"));
      });
    const el = await mountWritten();
    const refuseFirst = refuse;
    FakeWriter.scanResult = () => Promise.resolve();
    el.kind = "printer";
    await el.updateComplete;
    await written(el);
    refuseFirst();
    await late(el);
    button(el, "write-equipment-nfc").click();
    expect(FakeWriter.scans.map((scan) => scan.signal.aborted)).toEqual([true, false]);
  });
});
