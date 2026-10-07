import { afterEach, describe, expect, it, vi } from "vitest";
import { formatEquipmentCode } from "@waitron/shared";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { decodeQrImage } from "../testing/decode-qr.js";
import { printEquipmentLabel, type EquipmentLabel } from "./equipment-label.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

const ID = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";
/** A one-pixel image, so the printed frame has something to decode. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("dashboard-equipment-label", () => {
  async function mount(kind: "printer" | "reader", itemId = ID) {
    const { el } = await mountWidget<EquipmentLabel>("dashboard-equipment-label", {
      kind,
      itemId,
      name: "Mano de sala",
    });
    const qr = () =>
      el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=equipment-label-qr]");
    await vi.waitFor(() => expect(qr()).not.toBeNull());
    return { el, qr: qr()! };
  }

  it.each(["printer", "reader"] as const)(
    "shows a %s's code, its name, and a QR image that decodes to the code",
    async (kind) => {
      const { el, qr } = await mount(kind);
      const code = formatEquipmentCode(kind, ID);
      const text = (selector: string) =>
        el.shadowRoot!.querySelector(selector)!.textContent!.trim();
      expect(text("[data-test=equipment-label-code]")).toBe(code);
      expect(text("[data-test=equipment-label-name]")).toBe("Mano de sala");
      expect(qr.alt).toBe(t("equipment.label_qr_alt"));
      expect(await decodeQrImage(qr.src)).toBe(code);
    },
  );

  it("draws a new QR when it is given another item", async () => {
    const { el } = await mount("printer");
    const other = "7d2c9a10-5b3e-4f61-8a2d-1c0e9b8a7f65";
    el.itemId = other;
    await vi.waitFor(async () => {
      const qr = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=equipment-label-qr]");
      expect(qr && (await decodeQrImage(qr.src))).toBe(formatEquipmentCode("printer", other));
    });
  });

  it("keeps its QR, and Print, when only the name changes", async () => {
    const { el, qr } = await mount("printer");
    const src = qr.src;
    el.name = "Terraza";
    await el.updateComplete;
    const shown = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=equipment-label-qr]");
    expect(shown?.src).toBe(src);
    expect(
      el.shadowRoot!.querySelector("[data-test=equipment-label-name]")!.textContent!.trim(),
    ).toBe("Terraza");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        "[data-test=print-equipment-label]",
      )!.disabled,
    ).toBe(false);
  });

  it("never shows the QR of an item it was moved off while that QR was still being drawn", async () => {
    const { el } = await mount("printer");
    const draw = el.drawQr;
    let finishFirst!: () => void;
    const held = new Promise<void>((resolve) => (finishFirst = resolve));
    let drawings = 0;
    el.drawQr = async (code) => {
      if (drawings++ === 0) await held;
      return draw(code);
    };
    const middle = "7d2c9a10-5b3e-4f61-8a2d-1c0e9b8a7f65";
    const last = "3e9a1c55-0f2b-4d7c-9e81-6a5b4c3d2e1f";
    const shownCode = async () => {
      const qr = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=equipment-label-qr]");
      return qr && (await decodeQrImage(qr.src));
    };
    el.itemId = middle;
    await el.updateComplete;
    el.itemId = last;
    await vi.waitFor(async () =>
      expect(await shownCode()).toBe(formatEquipmentCode("printer", last)),
    );

    finishFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(await shownCode()).toBe(formatEquipmentCode("printer", last));
  });

  it("prints its own label from a frame of its own when Print is pressed", async () => {
    const { el } = await mount("reader");
    const printed = vi.fn();
    const watch = new MutationObserver((records) => {
      for (const node of records.flatMap((record) => [...record.addedNodes]))
        if (node instanceof HTMLIFrameElement)
          node.addEventListener("load", () => (node.contentWindow!.print = printed));
    });
    watch.observe(document.body, { childList: true });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=print-equipment-label]")!.click();
    await vi.waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    watch.disconnect();
    const view = printed.mock.contexts[0] as Window;
    expect([...view.document.body.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Mano de sala",
      formatEquipmentCode("reader", ID),
    ]);
    view.dispatchEvent(new Event("afterprint"));
  });

  it("closes, and says so", async () => {
    const { el } = await mount("reader");
    const closed = vi.fn();
    el.addEventListener("wt-close", closed);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=close-equipment-label]")!.click();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  });
});

describe("printEquipmentLabel", () => {
  it("prints a frame holding only the label, with the name as text, and removes the frame after", async () => {
    const printed = vi.fn<(view: Window) => void>();
    printEquipmentLabel(
      { qr: PIXEL, code: "waitron-equipment:printer:x", name: "<b>Bar</b>" },
      printed,
    );
    await vi.waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    const view = printed.mock.calls[0]![0];
    const body = view.document.body;
    expect([...body.children].map((child) => child.tagName)).toEqual(["IMG", "P", "P"]);
    expect(body.querySelector("img")!.getAttribute("src")).toBe(PIXEL);
    expect([...body.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "<b>Bar</b>",
      "waitron-equipment:printer:x",
    ]);
    expect(body.querySelector("b")).toBeNull();
    const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === view)!;
    view.dispatchEvent(new Event("afterprint"));
    expect(frame.isConnected).toBe(false);
  });

  it("removes the frame and prints nothing when the label's image cannot be drawn", async () => {
    const before = document.querySelectorAll("iframe").length;
    const printed = vi.fn<(view: Window) => void>();
    printEquipmentLabel(
      {
        qr: "data:image/png;base64,bm90IGFuIGltYWdl",
        code: "waitron-equipment:printer:x",
        name: "Bar",
      },
      printed,
    );
    expect(document.querySelectorAll("iframe").length).toBe(before + 1);

    await vi.waitFor(() => expect(document.querySelectorAll("iframe").length).toBe(before));
    expect(printed).not.toHaveBeenCalled();
  });
});
