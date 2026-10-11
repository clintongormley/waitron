import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./today-seats-dialog.js";
import type { TillTodaySeatsDialog } from "./today-seats-dialog.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("en"));

describe.each(["light", "dark"] as const)("till-today-seats-dialog a11y (%s theme)", (theme) => {
  it("has no violations opened with a suggestion", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillTodaySeatsDialog>(
      "till-today-seats-dialog",
      { heading: "Plazas para 4+5", seats: 8, action: "join" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refused number", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillTodaySeatsDialog>(
      "till-today-seats-dialog",
      { heading: "Plazas para 4+5", seats: 6, action: "save" },
      theme,
    );
    const input = el
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!
      .shadowRoot!.querySelector("input")!;
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-seats-action]")!.click();
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>("[name=seats]")!
        .error,
    ).not.toBe("");
    await expectNoA11yViolations(host);
  });
});
