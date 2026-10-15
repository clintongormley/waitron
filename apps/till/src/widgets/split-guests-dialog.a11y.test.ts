import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./split-guests-dialog.js";
import type { TillSplitGuestsDialog } from "./split-guests-dialog.js";

afterEach(cleanupWidgets);

const confirmButton = (el: TillSplitGuestsDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-split-guests-confirm]")!;
const leavingField = (el: TillSplitGuestsDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=leavingGuests]")!;

const props = { stayingLabel: "Mesa 5", leavingLabel: "Mesa 4", staying: "5" };

describe.each(["light", "dark"] as const)("till-split-guests-dialog a11y (%s theme)", (theme) => {
  it("has no violations when it opens, with Split primary and enabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillSplitGuestsDialog>(
      "till-split-guests-dialog",
      props,
      theme,
    );
    await confirmButton(el).updateComplete;
    expect(confirmButton(el).variant).toBe("primary");
    expect(confirmButton(el).disabled).toBe(false);
    await expectNoA11yViolations(host);
  });

  it("has no violations with an invalid count refused beside its field", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillSplitGuestsDialog>(
      "till-split-guests-dialog",
      props,
      theme,
    );
    await userEvent.fill(
      page.elementLocator(leavingField(el).shadowRoot!.querySelector("input")!),
      "0",
    );
    await el.updateComplete;
    confirmButton(el).click();
    await el.updateComplete;
    expect(leavingField(el).error).toBe(t("seat.guest_count_invalid"));
    expect(confirmButton(el).disabled).toBe(true);
    await expectNoA11yViolations(host);
  });
});
