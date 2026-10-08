import { afterEach, describe, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { OptionListForm } from "./option-list-form.js";
import type { OptionList } from "../api/client.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

/**
 * The form only exposes anything to the accessibility tree once it is OPEN, so every state below is
 * mounted with `open = true`. The three names read differently on purpose (CLAUDE.md §3). The `many`
 * state holds a withdrawn option so the Unavailable lozenge and the disabled default radio are
 * scanned too.
 */
const label = (id: string, name: string, customer: string, kitchen: string, available = true) => ({
  id,
  name,
  customerName: { en: customer, es: customer },
  kitchenName: kitchen,
  available,
});

const cooked: OptionList = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Cooked",
  customerName: { en: "How would you like it?", es: "¿En qué punto?" },
  kitchenName: "COOK",
  defaultLabelId: "22222222-2222-4222-8222-222222222222",
  active: true,
  labels: [
    label("11111111-1111-4111-8111-111111111111", "Rare", "Barely cooked", "R"),
    label("22222222-2222-4222-8222-222222222222", "Medium", "Pink in the middle", "M"),
  ],
};

const many: OptionList = {
  ...cooked,
  labels: [
    ...cooked.labels,
    label("44444444-4444-4444-8444-444444444444", "Well done", "Cooked through", "WD"),
    label("55555555-5555-4555-8555-555555555555", "Blue", "Barely warm", "BL", false),
  ],
};

const states = [
  "create",
  "edit",
  "invalid",
  "busy",
  "server-error",
  "many-labels",
  "names-open",
  "names-error",
  "option-editor",
] as const;

describe.each(["light", "dark"] as const)("option list form (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<OptionListForm>(
      "dashboard-option-list-form",
      {
        open: true,
        languages: { defaultLanguage: "en", languages: ["en", "es"] },
        value:
          state === "many-labels" || state === "option-editor"
            ? many
            : state === "create" || state === "invalid"
              ? null
              : cooked,
        busy: state === "busy",
        fieldErrors:
          state === "server-error"
            ? { name: "That name is already used.", "labels.0.name": "Give this option a name." }
            : state === "names-error"
              ? { customerName: "Too long for the menu." }
              : {},
      },
      theme,
    );
    if (state === "invalid") {
      el.shadowRoot!.querySelector('[name="kitchen-name"]')!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "CK" }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="name"]')!.error,
      ).not.toBe("");
    }
    if (state === "option-editor") {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-label-3"]')!.click();
      await el.updateComplete;
    }
    const names = el.shadowRoot!.querySelector<
      HTMLElement & { open: boolean; updateComplete: Promise<unknown> }
    >('[data-test="names-section"]')!;
    if (state === "names-open") names.open = true;
    await names.updateComplete;
    const editor = el.shadowRoot!.querySelector("dashboard-option-label-form")!;
    await editor.updateComplete;
    // Each named state is scanned in the shape it names.
    expect(names.open).toBe(state === "names-open" || state === "names-error");
    expect(editor.open).toBe(state === "option-editor");
    await expectNoA11yViolations(host);
  });
});
