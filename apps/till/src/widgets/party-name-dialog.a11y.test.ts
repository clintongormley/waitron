import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./party-name-dialog.js";
import type { TillPartyNameDialog } from "./party-name-dialog.js";

afterEach(cleanupWidgets);

const saveButton = (el: TillPartyNameDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-name-save]")!;

describe.each(["light", "dark"] as const)("till-party-name-dialog a11y (%s theme)", (theme) => {
  it("has no violations when it opens, with Save quiet and disabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillPartyNameDialog>(
      "till-party-name-dialog",
      { tables: "Mesa 4, 5", value: "Ana", savedValue: "Ana" },
      theme,
    );
    await saveButton(el).updateComplete;
    expect(saveButton(el).variant).toBe("secondary");
    expect(saveButton(el).disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("has no violations once the name changes, with Save primary and enabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillPartyNameDialog>(
      "till-party-name-dialog",
      { tables: "Mesa 4, 5", value: "Ana", savedValue: "Ana" },
      theme,
    );
    const field = el.shadowRoot!.querySelector("wt-input")!;
    await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "Ana B");
    await el.updateComplete;
    expect(saveButton(el).variant).toBe("primary");
    expect(saveButton(el).disabled).toBe(false);
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refusal shown beside the field", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillPartyNameDialog>(
      "till-party-name-dialog",
      { tables: "Mesa 4, 5", value: "Ana", refusal: t("table.name_too_long") },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
