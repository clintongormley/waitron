import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invalidateMediaImages } from "@waitron/ui/src/live-media-image.js";
import type { DashboardApi, ThemeLogoPrint } from "../api/client.js";
import { es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { ThemeLogoPrintFigure } from "./theme-logo-print.js";
import "./theme-logo-print.js";

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
/** What the server answers for a picture drawn from `version`'s display address. */
function drawn(version: string, blackDots: number): ThemeLogoPrint {
  return {
    paperDots: 504,
    address: presentation(version).display,
    picture: { widthDots: 16, heightDots: 1, data: blackDots === 0 ? "AAA=" : "8A8=" },
    blackDots,
  };
}
const BLACK = drawn("1", 8);
const BLANK = drawn("1", 0);
const NO_PICTURE: ThemeLogoPrint = { paperDots: 504, address: null, picture: null, blackDots: 0 };

/** Answers every image asked for as `version`, as the library does for an image it holds. */
function everyImageAs(version: string) {
  return async (input: RequestInfo | URL) => {
    const asked = new URL(String(input), location.origin).searchParams.get("references") ?? "";
    return reply(
      Object.fromEntries(asked.split(",").map((image) => [image, presentation(version)])),
    );
  };
}
/** Lets every library lookup already sent deliver what it heard. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function reply(images: Record<string, ReturnType<typeof presentation>>) {
  return new Response(JSON.stringify({ images }), {
    headers: { "Content-Type": "application/json" },
  });
}

let network: ReturnType<typeof vi.fn<typeof fetch>>;
let getThemeLogoPrint: ReturnType<typeof vi.fn<(image: string) => Promise<ThemeLogoPrint>>>;

beforeEach(() => {
  network = vi.fn<typeof fetch>().mockImplementation(everyImageAs("1"));
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
  const { el } = await mountWidget<ThemeLogoPrintFigure>("dashboard-theme-logo-print", {
    api: api(),
    image,
  });
  return el;
}

const q = (el: ThemeLogoPrintFigure, selector: string) =>
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
  network.mockImplementation(async () => reply({}));
  getThemeLogoPrint.mockResolvedValue(NO_PICTURE);
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
  await settled();
  await el.updateComplete;
  expect(q(el, '[data-test="logo-print-blank"]')).toBeNull();
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [b]]);
});

it("a refusal for an image no longer held is dropped", async () => {
  const a = libraryName();
  const b = libraryName();
  let refuseA!: (reason: Error) => void;
  getThemeLogoPrint
    .mockReturnValueOnce(new Promise((_, reject) => (refuseA = reject)))
    .mockResolvedValueOnce(BLACK);
  const el = await mount(a);
  el.image = b;
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  refuseA(new Error("offline"));
  await settled();
  await el.updateComplete;
  expect(q(el, '[data-test="logo-print-failed"]')).toBeNull();
  expect(q(el, '[data-test="logo-print"] img')).not.toBeNull();
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [b]]);
});

it("changing the image ends the old image's watch", async () => {
  const a = libraryName();
  const b = libraryName();
  getThemeLogoPrint.mockResolvedValue(BLACK);
  const el = await mount(a);
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  el.image = b;
  await vi.waitFor(() =>
    expect(network.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes(b))).toBe(
      true,
    ),
  );
  await settled();
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [b]]);

  network.mockImplementation(async () => reply({ [a]: presentation("2"), [b]: presentation("1") }));
  const before = network.mock.calls.length;
  invalidateMediaImages();
  await vi.waitFor(() => expect(network.mock.calls.length).toBeGreaterThan(before));
  await settled();
  const asked = decodeURIComponent(String(network.mock.calls.at(-1)![0]));
  expect(asked).toContain(b);
  expect(asked).not.toContain(a);
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [b]]);
});

it("asks again when the image changes under the same name", async () => {
  const a = libraryName();
  getThemeLogoPrint.mockResolvedValue(BLACK);
  const el = await mount(a);
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  // Let the first address's arrival settle: it must ask nothing more.
  await settled();
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
  await settled();
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(2);
});

it("stops watching the image once it leaves the page", async () => {
  const a = libraryName();
  getThemeLogoPrint.mockResolvedValue(BLACK);
  const el = await mount(a);
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  el.remove();
  network.mockImplementation(async () => reply({ [a]: presentation("2") }));
  const before = network.mock.calls.length;
  invalidateMediaImages();
  await settled();
  expect(network.mock.calls.length).toBe(before);
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(1);
});

it("a reframe heard before the first lookup answered asks again", async () => {
  const a = libraryName();
  let firstLookup!: (value: Response) => void;
  network.mockImplementationOnce(() => new Promise((resolve) => (firstLookup = resolve)));
  getThemeLogoPrint.mockResolvedValueOnce(BLACK).mockResolvedValue(drawn("2", 0));
  const el = await mount(a);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  await vi.waitFor(() => expect(firstLookup).toBeDefined());
  firstLookup(reply({ [a]: presentation("2") }));
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-blank"]')).not.toBeNull());
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [a]]);

  network.mockImplementation(everyImageAs("2"));
  const before = network.mock.calls.length;
  invalidateMediaImages();
  await vi.waitFor(() => expect(network.mock.calls.length).toBeGreaterThan(before));
  await settled();
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(2);
});

it("a reframe heard while asking asks again once the answer arrives", async () => {
  const a = libraryName();
  let answer!: (value: ThemeLogoPrint) => void;
  getThemeLogoPrint
    .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    .mockResolvedValue(drawn("2", 0));
  network.mockImplementation(everyImageAs("2"));
  const el = await mount(a);
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  await settled();
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(1);
  answer(BLACK);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-blank"]')).not.toBeNull());
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [a]]);
});

it("an answer drawn from an address not yet heard asks no more until that address is heard", async () => {
  const a = libraryName();
  getThemeLogoPrint.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(drawn("2", 8));
  const el = await mount(a);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-failed"]')).not.toBeNull());
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  await settled();
  q(el, '[data-test="logo-print-failed"] wt-button')!.click();
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());

  for (const version of ["1", "2", "2"]) {
    network.mockImplementation(everyImageAs(version));
    const before = network.mock.calls.length;
    invalidateMediaImages();
    await vi.waitFor(() => expect(network.mock.calls.length).toBeGreaterThan(before));
    await settled();
  }
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(2);
  expect(q(el, '[data-test="logo-print"] img')).not.toBeNull();
});

it("a reframe after a failed ask asks again", async () => {
  const a = libraryName();
  getThemeLogoPrint.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(drawn("2", 8));
  const el = await mount(a);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-failed"]')).not.toBeNull());
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  await settled();
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(1);

  network.mockImplementation(everyImageAs("2"));
  invalidateMediaImages();
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [a]]);
});

it("an image deleted from the library draws nothing, and asks afresh when it comes back", async () => {
  const a = libraryName();
  getThemeLogoPrint.mockResolvedValue(BLANK);
  const el = await mount(a);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-blank"]')).not.toBeNull());
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  await settled();

  network.mockImplementation(async () => reply({}));
  invalidateMediaImages();
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"]')).toBeNull());
  expect(q(el, '[data-test="logo-print-blank"]')).toBeNull();
  expect(q(el, '[data-test="logo-print-failed"]')).toBeNull();
  expect(getThemeLogoPrint).toHaveBeenCalledTimes(1);

  network.mockImplementation(everyImageAs("1"));
  getThemeLogoPrint.mockResolvedValue(BLACK);
  invalidateMediaImages();
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [a]]);
  expect(q(el, '[data-test="logo-print-blank"]')).toBeNull();
});

it("an answer that arrives after the image was deleted is dropped", async () => {
  const a = libraryName();
  let answer!: (value: ThemeLogoPrint) => void;
  getThemeLogoPrint.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
  network.mockImplementation(async () => reply({}));
  const el = await mount(a);
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"]')).toBeNull());
  answer(BLACK);
  await settled();
  await el.updateComplete;
  expect(q(el, '[data-test="logo-print"]')).toBeNull();
});

it("put back on the page after a reframe, asks again", async () => {
  const a = libraryName();
  getThemeLogoPrint.mockResolvedValueOnce(BLACK).mockResolvedValue(drawn("2", 0));
  const el = await mount(a);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print"] img')).not.toBeNull());
  await vi.waitFor(() => expect(network).toHaveBeenCalled());
  await settled();
  const parent = el.parentElement!;
  el.remove();
  network.mockImplementation(everyImageAs("2"));
  parent.append(el);
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-blank"]')).not.toBeNull());
  expect(getThemeLogoPrint.mock.calls).toEqual([[a], [a]]);
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

it("the paper box has a hairline edge in the border colour", async () => {
  getThemeLogoPrint.mockResolvedValue(BLANK);
  const el = await mount(libraryName());
  await vi.waitFor(() => expect(q(el, '[data-test="logo-print-blank"]')).not.toBeNull());
  const paper = q(el, '[data-test="logo-print"] .paper')!;
  const style = getComputedStyle(paper);
  expect(style.borderTopWidth).toBe("1px");
  expect(style.borderTopStyle).toBe("solid");
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-border)";
  paper.append(probe);
  const token = getComputedStyle(probe).color;
  probe.remove();
  expect(token).not.toBe(getComputedStyle(paper).color);
  expect(style.borderTopColor).toBe(token);
});
