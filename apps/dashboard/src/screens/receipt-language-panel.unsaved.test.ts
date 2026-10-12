import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { mount, field, pick, unload } from "../testing/receipt-language-fixture.js";
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it.each(["keep", "discard"] as const)(
  "protects its choice with %s on navigation",
  async (decision) => {
    const { app, panel } = await mount();
    await pick(panel, "ca-ES");
    let left = false;
    const pending = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {
        left = true;
      },
    });
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await question.updateComplete;
    await userEvent.click(
      page.elementLocator(question.shadowRoot!.querySelector(`[data-choice=${decision}]`)!),
    );
    expect(await pending).toBe(decision === "keep" ? "kept" : "proceeded");
    expect(left).toBe(decision === "discard");
    await panel.updateComplete;
    expect(field(panel).value).toBe(decision === "keep" ? "ca-ES" : "es-ES");
    expect(unload()).toBe(decision === "keep");
  },
);

it("releases draft protection when the language card is removed", async () => {
  const { panel } = await mount();
  await pick(panel, "ca-ES");
  expect(unload()).toBe(true);
  panel.remove();
  expect(unload()).toBe(false);
});
