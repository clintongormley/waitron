import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import { modePill } from "./mode-pill.js";
import "./screens/done-screen.js";
import "./screens/provisioning-screen.js";
import "./screens/review-screen.js";
import type { SetupApi } from "./api/client.js";

afterEach(() => {
  setLocale("en-GB");
  cleanupWidgets();
});

function rendered(mode: string | undefined): HTMLElement {
  const container = document.createElement("div");
  render(modePill(mode, "some-pill"), container);
  return container.querySelector<HTMLElement>("span")!;
}

const LOOK = [
  "border-top-left-radius",
  "border-bottom-right-radius",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "background-color",
  "border-top-color",
  "border-top-width",
  "border-top-style",
  "font-weight",
  "color",
] as const;

async function pillOf(tag: string, props: object, testId: string): Promise<HTMLElement> {
  const { el, host } = await mountWidget<HTMLElement>(tag, props);
  host.style.setProperty("--wt-color-surface", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-surface-raised", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-border", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-radius-full", "29px");
  host.style.setProperty("--wt-space-1", "3px");
  host.style.setProperty("--wt-space-3", "11px");
  return el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${testId}]`)!;
}

const look = (pill: HTMLElement) => {
  const style = getComputedStyle(pill);
  return Object.fromEntries(LOOK.map((name) => [name, style.getPropertyValue(name)]));
};

describe("the mode pill", () => {
  it("looks the same on the review, provisioning and done screens, drawn from tokens", async () => {
    const review = await pillOf("setup-review-screen", { draft: { mode: "live" } }, "mode-badge");
    const provisioning = await pillOf(
      "setup-provisioning-screen",
      { onboardingIntent: "live" },
      "mode-indicator",
    );
    const done = await pillOf(
      "setup-done-screen",
      {
        api: { getStatus: () => new Promise(() => {}) } as unknown as SetupApi,
        startDelayMs: 0,
        onboardingIntent: "live",
      },
      "mode-indicator",
    );
    expect(look(review)).toMatchObject({
      "border-top-left-radius": "29px",
      "padding-top": "3px",
      "padding-left": "11px",
      "background-color": "rgb(4, 5, 6)",
      "border-top-color": "rgb(7, 8, 9)",
    });
    expect(look(provisioning)).toEqual(look(review));
    expect(look(done)).toEqual(look(review));
  });
});

describe("modePill", () => {
  it("is one span carrying the pill class and the given test id", () => {
    const pill = rendered("demo");
    expect(pill.className).toBe("mode-pill");
    expect(pill.dataset.test).toBe("some-pill");
  });

  it.each([
    [undefined, "—", "—"],
    ["demo", "Demo", "Demostración"],
    ["prepare", "Preparation", "Preparación"],
    ["live", "Live", "En vivo"],
    ["someday", "someday", "someday"],
    ["toString", "toString", "toString"],
  ] as const)("names the mode %s as %s, and in Spanish as %s", (mode, english, spanish) => {
    expect(rendered(mode).textContent).toBe(english);
    setLocale("es-ES");
    expect(rendered(mode).textContent).toBe(spanish);
  });
});
