import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillOrderKitchenNote } from "./order-kitchen-note.js";
import "./order-kitchen-note.js";
const previous = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(previous);
});
it.each(["light", "dark"] as const)(
  "keeps note, edited form and refusal accessible in %s",
  async (theme) => {
    setLocale("es");
    const { el, host } = await mountWidget<TillOrderKitchenNote>(
      "till-order-kitchen-note",
      { scopeKey: "party:a", note: "Todo junto" },
      theme,
    );
    await expectNoA11yViolations(host);
    await userEvent.click(
      page.elementLocator(el.shadowRoot!.querySelector<HTMLElement>("[data-edit]")!),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-textarea")!.name).toBe("kitchenNote");
    await expectNoA11yViolations(host);
    el.refusal = "No se ha podido guardar. Inténtalo de nuevo.";
    await el.updateComplete;
    await expectNoA11yViolations(host);
  },
);

it.each(["light", "dark"] as const)(
  "opens the standalone Waiting editor accessibly in %s",
  async (theme) => {
    const { el, host } = await mountWidget<TillOrderKitchenNote>(
      "till-order-kitchen-note",
      { scopeKey: "order:a", note: "Together", hideHeading: true },
      theme,
    );
    el.openEditor();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-edit]")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
    await expectNoA11yViolations(host);
  },
);
