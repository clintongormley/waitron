import { LitElement, html, nothing } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController, type WtDialog } from "@waitron/ui";
import type { PartyAllergyRead } from "@waitron/module";
import { mountWidget, cleanupWidgets } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { type AllergyConfirmDetail } from "./party-allergy-dialog.js";

const initial: PartyAllergyRead = {
  partyId: "p",
  snapshot: {
    answer: "allergies",
    revision: 3,
    guests: [{ id: "g", position: 0, who: "Original", allergens: { milk: {} }, note: null }],
    ticks: [],
    changedBy: null,
    changedAt: null,
  },
  dishes: [],
};
class AllergyLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly screen = {};
  shown = true;
  results: AllergyConfirmDetail[] = [];
  override render() {
    return html`${this.shown ? html`<till-party-allergy-dialog .view=${initial} mode="edit" scopeKey="party-opening" .draftParent=${this.screen} @allergy-confirm=${(e: CustomEvent<AllergyConfirmDetail>) => this.results.push(e.detail)}></till-party-allergy-dialog>` : nothing}${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("allergy-leave-test-app", AllergyLeaveApp);
const original = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(original);
});
async function mount() {
  const { el: app } = await mountWidget<AllergyLeaveApp>("allergy-leave-test-app", {});
  const el = app.shadowRoot!.querySelector("till-party-allergy-dialog")!;
  await el.updateComplete;
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLElement>('[data-edit="0"]')!),
  );
  await el.updateComplete;
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Changed guest",
  );
  await el.updateComplete;
  return { app, el };
}
async function choice(app: AllergyLeaveApp, answer: "keep" | "discard") {
  await app.updateComplete;
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(warning.open).toBe(true));
  await warning.updateComplete;
  await userEvent.click(
    page.elementLocator(
      warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice="${answer}"]`)!,
    ),
  );
}
it.each(["cancel", "escape"])(
  "protects staged allergy edits on %s, then Discard closes",
  async (reason) => {
    const { app, el } = await mount();
    const cancel = vi.fn();
    el.addEventListener("allergy-cancel", cancel);
    if (reason === "escape") await userEvent.keyboard("{Escape}");
    else
      await userEvent.click(
        page.elementLocator(el.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!),
      );
    await choice(app, "keep");
    expect(el.shadowRoot!.querySelector("wt-input")!.value).toBe("Changed guest");
    expect(cancel).not.toHaveBeenCalled();
    const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
    const closed = new Promise<void>((resolve) =>
      dialog.addEventListener("wt-close", () => resolve(), { once: true }),
    );
    await userEvent.click(
      page.elementLocator(el.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!),
    );
    await choice(app, "discard");
    await closed;
    await el.updateComplete;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(app.results).toEqual([]);
    expect(initial.snapshot.guests[0]!.who).toBe("Original");
  },
);
it("enclosing navigation sees the child draft and Keep preserves it", async () => {
  const { app, el } = await mount();
  const proceeded = vi.fn();
  const result = app.leave.coordinator.request({
    scopes: [app.screen],
    reason: "navigation",
    proceed: proceeded,
  });
  await choice(app, "keep");
  expect(await result).toBe("kept");
  expect(proceeded).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("wt-input")!.value).toBe("Changed guest");
});
it("a refused write stays dirty; confirmation commits before refresh and leaves quietly", async () => {
  const { app, el } = await mount();
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!),
  );
  expect(app.results).toHaveLength(1);
  expect(app.leave.coordinator.isDirty([app.screen])).toBe(true);
  el.refusal = "Try again";
  await el.updateComplete;
  expect(app.leave.coordinator.isDirty([app.screen])).toBe(true);
  el.commitConfirmed("party-opening");
  await el.updateComplete;
  expect(app.leave.coordinator.isDirty([app.screen])).toBe(false);
  const proceeded = vi.fn();
  expect(
    await app.leave.coordinator.request({
      scopes: [app.screen],
      reason: "navigation",
      proceed: proceeded,
    }),
  ).toBe("proceeded");
  expect(proceeded).toHaveBeenCalledTimes(1);
});
it("late success cannot commit edits made after submission", async () => {
  const { app, el } = await mount();
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!),
  );
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Later guest",
  );
  el.commitConfirmed("party-opening");
  await el.updateComplete;
  expect(app.leave.coordinator.isDirty([app.screen])).toBe(true);
  expect(field.value).toBe("Later guest");
});
it("forced logout invalidates a pending question and a disconnected form cannot submit", async () => {
  const { app, el } = await mount();
  const proceeded = vi.fn();
  const result = app.leave.coordinator.request({
    scopes: [app.screen],
    reason: "navigation",
    proceed: proceeded,
  });
  await vi.waitFor(() =>
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true),
  );
  const stale = el.shadowRoot!.querySelector<HTMLElement>("[data-primary]")!;
  app.leave.forceReset();
  app.shown = false;
  app.requestUpdate();
  await app.updateComplete;
  expect(await result).toBe("stale");
  stale.click();
  el.commitConfirmed("party-opening");
  expect(app.results).toEqual([]);
  expect(proceeded).not.toHaveBeenCalled();
});
