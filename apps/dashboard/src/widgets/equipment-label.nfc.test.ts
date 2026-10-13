import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WtButton, WtDialog, WtModal } from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { EquipmentLabel } from "./equipment-label.js";
import "./equipment-label.js";

const ID = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

class FakeWriter {
  static writes: { message: unknown; options: { signal: AbortSignal } }[] = [];
  static locks: { signal: AbortSignal }[] = [];
  static writeResult = () => Promise.resolve();
  static lockResult = () => Promise.resolve();
  write(message: unknown, options: { signal: AbortSignal }) {
    FakeWriter.writes.push({ message, options });
    return FakeWriter.writeResult();
  }
  makeReadOnly(options: { signal: AbortSignal }) {
    FakeWriter.locks.push(options);
    return FakeWriter.lockResult();
  }
}

beforeEach(() => {
  setLocale("en");
  FakeWriter.writes = [];
  FakeWriter.locks = [];
  FakeWriter.writeResult = () => Promise.resolve();
  FakeWriter.lockResult = () => Promise.resolve();
  vi.stubGlobal("NDEFReader", FakeWriter);
});
afterEach(() => {
  cleanupWidgets();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLocale("en");
});

async function mount(kind: "printer" | "reader" = "reader") {
  const { el } = await mountWidget<EquipmentLabel>("dashboard-equipment-label", {
    kind,
    itemId: ID,
    name: "Terraza",
    drawQr: async () => PIXEL,
  });
  await el.updateComplete;
  return el;
}
function button(el: EquipmentLabel, test: string): WtButton {
  const found = el.shadowRoot!.querySelector<WtButton>(`[data-test=${test}]`);
  expect(found, `missing ${test}`).not.toBeNull();
  return found!;
}
async function write(el: EquipmentLabel) {
  button(el, "write-equipment-nfc").click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=lock-equipment-nfc]")).not.toBeNull(),
  );
}
function message(el: EquipmentLabel) {
  return el.shadowRoot!.querySelector("[data-test=equipment-nfc-message]")?.textContent?.trim();
}

