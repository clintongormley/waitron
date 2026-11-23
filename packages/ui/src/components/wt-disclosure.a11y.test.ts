import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { WtDisclosure } from "./wt-disclosure.js";
import "./wt-disclosure.js";
import "./wt-help-tooltip.js";
import { setHelpMode } from "../help-mode.js";

afterEach(cleanup);
afterEach(() => setHelpMode(false));

describe.each(["light", "dark"] as const)("wt-disclosure a11y (%s theme)", (theme) => {
  test.each(["", "open", "has-error"])("ruled section %s", async (state) => {
    await mountThemed(
      `<wt-disclosure ruled heading="Selling" ${state}><span slot="summary">Available</span><p>Anyone can order</p></wt-disclosure>`,
      theme,
    );
    await expectNoA11yViolations(host);
  });
  test("collapsed", async () => {
    await mountThemed(
      '<wt-disclosure heading="Kitchen" summary="2 options"><p>body</p></wt-disclosure>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("open", async () => {
    await mountThemed(
      '<wt-disclosure heading="Kitchen" summary="2 options" open><p>body</p></wt-disclosure>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("has-error", async () => {
    await mountThemed(
      '<wt-disclosure heading="Kitchen" summary="Check this field" has-error><p>body</p></wt-disclosure>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("collapsed, with named summary fields", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryFields = [
      { label: "Display", value: "Counter" },
      { label: "Course", value: "Starters" },
    ];
    await el.updateComplete;
    // Without this the scan could pass on a header that drew no field names.
    expect(el.shadowRoot!.querySelectorAll(".summary-label")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  test("collapsed, with summary rows", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Descriptors"><p>body</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryRows = [
      {
        fields: [{ label: "Name", value: "EN: Beef tenderloin · ES: Solomillo de ternera" }],
        lines: 1,
      },
      { fields: [{ label: "Description", value: "EN: Seared · ES: Sellado" }], lines: 2 },
    ];
    await el.updateComplete;
    // Without this the scan could pass on a header that drew no rows.
    expect(el.shadowRoot!.querySelectorAll(".summary-row .summary-label")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  test("collapsed, with a value drawn as a placeholder", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Kitchen"><p>body</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryFields = [
      { label: "Kitchen name", value: "None specified" },
      { label: "Course", value: "Mains", placeholder: true },
    ];
    await el.updateComplete;
    // Without this the scan could pass on a header that drew no placeholder value.
    expect(el.shadowRoot!.querySelectorAll(".summary-placeholder")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  test("collapsed, with a value drawn as a warning", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Allergens"><p>body</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryFields = [
      { label: "Allergens", value: "Not yet reviewed", warning: true },
      { label: "Course", value: "Mains", placeholder: true, warning: true },
    ];
    await el.updateComplete;
    // Without this the scan could pass on a header that drew no warning value.
    expect(el.shadowRoot!.querySelectorAll(".summary-warning")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  test("collapsed, with a summary row drawn as a placeholder", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Descriptors"><p>body</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryRows = [
      { fields: [{ label: "Name", value: "None specified" }], lines: 1 },
      {
        fields: [{ label: "Description", value: "EN: Roasted in house", placeholder: true }],
        lines: 2,
      },
    ];
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll(".summary-row .summary-placeholder")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  test.each(["", "open"])("card section %s", async (state) => {
    const el = await mountThemed(
      `<wt-disclosure card ruled heading="Selling" summary="Available" ${state}><p>Anyone can order</p></wt-disclosure>`,
      theme,
    );
    // Without this the scan could pass on a section that drew no card.
    expect(getComputedStyle(el.shadowRoot!.querySelector(".section")!).borderTopWidth).toBe("1px");
    await expectNoA11yViolations(host);
  });

  test("collapsed, with a two-row summary holding a warning", async () => {
    const el = (await mountThemed(
      '<wt-disclosure heading="Details"><p>body</p></wt-disclosure>',
      theme,
    )) as WtDisclosure;
    el.summaryRows = [
      {
        fields: [
          { label: "Prep station", value: "Bar" },
          { label: "Allergens", value: "Not yet reviewed", warning: true },
        ],
        lines: 2,
      },
      { fields: [{ label: "VAT", value: "Reduced (10%)", placeholder: true }], lines: 2 },
    ];
    await el.updateComplete;
    // Without this the scan could pass on a header that drew no rows or no warning.
    expect(el.shadowRoot!.querySelectorAll(".summary-row")).toHaveLength(2);
    expect(el.shadowRoot!.querySelectorAll(".summary-row .summary-warning")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  test("with a help-mode badge, help off", async () => {
    await mountThemed(
      '<wt-disclosure heading="Selling" summary="Available"><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Selling">Who can order it.</wt-help-tooltip><p>Anyone can order</p></wt-disclosure>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("with a help-mode badge, help on", async () => {
    await mountThemed(
      '<wt-disclosure heading="Selling" summary="Available"><wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Selling">Who can order it.</wt-help-tooltip><p>Anyone can order</p></wt-disclosure>',
      theme,
    );
    const badge = host.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-help-tooltip",
    )!;
    setHelpMode(true);
    await badge.updateComplete;
    expect(badge.checkVisibility()).toBe(true);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
