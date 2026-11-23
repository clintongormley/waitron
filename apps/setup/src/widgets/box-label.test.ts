import { afterEach, describe, expect, it, vi } from "vitest";
import { toDataURL } from "qrcode";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { SetupBoxLabel } from "./box-label.js";
import "./box-label.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const ADDRESS = "https://box-41aa.waitron.local";
const SWITCH_PAGE = "https://box-41aa.waitron.local/handover/emergency";
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const part = (el: SetupBoxLabel, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`);
const text = (el: SetupBoxLabel, test: string) => part(el, test)!.textContent!.trim();

describe("setup-box-label", () => {
  it("shows the box's name, a QR of its switch page, the address and what to do, in that order", async () => {
    const { el } = await mountWidget<SetupBoxLabel>("setup-box-label", { address: ADDRESS });
    await vi.waitFor(() => expect(part(el, "label-qr")).not.toBeNull());
    const qr = part(el, "label-qr") as HTMLImageElement;
    expect(qr.src).toBe(await toDataURL(SWITCH_PAGE, { margin: 2, width: 320 }));
    expect(qr.alt).toBe("QR code that opens this box's switch page");
    expect(text(el, "label-name")).toBe("box-41aa.waitron.local");
    expect(text(el, "label-address")).toBe(SWITCH_PAGE);
    expect(text(el, "label-words")).toBe(
      "If the main box fails, scan this with any till or phone on the venue's network",
    );
    const figure = el.shadowRoot!.querySelector("figure")!;
    expect([...figure.children].map((child) => child.getAttribute("data-test"))).toEqual([
      "label-name",
      "label-qr",
      "label-address",
      "label-words",
    ]);
  });

  it("speaks Spanish in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<SetupBoxLabel>("setup-box-label", {
      address: ADDRESS,
      drawQr: async () => PIXEL,
    });
    await vi.waitFor(() => expect(part(el, "label-qr")).not.toBeNull());
    expect(text(el, "label-words")).toBe(
      "Si el servidor principal falla, escanea esto con cualquier caja o móvil conectado a la red del local",
    );
    expect(text(el, "print-label")).toBe("Imprimir etiqueta");
  });

  it("keeps Print label off until the QR is drawn, then prints the label alone", async () => {
    let finish!: (qr: string) => void;
    const drawQr = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const printFrame = vi.fn<(view: Window) => void>();
    const { el } = await mountWidget<SetupBoxLabel>("setup-box-label", {
      address: ADDRESS,
      drawQr,
      printFrame,
    });
    expect(drawQr).toHaveBeenCalledExactlyOnceWith(SWITCH_PAGE);
    const print = part(el, "print-label")! as HTMLElement & { disabled: boolean };
    expect(print.disabled).toBe(true);
    expect(part(el, "label-qr")).toBeNull();
    print.click();
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    finish(PIXEL);
    await vi.waitFor(() => expect(print.disabled).toBe(false));
    expect(printFrame).not.toHaveBeenCalled();
    print.click();
    await vi.waitFor(() => expect(printFrame).toHaveBeenCalledTimes(1));
    const view = printFrame.mock.calls[0]![0];
    const body = view.document.body;
    expect([...body.children].map((child) => child.tagName)).toEqual(["P", "IMG", "P", "P"]);
    expect(body.querySelector("img")!.getAttribute("src")).toBe(PIXEL);
    expect([...body.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "box-41aa.waitron.local",
      SWITCH_PAGE,
      "If the main box fails, scan this with any till or phone on the venue's network",
    ]);
    view.dispatchEvent(new Event("afterprint"));
  });

  it("never shows the QR of an address it was moved off while that QR was still being drawn", async () => {
    let finishFirst!: (qr: string) => void;
    const other = "https://box-77bb.waitron.local";
    const drawQr = vi.fn((page: string) =>
      page === SWITCH_PAGE
        ? new Promise<string>((resolve) => (finishFirst = resolve))
        : Promise.resolve(PIXEL),
    );
    const { el } = await mountWidget<SetupBoxLabel>("setup-box-label", {
      address: ADDRESS,
      drawQr,
    });
    el.address = other;
    await vi.waitFor(() => expect(part(el, "label-qr")).not.toBeNull());
    finishFirst("data:image/png;base64,stale");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await el.updateComplete;
    expect((part(el, "label-qr") as HTMLImageElement).getAttribute("src")).toBe(PIXEL);
    expect(text(el, "label-name")).toBe("box-77bb.waitron.local");
  });

  it("puts what it is given beside Print label", async () => {
    const { el } = await mountWidget<SetupBoxLabel>("setup-box-label", {
      address: ADDRESS,
      drawQr: async () => PIXEL,
    });
    const extra = document.createElement("button");
    el.append(extra);
    const slot = part(el, "print-label")!.parentElement!.querySelector("slot")!;
    expect(slot.assignedElements()).toEqual([extra]);
  });
});