describe("equipment label NFC writer", () => {
  it.each(["reader", "printer"] as const)(
    "writes exactly the %s code in a text record, beside Print",
    async (kind) => {
      const el = await mount(kind);
      const print = button(el, "print-equipment-label");
      const action = button(el, "write-equipment-nfc");
      expect(action.parentElement).toBe(print.parentElement);
      expect(action.disabled).toBe(false);
      await write(el);
      expect(FakeWriter.writes).toHaveLength(1);
      expect(FakeWriter.writes[0]!.message).toEqual({
        records: [{ recordType: "text", data: `waitron-equipment:${kind}:${ID}` }],
      });
      expect(FakeWriter.writes[0]!.options.signal.aborted).toBe(false);
      expect(FakeWriter.locks).toEqual([]);
      expect(message(el)).toContain("written");
    },
  );

  it.each(["en", "es"] as const)(
    "keeps writing disabled and explained without Web NFC (%s)",
    async (locale) => {
      setLocale(locale);
      vi.stubGlobal("NDEFReader", undefined);
      const el = await mount();
      const action = button(el, "write-equipment-nfc");
      expect(action.disabled).toBe(true);
      expect(action.variant).toBe("secondary");
      expect(el.shadowRoot!.textContent).toContain(
        locale === "en" ? "Chrome on an Android phone" : "Chrome en un teléfono Android",
      );
      action.click();
      expect(FakeWriter.writes).toEqual([]);
      expect(button(el, "print-equipment-label").disabled).toBe(false);
      expect(button(el, "copy-equipment-code").disabled).toBe(false);
    },
  );

  it("copies the visible code without NFC and explains a refused clipboard", async () => {
    vi.stubGlobal("NDEFReader", undefined);
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const el = await mount();
    button(el, "copy-equipment-code").click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(`waitron-equipment:reader:${ID}`));
    expect(el.shadowRoot!.querySelector("[data-test=equipment-label-code]")!.textContent).toBe(
      `waitron-equipment:reader:${ID}`,
    );
    copy.mockRejectedValue(new DOMException("refused", "NotAllowedError"));
    button(el, "copy-equipment-code").click();
    await vi.waitFor(() => expect(message(el)).toContain("Select and copy"));
    expect(button(el, "copy-equipment-code").disabled).toBe(false);
  });

  it.each(["en", "es"] as const)(
    "requires permanent-lock confirmation and leaves the label open on Cancel (%s)",
    async (locale) => {
      setLocale(locale);
      const el = await mount();
      await write(el);
      const closed = vi.fn();
      el.addEventListener("wt-close", closed);
      button(el, "lock-equipment-nfc").click();
      await el.updateComplete;
      expect(el.shadowRoot!.textContent).toContain(locale === "en" ? "permanent" : "permanente");
      expect(FakeWriter.locks).toEqual([]);
      const dialog = el.shadowRoot!.querySelector<WtDialog>(
        "[data-test=lock-equipment-nfc-confirmation]",
      )!;
      const reported = dialogClosed(dialog);
      button(el, "cancel-lock-equipment-nfc").click();
      await reported;
      expect(FakeWriter.locks).toEqual([]);
      expect(closed).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector<WtModal>("wt-modal")!.open).toBe(true);
      button(el, "lock-equipment-nfc").click();
      await el.updateComplete;
      button(el, "confirm-lock-equipment-nfc").click();
      await vi.waitFor(() =>
        expect(message(el)).toContain(locale === "en" ? "locked" : "bloqueada"),
      );
      expect(FakeWriter.locks).toHaveLength(1);
      expect(FakeWriter.locks[0]!.signal.aborted).toBe(false);
      expect(el.shadowRoot!.querySelector("[data-test=lock-equipment-nfc]")).toBeNull();
    },
  );

  it.each(["write", "lock"] as const)(
    "a failed %s stays retryable and explains holding the sticker still",
    async (operation) => {
      const el = await mount();
      const refuse = () => Promise.reject(new DOMException("IO error", "NetworkError"));
      if (operation === "write") {
        FakeWriter.writeResult = refuse;
        button(el, "write-equipment-nfc").click();
      } else {
        await write(el);
        FakeWriter.lockResult = refuse;
        button(el, "lock-equipment-nfc").click();
        await el.updateComplete;
        button(el, "confirm-lock-equipment-nfc").click();
      }
      await vi.waitFor(() => expect(message(el)).toBe("Hold the sticker still and try again"));
      expect(button(el, "write-equipment-nfc").disabled).toBe(false);
      if (operation === "write")
        expect(el.shadowRoot!.querySelector("[data-test=lock-equipment-nfc]")).toBeNull();
      else expect(button(el, "lock-equipment-nfc").disabled).toBe(false);
    },
  );

  it.each(["close", "remove", "replace"] as const)(
    "aborts an unfinished write on %s and ignores its late success",
    async (exit) => {
      let finish!: () => void;
      FakeWriter.writeResult = () => new Promise<void>((resolve) => (finish = resolve));
      const el = await mount();
      button(el, "write-equipment-nfc").click();
      await el.updateComplete;
      expect(FakeWriter.writes).toHaveLength(1);
      expect(button(el, "write-equipment-nfc").disabled).toBe(true);
      button(el, "write-equipment-nfc").click();
      expect(FakeWriter.writes).toHaveLength(1);
      if (exit === "close") {
        const modal = el.shadowRoot!.querySelector("wt-modal")!;
        const reported = dialogClosed(modal);
        button(el, "close-equipment-label").click();
        await reported;
      } else if (exit === "remove") el.remove();
      else {
        el.itemId = "7d2c9a10-5b3e-4f61-8a2d-1c0e9b8a7f65";
        await el.updateComplete;
      }
      expect(FakeWriter.writes[0]!.options.signal.aborted).toBe(true);
      finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-test=lock-equipment-nfc]")).toBeNull();
      expect(message(el)).toBeUndefined();
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
    button(el, "write-equipment-nfc").click();
    await vi.waitFor(() => expect(message(el)).toBe("Hold the sticker still and try again"));
    expect(button(el, "write-equipment-nfc").disabled).toBe(false);
  });

  it.each(["success", "refusal"] as const)(
    "a late clipboard %s cannot describe another equipment label",
    async (result) => {
      let finish!: () => void;
      vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = result === "success" ? resolve : () => reject(new Error("refused"));
          }),
      );
      const el = await mount();
      button(el, "copy-equipment-code").click();
      el.itemId = "7d2c9a10-5b3e-4f61-8a2d-1c0e9b8a7f65";
      await el.updateComplete;
      finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(message(el)).toBeUndefined();
      expect(el.shadowRoot!.querySelector("code")!.textContent).toContain(el.itemId);
    },
  );

  it("a cancelled write's late refusal cannot describe the replacement label", async () => {
    let refuse!: () => void;
    FakeWriter.writeResult = () =>
      new Promise<void>((_, reject) => {
        refuse = () => reject(new DOMException("aborted", "AbortError"));
      });
    const el = await mount();
    button(el, "write-equipment-nfc").click();
    el.kind = "printer";
    await el.updateComplete;
    refuse();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(FakeWriter.writes[0]!.options.signal.aborted).toBe(true);
    expect(message(el)).toBeUndefined();
    expect(button(el, "write-equipment-nfc").disabled).toBe(false);
  });

  it("a clipboard completion after closing cannot restore a message", async () => {
    let finish!: () => void;
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const el = await mount();
    button(el, "copy-equipment-code").click();
    const reported = dialogClosed(el.shadowRoot!.querySelector("wt-modal")!);
    button(el, "close-equipment-label").click();
    await reported;
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(message(el)).toBeUndefined();
  });
});
