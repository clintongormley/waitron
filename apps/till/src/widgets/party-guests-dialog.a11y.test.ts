import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./party-guests-dialog.js";
import type { TillPartyGuestsDialog } from "./party-guests-dialog.js";

afterEach(cleanupWidgets);

const saveButton = (el: TillPartyGuestsDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-guests-save]")!;

async function fill(el: TillPartyGuestsDialog, value: string): Promise<void> {
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("till-party-guests-dialog a11y (%s theme)", (theme) => {
  it("has no violations when it opens, with Save quiet and disabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillPartyGuestsDialog>(
      "till-party-guests-dialog",
      { tables: "Mesa 4, 5", value: "2", savedValue: "2" },
      theme,
    );
    await saveButton(el).updateComplete;
    expect(saveButton(el).variant).toBe("secondary");
    expect(saveButton(el).disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("has no violations once the count changes, with Save primary and enabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillPartyGuestsDialog>(
      "till-party-guests-dialog",
      { tables: "Mesa 4, 5", value: "2", savedValue: "2" },
      theme,
    );
    await fill(el, "4");
    expect(saveButton(el).variant).toBe("primary");
    expect(saveButton(el).disabled).toBe(false);
    await expectNoA11yViolations(host);
  });

  it("has no violations with an invalid count refused beside the field", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillPartyGuestsDialog>(
      "till-party-guests-dialog",
      { tables: "Mesa 4, 5", value: "2", savedValue: "2" },
      theme,
    );
    await fill(el, "0");
    saveButton(el).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-input")!.error).toBe(t("seat.guest_count_invalid"));
    await expectNoA11yViolations(host);
  });

  it("has no violations with a server refusal shown beside the field", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillPartyGuestsDialog>(
      "till-party-guests-dialog",
      { tables: "Mesa 4, 5", value: "4", savedValue: "2", refusal: t("seat.guest_count_invalid") },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
