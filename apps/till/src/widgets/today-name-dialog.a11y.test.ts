import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./today-name-dialog.js";
import type { TillTodayNameDialog } from "./today-name-dialog.js";

afterEach(cleanupWidgets);

const saveButton = (el: TillTodayNameDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-rename-save]")!;
const props = { heading: "Renombrar Mesa 4", normalName: "Mesa 4", value: "Cumpleaños García" };

describe.each(["light", "dark"] as const)("till-today-name-dialog a11y (%s theme)", (theme) => {
  it("has no violations when it opens, with Save quiet and disabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillTodayNameDialog>(
      "till-today-name-dialog",
      props,
      theme,
    );
    await saveButton(el).updateComplete;
    expect(saveButton(el).variant).toBe("secondary");
    expect(saveButton(el).disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("has no violations once the name changes, with Save primary and enabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillTodayNameDialog>(
      "till-today-name-dialog",
      props,
      theme,
    );
    const field = el.shadowRoot!.querySelector("wt-input")!;
    await userEvent.fill(
      page.elementLocator(field.shadowRoot!.querySelector("input")!),
      "Mesa larga",
    );
    await el.updateComplete;
    expect(saveButton(el).variant).toBe("primary");
    expect(saveButton(el).disabled).toBe(false);
    await expectNoA11yViolations(host);
  });

  it("has no violations while busy", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillTodayNameDialog>(
      "till-today-name-dialog",
      { ...props, busy: true },
      theme,
    );
    await saveButton(el).updateComplete;
    expect(saveButton(el).disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refusal shown beside the field", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillTodayNameDialog>(
      "till-today-name-dialog",
      { ...props, refusal: { code: "table.label_taken", field: "name" } },
      theme,
    );
    expect(el.shadowRoot!.querySelector("wt-input")!.error).toBe("Otra mesa ya tiene ese nombre");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refusal shown in the form's line", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillTodayNameDialog>(
      "till-today-name-dialog",
      { ...props, refusal: { code: "table.taken_off" } },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
