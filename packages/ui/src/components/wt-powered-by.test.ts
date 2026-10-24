import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { mountThemed } from "../a11y-helpers.js";
import { cleanup, host, mount } from "../test-helpers.js";
import { THEME_STORAGE_KEY, chooseTheme, startThemeChoice } from "../theme-choice.js";
import { WAITRON_LOCKUP_DARK_URL, WAITRON_LOCKUP_URL } from "../waitron-lockup.js";
import type { WtPoweredBy } from "./wt-powered-by.js";
import "./wt-powered-by.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

const label = (el: WtPoweredBy) => el.shadowRoot!.querySelector<HTMLElement>("[part=label]")!;
const lockup = (el: WtPoweredBy) =>
  el.shadowRoot!.querySelector<HTMLImageElement>("[part=lockup]")!;

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

  it.each([
    { theme: "light", src: WAITRON_LOCKUP_URL },
    { theme: "dark", src: WAITRON_LOCKUP_DARK_URL },
  ] as const)("draws the lockup 64 px wide, $theme by its root", async ({ theme, src }) => {
    const el = await poweredBy(theme);
    const image = lockup(el);
    expect(image.src).toBe(src);
    await vi.waitFor(() => expect(image.complete && image.naturalWidth > 0).toBe(true));
    expect(image.getBoundingClientRect().width).toBe(64);
    expect(image.getBoundingClientRect().height).toBeGreaterThan(0);
  });

  it("switches its lockup with the setting and the device, asking nothing", async () => {
    const fetchSpy = vi.spyOn(window, "fetch");
    await commands.emulateColorScheme("light");
    const el = (await mount(`<wt-powered-by label="Powered by"></wt-powered-by>`)) as WtPoweredBy;
    startThemeChoice(host);
    await el.updateComplete;
    expect(lockup(el).src).toBe(WAITRON_LOCKUP_URL);

    await commands.emulateColorScheme("dark");
    await vi.waitFor(() => expect(lockup(el).src).toBe(WAITRON_LOCKUP_DARK_URL));
    await commands.emulateColorScheme("light");
    await vi.waitFor(() => expect(lockup(el).src).toBe(WAITRON_LOCKUP_URL));

    chooseTheme("dark");
    await el.updateComplete;
    expect(lockup(el).src).toBe(WAITRON_LOCKUP_DARK_URL);
    chooseTheme("light");
    await el.updateComplete;
    expect(lockup(el).src).toBe(WAITRON_LOCKUP_URL);

    const asked = fetchSpy.mock.calls.map(([input]) => String(input));
    expect(asked.filter((url) => url.includes("/api/theme"))).toEqual([]);
  });

  it("is named 'Powered by Waitron'", async () => {
    const el = await poweredBy("light");
    expect(label(el).textContent).toBe("Powered by");
    expect(lockup(el).alt).toBe("Waitron");
    expect(label(el).nextElementSibling).toBe(lockup(el));
    el.label = "Made with";
    await el.updateComplete;
    expect(label(el).textContent).toBe("Made with");
  });

  it("draws no label part without a label, and centres the lockup alone", async () => {
    const el = (await mountThemed(`<wt-powered-by></wt-powered-by>`, "light")) as WtPoweredBy;
    expect(el.shadowRoot!.querySelector("[part=label]")).toBeNull();
    const image = lockup(el);
    await vi.waitFor(() => expect(image.complete && image.naturalWidth > 0).toBe(true));
    const host = el.getBoundingClientRect();
    const box = image.getBoundingClientRect();
    expect(Math.abs(box.left + box.width / 2 - (host.left + host.width / 2))).toBeLessThan(0.5);
  });

  it("sizes the lockup at twice --wt-space-6", async () => {
    const el = await poweredBy("light");
    el.style.setProperty("--wt-space-6", "50px");
    const image = lockup(el);
    await vi.waitFor(() => expect(image.complete && image.naturalWidth > 0).toBe(true));
    expect(image.getBoundingClientRect().width).toBe(100);
  });

  it("has no link", async () => {
    const el = await poweredBy("light");
    expect(el.shadowRoot!.querySelector("a")).toBeNull();
  });
});
