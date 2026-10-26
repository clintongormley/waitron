import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invalidateMediaImages } from "@waitron/ui/src/live-media-image.js";
import type { DashboardApi, ThemeLogoPrint } from "../api/client.js";
import { es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { DashboardThemeLogoPrint } from "./theme-logo-print.js";
import "./theme-logo-print.js";

const BLACK: ThemeLogoPrint = {
  paperDots: 504,
  picture: { widthDots: 16, heightDots: 1, data: "8A8=" },
  blackDots: 8,
};
const BLANK: ThemeLogoPrint = {
  paperDots: 504,
  picture: { widthDots: 16, heightDots: 1, data: "AAA=" },
  blackDots: 0,
};

let sequence = 0;
/** A fresh library name per call, so the image watcher's module-wide memory never carries over. */
function libraryName(): string {
  return `${(20_000 + ++sequence).toString(16).padStart(64, "0")}.webp`;
}

function presentation(version: string) {
  return {
    id: version,
    revision: 1,
    source: `/media/${version}.webp`,
    square: `/media/${version}-square.webp`,
    till: `/media/${version}-till.webp`,
    display: `/media/${version}-display.webp`,
  };
}
function reply(images: Record<string, ReturnType<typeof presentation>>) {
  return new Response(JSON.stringify({ images }), {
    headers: { "Content-Type": "application/json" },
  });
}

let network: ReturnType<typeof vi.fn<typeof fetch>>;
let getThemeLogoPrint: ReturnType<typeof vi.fn<(image: string) => Promise<ThemeLogoPrint>>>;

beforeEach(() => {
  network = vi.fn<typeof fetch>().mockImplementation(async () => reply({}));
  vi.stubGlobal("fetch", network);
  getThemeLogoPrint = vi.fn<(image: string) => Promise<ThemeLogoPrint>>();
});

afterEach(() => {
  cleanupWidgets();
  vi.unstubAllGlobals();
  setLocale("en-GB");
});

function api(): DashboardApi {
  return { getThemeLogoPrint } as unknown as DashboardApi;
}

async function mount(image: string | null) {
  const { el } = await mountWidget<DashboardThemeLogoPrint>("dashboard-theme-logo-print", {
    api: api(),
    image,
  });
  return el;
}

const q = (el: DashboardThemeLogoPrint, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);

it("asks nothing and draws nothing without an image", async () => {
  const el = await mount(null);
  expect(getThemeLogoPrint).not.toHaveBeenCalled();
  expect(q(el, '[data-test="logo-print"]')).toBeNull();
  expect(q(el, '[data-test="logo-print-failed"]')).toBeNull();
});

it("while asking, shows an empty paper box marked busy and the caption", async () => {
  getThemeLogoPrint.mockReturnValue(new Promise(() => {}));
  const el = await mount(libraryName());
  const figure = q(el, '[data-test="logo-print"]')!;
  expect(figure.getAttribute("aria-busy")).toBe("true");
  expect(figure.textContent!.trim()).toBe(t("appearance.logo_print"));
  expect(figure.querySelector("img")).toBeNull();
});

it("shows the picture and the caption", async () => {
  getThemeLogoPrint.mockResolvedValue(BLACK);
  const image = libraryName();
  const el = await mount(image);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  const figure = q(el, '[data-test="logo-print"]')!;
  expect(figure.getAttribute("aria-busy")).toBe("false");
  const img = figure.querySelector("img")!;
  expect(img.getAttribute("src")!.startsWith("data:image/png")).toBe(true);
  expect(img.getAttribute("alt")).toBe("");
  expect(parseFloat(img.style.width)).toBeCloseTo((16 / 504) * 100, 3);
  expect(figure.querySelector("figcaption")!.textContent!.trim()).toBe(t("appearance.logo_print"));
  expect(q(el, '[data-test="logo-print-blank"]')).toBeNull();
  expect(getThemeLogoPrint).toHaveBeenCalledWith(image);
});

it("says when the logo prints blank", async () => {
  getThemeLogoPrint.mockResolvedValue(BLANK);
  const el = await mount(libraryName());
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-blank"]')).not.toBeNull());
  expect(q(el, '[data-test="logo-print-blank"]')!.textContent!.trim()).toBe(
    t("appearance.logo_print_blank"),
  );
  expect(q(el, '[data-test="logo-print"] img')).not.toBeNull();
});

it("draws nothing for an image the library does not have", async () => {
  getThemeLogoPrint.mockResolvedValue({ paperDots: 504, picture: null, blackDots: 0 });
  const el = await mount(libraryName());
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"]')).toBeNull());
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(1);
  expect(q(el, '[data-test="logo-print-failed"]')).toBeNull();
  expect(q(el, '[data-test="logo-print-blank"]')).toBeNull();
});

it("a failed ask says so and Try again asks again", async () => {
  getThemeLogoPrint.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(BLACK);
  const image = libraryName();
  const el = await mount(image);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-failed"]')).not.toBeNull());
  const failed = q(el, '[data-test="logo-print-failed"]')!;
  expect(failed.textContent).toContain(t("appearance.logo_print_failed"));
  const retry = failed.querySelector<HTMLElementTagNameMap["wt-button"]>("wt-button")!;
  expect(retry.textContent!.trim()).toBe(t("appearance.logo_print_retry"));
  expect(q(el, '[data-test="logo-print"]')).toBeNull();
  retry.click();
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  expect(getThemeLogoPrint.mock.calls).toEqual([[image], [image]]);
  expect(q(el, '[data-test="logo-print-failed"]')).toBeNull();
});

it("an ask that throws at once says so, as a refused one does", async () => {
  getThemeLogoPrint.mockImplementationOnce(() => {
    throw new Error("no such method");
  });
  const el = await mount(libraryName());
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-failed"]')).not.toBeNull());
  expect(q(el, '[data-test="logo-print"]')).toBeNull();
});

it("an answer for an image no longer held is dropped", async () => {
  const a = libraryName();
  const b = libraryName();
  let answerA!: (value: ThemeLogoPrint) => void;
  let answerB!: (value: ThemeLogoPrint) => void;
  getThemeLogoPrint
    .mockReturnValueOnce(new Promise((resolve) => (answerA = resolve)))
    .mockReturnValueOnce(new Promise((resolve) => (answerB = resolve)));
  const el = await mount(a);
  el.image = b;
  await el.updateComplete;
  answerB(BLACK);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  answerA(BLANK);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  expect(q(el, '[data-test="logo-print-blank"]')).toBeNull();
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [b]]);
});

