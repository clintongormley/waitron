import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { userEvent } from "vitest/browser";
import type { WtSlider } from "./wt-slider.js";
import "./wt-slider.js";

afterEach(cleanup);

// axe scores no colour that is not text, so the marks' contrast with the page is measured here.
function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, bl] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe.each(["light", "dark"] as const)("wt-slider a11y (%s theme)", (theme) => {
  test("at rest", async () => {
    await mountThemed('<wt-slider label="Columns" min="2" max="6" value="4"></wt-slider>', theme);
    await expectNoA11yViolations(host);
  });

  test("at the minimum", async () => {
    await mountThemed('<wt-slider label="Columns" min="6" max="10" value="6"></wt-slider>', theme);
    await expectNoA11yViolations(host);
  });

  test.each(["", " marks"])(
    "with a value off the step, spoken as the snapped value%s",
    async (marks) => {
      const el = (await mountThemed(
        `<wt-slider label="Columns" min="2" max="10" step="3" value="4"${marks}></wt-slider>`,
        theme,
      )) as WtSlider;
      el.valueText = (n) => `${n} columns`;
      await el.updateComplete;
      await expectNoA11yViolations(host);
      const input = el.shadowRoot!.querySelector("input")!;
      expect(el.shadowRoot!.querySelector('[part="value"]')!.textContent).toBe("5");
      expect(input.getAttribute("aria-valuetext")).toBe("5 columns");
    },
  );

  test("with an error", async () => {
    await mountThemed(
      '<wt-slider label="Columns" min="2" max="6" value="4" error="Pick a number from 2 to 6"></wt-slider>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with a hint and a spoken value", async () => {
    const el = (await mountThemed(
      '<wt-slider label="Text size" min="100" max="130" value="110" hint="Bigger text wraps more"></wt-slider>',
      theme,
    )) as WtSlider;
    el.format = (n) => `${n}%`;
    el.valueText = (n) => `${n} percent`;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test.each([100, 130])("with marks, a hint and a spoken value, at %s", async (value) => {
    const el = (await mountThemed(
      `<wt-slider label="Text size" min="100" max="130" step="5" value="${value}" marks hint="Bigger text wraps more"></wt-slider>`,
      theme,
    )) as WtSlider;
    el.format = (n) => `${n}%`;
    el.valueText = (n) => `${n} percent`;
    await el.updateComplete;
    await expectNoA11yViolations(host);
    const marks = el.shadowRoot!.querySelector('[part="marks"]')!;
    expect(marks.getAttribute("aria-hidden")).toBe("true");
    const mark = marks.querySelectorAll('[part="mark"]');
    expect(mark).toHaveLength(7);
    const page = getComputedStyle(host).backgroundColor;
    for (const each of mark) {
      const box = each.getBoundingClientRect();
      expect(box.width * box.height).toBeGreaterThan(0);
      expect(contrastRatio(getComputedStyle(each).backgroundColor, page)).toBeGreaterThanOrEqual(3);
    }
  });

  test("with a hint and an error", async () => {
    await mountThemed(
      '<wt-slider label="Columns" min="2" max="6" value="4" hint="Wider screens fit more" error="Pick a number from 2 to 6"></wt-slider>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountThemed(
      '<wt-slider label="Columns" min="2" max="6" value="4" disabled></wt-slider>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("continuous zoom while keyboard focused", async () => {
    const el = await mountThemed(
      '<wt-slider label="Zoom" name="photo-zoom" min="100" max="400" value="200" continuous></wt-slider>',
      theme,
    );
    el.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expectNoA11yViolations(host);
  });

  test.each([100, 400])("continuous zoom at %s percent", async (value) => {
    await mountThemed(
      `<wt-slider label="Zoom" name="photo-zoom" min="100" max="400" value="${value}" continuous></wt-slider>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("continuous zoom disabled", async () => {
    await mountThemed(
      '<wt-slider label="Zoom" name="photo-zoom" min="100" max="400" value="200" continuous disabled></wt-slider>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
