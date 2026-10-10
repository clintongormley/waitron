import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { WtCombobox } from "@waitron/ui/src/components/wt-combobox.js";
import "./station-choice-dialog.js";
import type { TillStationChoiceDialog } from "./station-choice-dialog.js";

afterEach(cleanupWidgets);

const submitButton = (el: TillStationChoiceDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-submit]")!;

describe.each(["light", "dark"] as const)("station choice dialog a11y (%s)", (theme) => {
  it.each(["make-at", "move"] as const)(
    "has no violations in %s mode with a refusal",
    async (mode) => {
      setLocale("es");
      const { host } = await mountWidget<TillStationChoiceDialog>(
        "till-station-choice-dialog",
        {
          mode,
          dishName: "Paella",
          currentStationId: "grill",
          stations: [
            {
              id: "grill",
              name: "Parrilla",
              displayOrder: 0,
              isDefault: true,
              active: true,
              open: true,
              byHand: null,
              sendsTo: null,
              why: "default" as const,
            },
            {
              id: "bar",
              name: "Barra",
              displayOrder: 1,
              isDefault: false,
              active: true,
              open: false,
              byHand: null,
              sendsTo: null,
              why: "closed_by_hand" as const,
            },
          ],
          refusal: "ticket.not_sent",
        },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );

  it.each([
    ["unchanged, with Save quiet and disabled", false],
    ["changed, with Save primary and enabled", true],
  ] as const)("has no violations in make-at mode %s", async (_state, change) => {
    setLocale("es");
    const { el, host } = await mountWidget<TillStationChoiceDialog>(
      "till-station-choice-dialog",
      {
        mode: "make-at",
        dishName: "Paella",
        currentStationId: "grill",
        stations: [
          {
            id: "grill",
            name: "Parrilla",
            displayOrder: 0,
            isDefault: true,
            active: true,
            open: true,
            byHand: null,
            sendsTo: null,
            why: "default" as const,
          },
          {
            id: "bar",
            name: "Barra",
            displayOrder: 1,
            isDefault: false,
            active: true,
            open: false,
            byHand: null,
            sendsTo: null,
            why: "closed_by_hand" as const,
          },
        ],
      },
      theme,
    );
    if (change) {
      const select = el.shadowRoot!.querySelector<WtCombobox>('wt-combobox[name="station"]')!;
      select.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
      await select.updateComplete;
      select.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')[2]!.click();
      await el.updateComplete;
    }
    const submit = submitButton(el);
    await submit.updateComplete;
    expect([submit.variant, submit.disabled]).toEqual(
      change ? ["primary", false] : ["secondary", true],
    );
    await expectNoA11yViolations(host);
  });
});
