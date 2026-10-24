import { WAITRON_CHOICES, themeSheet } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { mountThemed } from "../a11y-helpers.js";
import { cleanup, host, mount } from "../test-helpers.js";
import { THEME_STORAGE_KEY, chooseTheme, startThemeChoice } from "../theme-choice.js";
import type { WtVenueLogo } from "./wt-venue-logo.js";
import "./wt-venue-logo.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

function png(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

const LIGHT = png(400, 100);
const DARK = png(300, 100);

const box = (el: WtVenueLogo) => el.shadowRoot!.querySelector<HTMLElement>(".box")!;
const img = (el: WtVenueLogo) => el.shadowRoot!.querySelector<HTMLImageElement>("img");

async function logo(attributes: string, theme?: "light" | "dark"): Promise<WtVenueLogo> {
  const el = (await mountThemed(
    `<wt-venue-logo ${attributes}></wt-venue-logo>`,
    theme,
  )) as WtVenueLogo;
  // mountThemed sets data-theme after the first render, which the box does not watch.
  el.requestUpdate();
  await el.updateComplete;
  return el;
}

async function loaded(el: WtVenueLogo): Promise<void> {
  await vi.waitFor(() => {
    const image = img(el)!;
    expect(image.complete && image.naturalWidth > 0).toBe(true);
    expect(box(el).style.getPropertyValue("--wt-venue-logo-ratio")).not.toBe("0");
  });
  await el.updateComplete;
}

const SIZES = [
  { size: "banner", height: 40, width: 160 },
  { size: "bar", height: 32, width: 128 },
  { size: "sign-in", height: 96, width: 320 },
] as const;

const SHAPES = [
  { name: "4:1", width: 400, height: 100 },
  { name: "6:1", width: 600, height: 100 },
  { name: "1:4", width: 100, height: 400 },
  { name: "40 x 10", width: 40, height: 10 },
] as const;

const sheets: CSSStyleSheet[] = [];

afterEach(async () => {
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => !sheets.includes(s));
  sheets.length = 0;
  localStorage.removeItem(THEME_STORAGE_KEY);
  chooseTheme("device");
  await commands.emulateColorScheme(null);
  startThemeChoice(document.documentElement);
  vi.restoreAllMocks();
  cleanup();
});

