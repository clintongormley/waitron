import { afterEach, describe, expect, it, vi } from "vitest";
import { toDataURL } from "qrcode";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { decodeQrImage } from "../testing/decode-qr.js";
import type { SwitchLabel } from "./switch-label.js";
import "./switch-label.js";
import { setLocale, t } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const ADDRESS = "https://box-abcd.waitron.local";
const SWITCH_PAGE = "https://box-abcd.waitron.local/handover/emergency";

async function mount(printFrame = vi.fn<(view: Window) => void>()) {
  const { el } = await mountWidget<SwitchLabel>("dashboard-switch-label", {
    address: ADDRESS,
    printFrame,
  });
  const qr = () => el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=switch-label-qr]");
  await vi.waitFor(() => expect(qr()).not.toBeNull());
  return { el, qr: qr()!, printFrame };
}

const text = (el: SwitchLabel, test: string) =>
  el.shadowRoot!.querySelector(`[data-test=${test}]`)!.textContent!.trim();

describe("dashboard-switch-label", () => {
  it("shows a QR of the box's switch page, its name above and the address under it", async () => {
    const { el, qr } = await mount();
    expect(qr.src).toBe(await toDataURL(SWITCH_PAGE, { margin: 2, width: 320 }));
    expect(await decodeQrImage(qr.src)).toBe(SWITCH_PAGE);
    expect(text(el, "switch-label-name")).toBe("box-abcd.waitron.local");
    expect(text(el, "switch-label-address")).toBe(SWITCH_PAGE);
    expect(text(el, "switch-label-words")).toBe(
      "If the main server fails, scan this with any till or phone on the venue's network",
    );
    const figure = el.shadowRoot!.querySelector("figure")!;
    expect([...figure.children].map((child) => child.getAttribute("data-test"))).toEqual([
      "switch-label-name",
      "switch-label-qr",
      "switch-label-address",
      "switch-label-words",
    ]);
  });

  it("speaks Spanish in Spanish", async () => {
    setLocale("es");
    const { el } = await mount();
    expect(text(el, "switch-label-words")).toBe(
      "Si el servidor principal falla, escanea esto con cualquier caja o móvil conectado a la red del local",
    );
  });

  it("prints the name, the QR, the address and the words through the frame it is given", async () => {
    const { el, qr, printFrame } = await mount();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=print-switch-label]")!.click();
    await vi.waitFor(() => expect(printFrame).toHaveBeenCalledTimes(1));
    const body = printFrame.mock.calls[0]![0].document.body;
    expect([...body.children].map((child) => child.tagName)).toEqual(["P", "IMG", "P", "P"]);
    expect(body.querySelector("img")!.getAttribute("src")).toBe(qr.src);
    expect([...body.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "box-abcd.waitron.local",
      SWITCH_PAGE,
      t("servers.switch_label_words"),
    ]);
    printFrame.mock.calls[0]![0].dispatchEvent(new Event("afterprint"));
  });
});