it("asks again when the image changes under the same name", async () => {
  const a = libraryName();
  network.mockImplementation(async () => reply({ [a]: presentation("1") }));
  getThemeLogoPrint.mockResolvedValue(BLACK);
  const el = await mount(a);
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  // Let the first address's arrival settle: it must ask nothing more.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(1);

  network.mockImplementation(async () => reply({ [a]: presentation("2") }));
  const before = network.mock.calls.length;
  invalidateMediaImages();
  await vi.waitFor(() => expect(getThemeLogoPrint).toHaveBeenCalledTimes(2));
  expect(network.mock.calls.length).toBeGreaterThan(before);
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [a]]);

  const again = network.mock.calls.length;
  invalidateMediaImages();
  await vi.waitFor(() => expect(network.mock.calls.length).toBeGreaterThan(again));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(2);
});

it("stops watching the image once it leaves the page", async () => {
  const a = libraryName();
  network.mockImplementation(async () => reply({ [a]: presentation("1") }));
  getThemeLogoPrint.mockResolvedValue(BLACK);
  const el = await mount(a);
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  el.remove();
  network.mockImplementation(async () => reply({ [a]: presentation("2") }));
  const before = network.mock.calls.length;
  invalidateMediaImages();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(network.mock.calls.length).toBe(before);
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(1);
});

it("Spanish", async () => {
  setLocale("es-ES");
  getThemeLogoPrint.mockResolvedValue(BLANK);
  const el = await mount(libraryName());
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-blank"]')).not.toBeNull());
  expect(q(el, "figcaption")!.textContent!.trim()).toBe(es["appearance.logo_print"]);
  expect(q(el, '[data-test="logo-print-blank"]')!.textContent!.trim()).toBe(
    es["appearance.logo_print_blank"],
  );
});
