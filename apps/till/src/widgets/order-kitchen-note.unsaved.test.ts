import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./order-kitchen-note.js";
import type { SaveKitchenNoteDetail } from "./order-kitchen-note.js";

class KitchenNoteLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  note = "Original";
  saved: SaveKitchenNoteDetail[] = [];
  override render() {
    return html`<till-order-kitchen-note
        scopeKey="party:a"
        .note=${this.note}
        @save-kitchen-note=${(event: CustomEvent<SaveKitchenNoteDetail>) => {
          this.saved.push(event.detail);
          this.note = event.detail.note ?? "";
          this.requestUpdate();
        }}
      ></till-order-kitchen-note
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("kitchen-note-leave-test-app", KitchenNoteLeaveApp);
const previous = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(previous);
});
async function mount() {
  const { el: app } = await mountWidget<KitchenNoteLeaveApp>("kitchen-note-leave-test-app", {});
  const note = app.shadowRoot!.querySelector("till-order-kitchen-note")!;
  await note.updateComplete;
  await userEvent.click(
    page.elementLocator(note.shadowRoot!.querySelector<HTMLElement>("[data-edit]")!),
  );
  await note.updateComplete;
  const field = note.shadowRoot!.querySelector("wt-textarea")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("textarea")!),
    "Draft instruction",
  );
  return { app, note };
}
async function question(app: KitchenNoteLeaveApp) {
  const dialog = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  return dialog;
}

it.each(["cancel", "escape"])(
  "protects an edited kitchen note on %s and Keep editing preserves text",
  async (action) => {
    const { app, note } = await mount();
    if (action === "escape") await userEvent.keyboard("{Escape}");
    else
      await userEvent.click(
        page.elementLocator(note.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!),
      );
    const warning = await question(app);
    expect(note.shadowRoot!.querySelector("wt-dialog")?.open).toBe(true);
    const keep = warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!;
    await userEvent.click(page.elementLocator(keep));
    await vi.waitFor(() => expect(warning.open).toBe(false));
    expect(note.shadowRoot!.querySelector("wt-textarea")!.value).toBe("Draft instruction");
    expect(app.saved).toEqual([]);
  },
);

it("Discard closes the editor and leaves the saved note unchanged", async () => {
  const { app, note } = await mount();
  await userEvent.click(
    page.elementLocator(note.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!),
  );
  const warning = await question(app);
  const discard = warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  await userEvent.click(page.elementLocator(discard));
  await vi.waitFor(() => expect(note.shadowRoot!.querySelector("wt-dialog")).toBeNull());
  expect(note.note).toBe("Original");
  expect(app.saved).toEqual([]);
});

it("a successful save commits the modal draft without an unsaved question", async () => {
  const { app, note } = await mount();
  await userEvent.click(
    page.elementLocator(note.shadowRoot!.querySelector<HTMLElement>("[data-save]")!),
  );
  await vi.waitFor(() => expect(note.shadowRoot!.querySelector("wt-dialog")).toBeNull());
  expect(app.saved).toEqual([
    { scopeKey: "party:a", revision: 0, visit: 0, note: "Draft instruction" },
  ]);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).not.toBe(true);
});
