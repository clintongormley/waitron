import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./bill-name-dialog.js";
import type { TillBillNameDialog } from "./bill-name-dialog.js";

afterEach(cleanupWidgets);

const saveButton = (el: TillBillNameDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-name-save]")!;

describe.each(["light", "dark"] as const)("till-bill-name-dialog a11y (%s theme)", (theme) => {
  it("has no violations when it opens, with Save quiet and disabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillBillNameDialog>(
      "till-bill-name-dialog",
      { bill: "Ana · Cuenta 2", value: "Postres", savedValue: "Postres" },
      theme,
    );
    await saveButton(el).updateComplete;
    expect(saveButton(el).variant).toBe("secondary");
    expect(saveButton(el).disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("has no violations once the name changes, with Save primary and enabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillBillNameDialog>(
      "till-bill-name-dialog",
      { bill: "Ana · Cuenta 2", value: "Postres", savedValue: "Postres" },
      theme,
    );
    const field = el.shadowRoot!.querySelector("wt-input")!;
    await userEvent.fill(
      page.elementLocator(field.shadowRoot!.querySelector("input")!),
      "Postres 2",
    );
    await el.updateComplete;
    expect(saveButton(el).variant).toBe("primary");
    expect(saveButton(el).disabled).toBe(false);
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refusal shown beside the field", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillBillNameDialog>(
      "till-bill-name-dialog",
      { bill: "Ana · Cuenta 2", value: "Postres", refusal: t("table.name_too_long") },
      theme,
    );
    await expectNoA11yViolations(host);
  });
  it("has no violations with an empty field", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillBillNameDialog>(
      "till-bill-name-dialog",
      { bill: "Ana · Cuenta 2", value: "", savedValue: "" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with a name too long refused beside the field", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillBillNameDialog>(
      "till-bill-name-dialog",
      { bill: "Ana · Cuenta 2", value: "", savedValue: "" },
      theme,
    );
    const field = el.shadowRoot!.querySelector("wt-input")!;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = "x".repeat(41);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    saveButton(el).click();
    await el.updateComplete;
    expect(field.error).toBe(t("table.name_too_long"));
    await expectNoA11yViolations(host);
  });
});
