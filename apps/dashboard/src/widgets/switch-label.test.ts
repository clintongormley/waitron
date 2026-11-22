import { afterEach, describe, expect, it, vi } from "vitest";
import { toDataURL } from "qrcode";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { decodeQrImage } from "../testing/decode-qr.js";
import type { SwitchLabel } from "./switch-label.js";
import "./switch-label.js";
import { setLocale, t } from "../i18n/t.js";
import { es } from "../i18n/strings.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

const ADDRESS = "https://box-abcd.waitron.local";
const SWITCH_PAGE = "https://box-abcd.waitron.local/handover/emergency";
/** A one-pixel image, so a held-back drawing has something to show. */
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
      "If the main box fails, scan this with any till or phone on the venue's network",
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
    expect(text(el, "switch-label-words")).toBe(es["servers.switch_label_words"]);
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

  it("never shows the QR of an address it was moved off while that QR was still being drawn", async () => {
    let finishFirst!: () => void;
    const held = new Promise<void>((resolve) => (finishFirst = resolve));
    let drawings = 0;
    const { el } = await mountWidget<SwitchLabel>("dashboard-switch-label", {
      address: ADDRESS,
      drawQr: async (page: string) => {
        if (drawings++ === 0) await held;
        return toDataURL(page, { margin: 2, width: 320 });
      },
    });
    const other = "https://box-ef01.waitron.local";
    const shownPage = async () => {
      const qr = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=switch-label-qr]");
      return qr && (await decodeQrImage(qr.src));
    };
    el.address = other;
    await vi.waitFor(async () => expect(await shownPage()).toBe(`${other}/handover/emergency`));

    finishFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(await shownPage()).toBe(`${other}/handover/emergency`);
  });

  it.each(["light", "dark"] as const)(
    "draws Print quiet like Close while the QR is being made, then blue (%s theme)",
    async (theme) => {
      let made!: (qr: string) => void;
      const { el } = await mountWidget<SwitchLabel>(
        "dashboard-switch-label",
        {
          address: ADDRESS,
          drawQr: () => new Promise<string>((resolve) => (made = resolve)),
        },
        theme,
      );
      const button = (test: string) =>
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${test}]`)!;
      const fill = (host: Element) =>
        getComputedStyle(host.shadowRoot!.querySelector("button")!).backgroundColor;
      const print = button("print-switch-label");
      const closeFill = fill(button("close-switch-label"));
      await print.updateComplete;
      expect(print.getAttribute("disabled")).not.toBeNull();
      expect(print.variant).toBe("secondary");
      expect(fill(print)).toBe(closeFill);
      made(PIXEL);
      await vi.waitFor(() => expect(print.getAttribute("disabled")).toBeNull());
      expect(print.variant).toBe("primary");
      expect(fill(print)).not.toBe(closeFill);
    },
  );

  it("closes, and says so", async () => {
    const { el } = await mount();
    const closed = vi.fn();
    el.addEventListener("wt-close", closed);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=close-switch-label]")!.click();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  });
});
