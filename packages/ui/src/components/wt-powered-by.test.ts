import { afterEach, describe, expect, it, vi } from "vitest";
import { mountThemed } from "../a11y-helpers.js";
import { cleanup } from "../test-helpers.js";
import { WAITRON_LOCKUP_DARK_URL, WAITRON_LOCKUP_URL } from "../waitron-lockup.js";
import type { WtPoweredBy } from "./wt-powered-by.js";
import "./wt-powered-by.js";

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

afterEach(cleanup);

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

  it("is named 'Powered by Waitron'", async () => {
    const el = await poweredBy("light");
    expect(label(el).textContent).toBe("Powered by");
    expect(lockup(el).alt).toBe("Waitron");
    expect(label(el).nextElementSibling).toBe(lockup(el));
    el.label = "Con la tecnología de";
    await el.updateComplete;
    expect(label(el).textContent).toBe("Con la tecnología de");
  });

  it("draws no words without a label", async () => {
    const el = (await mountThemed(`<wt-powered-by></wt-powered-by>`, "light")) as WtPoweredBy;
    expect(label(el).textContent).toBe("");
  });

  it("has no link", async () => {
    const el = await poweredBy("light");
    expect(el.shadowRoot!.querySelector("a")).toBeNull();
  });
});
