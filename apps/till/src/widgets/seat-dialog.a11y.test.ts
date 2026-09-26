import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./seat-dialog.js";
import type { TillSeatDialog } from "./seat-dialog.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-seat-dialog a11y (%s theme)", (theme) => {
  it("has no violations when it opens", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillSeatDialog>(
      "till-seat-dialog",
      { tableLabel: "4" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refused guest count shown", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillSeatDialog>(
      "till-seat-dialog",
      { tableLabel: "4" },
      theme,
    );
    const input = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
