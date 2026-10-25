import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  LeaveController,
  type WtDialog,
  type WtTextarea,
  type WtUnsavedChanges,
} from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import type { MisdatedNoteDialog } from "./misdated-note-dialog.js";

const modules = import.meta.glob<typeof import("./misdated-note-dialog.js")>(
  "./misdated-note-dialog.ts",
);

class NoteLeaveTest extends LitElement {
  readonly leave = new LeaveController(this);
  mode: "handle" | "note" = "handle";
  api = {
    markIncidentHandled: vi.fn(async () => {}),
    addIncidentNote: vi.fn(async () => {}),
  } as unknown as DashboardApi;
  override render() {
    return html`<dashboard-misdated-note-dialog
        .api=${this.api}
        .open=${true}
        mode=${this.mode}
        incidentId="7"
        summary="3 sales"
      ></dashboard-misdated-note-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("misdated-note-leave-test-app", NoteLeaveTest);

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

async function fixture(mode: "handle" | "note") {
  setLocale("en-GB");
  const load = modules["./misdated-note-dialog.ts"];
  expect(load).toBeTypeOf("function");
  await load!();
  const { el: app } = await mountWidget<NoteLeaveTest>("misdated-note-leave-test-app", { mode });
  const form = app.shadowRoot!.querySelector<MisdatedNoteDialog>("dashboard-misdated-note-dialog")!;
  await form.updateComplete;
  const dialog = form.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  const input = form.shadowRoot!.querySelector<WtTextarea>("wt-textarea[name=note]")!;
  return { app, form, dialog, input };
}

async function edit(form: MisdatedNoteDialog, value: string) {
  const input = form.shadowRoot!.querySelector<WtTextarea>("wt-textarea[name=note]")!;
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
}

async function warning(app: NoteLeaveTest) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

it("tracks the trimmed note against an empty one", async () => {
  const { app, form } = await fixture("note");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await edit(form, "  ");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await edit(form, "Done");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it.each([
  ["handle", "cancel"],
  ["handle", "escape"],
  ["note", "cancel"],
  ["note", "escape"],
] as const)(
  "%s mode: closing by %s with a typed note asks, Keep keeps it, Discard closes",
  async (mode, reason) => {
    const { app, form, dialog, input } = await fixture(mode);
    await edit(form, "Adviser said fine");
    const close = () =>
      reason === "cancel"
        ? Promise.resolve(
            form.shadowRoot!.querySelector<HTMLElement>("[data-test=note-cancel]")!.click(),
          )
        : userEvent.keyboard("{Escape}");
    input.focus();
    await close();
    const q = await warning(app);
    await expect.poll(() => q.open).toBe(true);
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
    expect(dialog.open).toBe(true);
    expect(input.value).toBe("Adviser said fine");
    await close();
    await expect.poll(() => q.open).toBe(true);
    const closed = dialogClosed(dialog);
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
    await closed;
    expect(form.open).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  },
);

it.each(["handle", "note"] as const)("%s mode: closing untouched asks nothing", async (mode) => {
  const { app, form, dialog } = await fixture(mode);
  const closed = dialogClosed(dialog);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=note-cancel]")!.click();
  await closed;
  const q = await warning(app);
  expect(q.open).toBe(false);
  expect(form.open).toBe(false);
});

it("a successful save commits, so closing afterwards asks nothing", async () => {
  const { app, form, dialog } = await fixture("handle");
  await edit(form, "Done");
  const closed = dialogClosed(dialog);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=note-submit]")!.click();
  await closed;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  const q = await warning(app);
  expect(q.open).toBe(false);
});

it("a typed note makes the browser warn before the page is left, and clearing it stops the warning", async () => {
  const { form } = await fixture("note");
  const leavePage = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(leavePage()).toBe(false);
  await edit(form, "Done");
  expect(leavePage()).toBe(true);
  await edit(form, "");
  expect(leavePage()).toBe(false);
});
