import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtVenueLogo } from "./wt-venue-logo.js";
import "./wt-venue-logo.js";

function png(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

const LIGHT = png(400, 100);
const DARK = png(300, 100);

afterEach(cleanup);

async function logo(attributes: string, theme: "light" | "dark"): Promise<WtVenueLogo> {
  const el = (await mountThemed(
    `<wt-venue-logo ${attributes}></wt-venue-logo>`,
    theme,
  )) as WtVenueLogo;
  el.requestUpdate();
  await el.updateComplete;
  return el;
}

const plated = (el: WtVenueLogo) =>
  el.shadowRoot!.querySelector(".box")!.hasAttribute("data-plate");

describe.each(["light", "dark"] as const)("wt-venue-logo a11y (%s theme)", (theme) => {
  test("a named logo", async () => {
    await logo(`light="${LIGHT}" dark="${DARK}" alt="Bar Lucía"`, theme);
    await expectNoA11yViolations(host);
  });

  test("a decorative logo", async () => {
    await logo(`light="${LIGHT}" dark="${DARK}" alt=""`, theme);
    await expectNoA11yViolations(host);
  });

  test("a logo with one image, on its plate on a dark screen", async () => {
    const el = await logo(`light="${LIGHT}" alt="Bar Lucía"`, theme);
    await vi.waitFor(() =>
      expect(
        el
          .shadowRoot!.querySelector<HTMLElement>(".box")!
          .style.getPropertyValue("--wt-venue-logo-ratio"),
      ).toBe("4"),
    );
    await el.updateComplete;
    expect(plated(el)).toBe(theme === "dark");
    await expectNoA11yViolations(host);
  });

  test("a failed logo showing a text fallback", async () => {
    const el = await logo(`light="/no-such.png" alt="Bar Lucía"`, theme);
    el.innerHTML = `<span slot="fallback">Bar Lucía</span>`;
    await vi.waitFor(() => expect(el.failed).toBe(true));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("an empty box", async () => {
    await logo("", theme);
    await expectNoA11yViolations(host);
  });

  test("control: the same mount with an image missing its alt is refused", async () => {
    await mountThemed(`<img src="${LIGHT}">`, theme);
    await expect(expectNoA11yViolations(host)).rejects.toThrow(/image-alt/);
  });
});