describe("wt-venue-logo", () => {
  it("paints its plate from its token", async () => {
    const el = await logo(`light="${LIGHT}"`, "dark");
    el.style.setProperty("--wt-color-logo-plate", "rgb(1, 2, 3)");
    expect(getComputedStyle(box(el)).backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("draws the light image on light screens and the dark one on dark screens", async () => {
    const light = await logo(`light="${LIGHT}" dark="${DARK}"`, "light");
    expect(img(light)!.src).toBe(LIGHT);
    const dark = await logo(`light="${LIGHT}" dark="${DARK}"`, "dark");
    expect(img(dark)!.src).toBe(DARK);
    expect(box(dark).hasAttribute("data-plate")).toBe(false);
  });

  it("draws the light image on a white plate on dark screens with one image", async () => {
    const dark = await logo(`light="${LIGHT}"`, "dark");
    expect(img(dark)!.src).toBe(LIGHT);
    expect(box(dark).hasAttribute("data-plate")).toBe(true);
    const style = getComputedStyle(box(dark));
    expect(style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(style.paddingTop).toBe("4px");
    expect(style.paddingInlineStart).toBe("4px");

    const light = await logo(`light="${LIGHT}"`, "light");
    expect(box(light).hasAttribute("data-plate")).toBe(false);
    expect(getComputedStyle(box(light)).paddingTop).toBe("0px");
  });

  it("the plate stays white with Cards set by hand to pure blue", async () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      themeSheet(
        deriveTheme({
          ...WAITRON_CHOICES,
          handSet: { light: { surface: "#0000ff" }, dark: { surface: "#0000ff" } },
        }),
      ),
    );
    sheets.push(sheet);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const el = await logo(`light="${LIGHT}"`, "dark");
    expect(getComputedStyle(host).getPropertyValue("--wt-color-surface")).toBe("#0000ff");
    expect(getComputedStyle(box(el)).backgroundColor).toBe("rgb(255, 255, 255)");
  });

  describe.each(SIZES)("keeps each logo's shape in a $size box", ({ size, height, width }) => {
    it.each(SHAPES)("$name", async (shape) => {
      const el = await logo(`size="${size}" light="${png(shape.width, shape.height)}"`, "light");
      await loaded(el);
      const drawn = img(el)!.getBoundingClientRect();
      const frame = box(el).getBoundingClientRect();
      expect(Math.abs(drawn.width / drawn.height - shape.width / shape.height)).toBeLessThan(0.05);
      expect(drawn.height).toBeLessThanOrEqual(frame.height + 0.5);
      expect(drawn.width).toBeLessThanOrEqual(width + 0.5);
      expect(frame.height).toBeCloseTo(height, 0);
    });
  });

  it.each([
    { size: "banner", shape: [600, 100], drawn: [160, 26.7] },
    { size: "sign-in", shape: [400, 100], drawn: [320, 80] },
    { size: "bar", shape: [100, 400], drawn: [8, 32] },
    { size: "banner", shape: [40, 10], drawn: [160, 40] },
  ] as const)(
    "draws a $shape.0 x $shape.1 image in a $size box at $drawn.0 x $drawn.1",
    async ({ size, shape, drawn }) => {
      const el = await logo(`size="${size}" light="${png(shape[0], shape[1])}"`, "light");
      await loaded(el);
      const rect = img(el)!.getBoundingClientRect();
      expect(Math.abs(rect.width - drawn[0])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(rect.height - drawn[1])).toBeLessThanOrEqual(0.5);
    },
  );

  it("reflects its size, banner by default", async () => {
    const el = await logo("");
    expect(el.size).toBe("banner");
    expect(el.getAttribute("size")).toBe("banner");
    el.size = "bar";
    await el.updateComplete;
    expect(el.getAttribute("size")).toBe("bar");
  });

  it.each(SIZES)(
    "keeps its height with no address, and while loading ($size)",
    async ({ size, height }) => {
      const el = await logo(`size="${size}"`, "light");
      expect(img(el)).toBeNull();
      const empty = box(el).getBoundingClientRect();
      expect(empty.height).toBeCloseTo(height, 1);
      expect(empty.width).toBe(0);

      const blank = await logo(`size="${size}" light=""`, "dark");
      expect(img(blank)).toBeNull();
      expect(box(blank).hasAttribute("data-plate")).toBe(false);

      el.light = png(400, 100);
      await el.updateComplete;
      expect(img(el)).not.toBeNull();
      expect(box(el).getBoundingClientRect().height).toBeCloseTo(height, 1);
    },
  );

  it("forgets the old image's shape when the drawn address changes", async () => {
    const el = await logo(`light="${png(400, 100)}"`, "light");
    await loaded(el);
    expect(box(el).style.getPropertyValue("--wt-venue-logo-ratio")).toBe("4");
    el.light = png(100, 400);
    await el.updateComplete;
    expect(box(el).style.getPropertyValue("--wt-venue-logo-ratio")).toBe("0");
    await loaded(el);
    expect(box(el).style.getPropertyValue("--wt-venue-logo-ratio")).toBe("0.25");
    el.alt = "Bar";
    await el.updateComplete;
    expect(box(el).style.getPropertyValue("--wt-venue-logo-ratio")).toBe("0.25");
  });

  it("shrinks inside a narrow row, keeping the shape", async () => {
    const row = await mount(
      `<div style="display: flex; inline-size: 60px"><wt-venue-logo light="${png(400, 100)}"></wt-venue-logo></div>`,
    );
    const el = row.querySelector<WtVenueLogo>("wt-venue-logo")!;
    await loaded(el);
    const drawn = img(el)!.getBoundingClientRect();
    const frame = box(el).getBoundingClientRect();
    expect(Math.abs(drawn.width - 60)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(drawn.height - 15)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(frame.width - 60)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(frame.height - 40)).toBeLessThanOrEqual(0.5);
  });

  it("switches with the setting and the device, asking nothing", async () => {
    const fetchSpy = vi.spyOn(window, "fetch");
    await commands.emulateColorScheme("light");
    const el = (await mount(`<wt-venue-logo light="${LIGHT}"></wt-venue-logo>`)) as WtVenueLogo;
    startThemeChoice(host);
    await el.updateComplete;
    expect(img(el)!.src).toBe(LIGHT);
    expect(box(el).hasAttribute("data-plate")).toBe(false);

    await commands.emulateColorScheme("dark");
    await vi.waitFor(() => expect(box(el).hasAttribute("data-plate")).toBe(true));
    expect(img(el)!.src).toBe(LIGHT);

    await commands.emulateColorScheme("light");
    await vi.waitFor(() => expect(box(el).hasAttribute("data-plate")).toBe(false));

    el.dark = DARK;
    chooseTheme("dark");
    await el.updateComplete;
    expect(img(el)!.src).toBe(DARK);
    chooseTheme("light");
    await el.updateComplete;
    expect(img(el)!.src).toBe(LIGHT);

    const asked = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(asked.filter((url) => url.includes("/api/theme"))).toEqual([]);
  });

  it("reports a failed and a loaded image", async () => {
    const errors: CustomEvent<{ src: string }>[] = [];
    const loads: CustomEvent<{ src: string }>[] = [];
    document.addEventListener("wt-logo-error", (e) => errors.push(e as CustomEvent), {
      once: true,
    });
    document.addEventListener("wt-logo-load", (e) => loads.push(e as CustomEvent), { once: true });

    const failing = await logo(`light="/no-such.png"`, "light");
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]!.detail).toEqual({ src: "/no-such.png" });
    expect(errors[0]!.bubbles && errors[0]!.composed).toBe(true);
    expect(errors[0]!.target).toBe(failing);

    const good = await logo(`light="${LIGHT}"`, "light");
    await vi.waitFor(() => expect(loads).toHaveLength(1));
    expect(loads[0]!.detail).toEqual({ src: LIGHT });
    expect(loads[0]!.bubbles && loads[0]!.composed).toBe(true);
    expect(loads[0]!.target).toBe(good);
  });

  it("stops the image's own load and error events at the box", async () => {
    const el = await logo(`light="${LIGHT}"`, "light");
    const native: string[] = [];
    const listen = (e: Event) => native.push(e.type);
    el.shadowRoot!.addEventListener("load", listen);
    el.shadowRoot!.addEventListener("error", listen);
    const loadEvent = new Event("load", { bubbles: true });
    img(el)!.dispatchEvent(loadEvent);
    const errorEvent = new Event("error", { bubbles: true });
    img(el)!.dispatchEvent(errorEvent);
    expect(native).toEqual([]);
  });

  it("draws its image with the alt it is given, empty by default", async () => {
    const plain = await logo(`light="${LIGHT}"`);
    expect(plain.alt).toBe("");
    expect(img(plain)!.getAttribute("alt")).toBe("");
    const named = await logo(`light="${LIGHT}" alt="Bar Lucía"`);
    expect(img(named)!.getAttribute("alt")).toBe("Bar Lucía");
    expect(img(named)!.getAttribute("part")).toBe("image");
    expect(box(named).getAttribute("part")).toBe("box");
  });
});
