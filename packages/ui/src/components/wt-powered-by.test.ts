import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { mountThemed } from "../a11y-helpers.js";
import { cleanup, host, mount } from "../test-helpers.js";
import { THEME_STORAGE_KEY, chooseTheme, startThemeChoice } from "../theme-choice.js";
import type { WtPoweredBy } from "./wt-powered-by.js";
import type { WtWaitronLockup } from "./wt-waitron-lockup.js";
import "./wt-powered-by.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

const label = (el: WtPoweredBy) => el.shadowRoot!.querySelector<HTMLElement>("[part=label]")!;
const lockup = (el: WtPoweredBy) => el.shadowRoot!.querySelector<WtWaitronLockup>("[part=lockup]")!;
const drawing = (el: WtPoweredBy) => lockup(el).shadowRoot!.querySelector("svg")!;
/** The paint of the lockup's cloche and word. */
const inks = (el: WtPoweredBy) =>
  [...drawing(el).querySelectorAll(":scope > g")].map((g) => getComputedStyle(g).fill);
/** A colour token as the element it is read on resolves it. */
function token(el: Element, name: string): string {
  const probe = document.createElement("span");
  probe.style.color = getComputedStyle(el).getPropertyValue(name);
  el.parentNode!.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}
const themeInks = (el: Element) => [token(el, "--wt-color-primary"), token(el, "--wt-color-text")];

async function poweredBy(theme?: "light" | "dark"): Promise<WtPoweredBy> {
  const el = (await mountThemed(
    `<wt-powered-by label="Powered by"></wt-powered-by>`,
    theme,
  )) as WtPoweredBy;
  // mountThemed sets data-theme after the first render.
  el.requestUpdate();
  await el.updateComplete;
  return el;
}

afterEach(async () => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  chooseTheme("device");
  await commands.emulateColorScheme(null);
  startThemeChoice(document.documentElement);
  vi.restoreAllMocks();
  cleanup();
});

describe("wt-powered-by", () => {
  it("paints its words from its tokens", async () => {
    const el = await poweredBy("light");
    el.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    el.style.setProperty("--wt-font-size-sm", "17px");
    const style = getComputedStyle(label(el));
    expect(style.color).toBe("rgb(1, 2, 3)");
    expect(style.fontSize).toBe("17px");
  });

  it("lays its words and lockup out in a centred row", async () => {
    const el = await poweredBy("light");
    el.style.setProperty("--wt-space-2", "11px");
    const style = getComputedStyle(el);
    expect(style.display).toBe("flex");
    expect(style.alignItems).toBe("center");
    expect(style.justifyContent).toBe("center");
    expect(style.columnGap).toBe("11px");
  });

  it.each(["light", "dark"] as const)(
    "draws the lockup 64 px wide in the %s theme's colours",
    async (theme) => {
      const el = await poweredBy(theme);
      await lockup(el).updateComplete;
      expect(drawing(el).getBoundingClientRect().width).toBe(64);
      expect(drawing(el).getBoundingClientRect().height).toBeGreaterThan(0);
      expect(inks(el)).toEqual(themeInks(el));
    },
  );

  it("follows the setting and the device, asking nothing", async () => {
    const fetchSpy = vi.spyOn(window, "fetch");
    await commands.emulateColorScheme("light");
    const el = (await mount(`<wt-powered-by label="Powered by"></wt-powered-by>`)) as WtPoweredBy;
    startThemeChoice(host);
    await el.updateComplete;
    await lockup(el).updateComplete;
    const light = inks(el);
    expect(light).toEqual(themeInks(el));

    await commands.emulateColorScheme("dark");
    await vi.waitFor(() => expect(inks(el)).not.toEqual(light));
    const dark = inks(el);
    expect(dark).toEqual(themeInks(el));
    await commands.emulateColorScheme("light");
    await vi.waitFor(() => expect(inks(el)).toEqual(light));

    chooseTheme("dark");
    await vi.waitFor(() => expect(inks(el)).toEqual(dark));
    chooseTheme("light");
    await vi.waitFor(() => expect(inks(el)).toEqual(light));

    const asked = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(asked.filter((url) => url.includes("/api/theme"))).toEqual([]);
  });

  it("paints the lockup from a custom theme's colours", async () => {
    const el = await poweredBy("light");
    el.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
    el.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
    await lockup(el).updateComplete;
    expect(inks(el)).toEqual(["rgb(1, 2, 3)", "rgb(4, 5, 6)"]);
  });

  it("is named 'Powered by Waitron'", async () => {
    const el = await poweredBy("light");
    expect(label(el).textContent).toBe("Powered by");
    await lockup(el).updateComplete;
    expect(drawing(el).getAttribute("aria-label")).toBe("Waitron");
    expect(label(el).nextElementSibling).toBe(lockup(el));
    el.label = "Made with";
    await el.updateComplete;
    expect(label(el).textContent).toBe("Made with");
  });

  it("draws no label part without a label, and centres the lockup alone", async () => {
    const el = (await mountThemed(`<wt-powered-by></wt-powered-by>`, "light")) as WtPoweredBy;
    expect(el.shadowRoot!.querySelector("[part=label]")).toBeNull();
    const image = lockup(el);
    await image.updateComplete;
    const host = el.getBoundingClientRect();
    const box = image.getBoundingClientRect();
    expect(Math.abs(box.left + box.width / 2 - (host.left + host.width / 2))).toBeLessThan(0.5);
  });

  it("sizes the lockup at twice --wt-space-6", async () => {
    const el = await poweredBy("light");
    el.style.setProperty("--wt-space-6", "50px");
    const image = lockup(el);
    await image.updateComplete;
    expect(image.getBoundingClientRect().width).toBe(100);
  });

  it("has no link", async () => {
    const el = await poweredBy("light");
    expect(el.shadowRoot!.querySelector("a")).toBeNull();
  });
});
