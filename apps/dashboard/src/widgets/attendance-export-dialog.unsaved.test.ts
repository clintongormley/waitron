import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtInput, type WtDialog, type WtUnsavedChanges } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import {
  cleanupWidgets,
  dialogClosed,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { AttendanceExportDialog } from "./attendance-export-dialog.js";
const modules = import.meta.glob<typeof import("./attendance-export-dialog.js")>(
  "./attendance-export-dialog.ts",
);
class ExportLeaveTest extends LitElement {
  readonly leave = new LeaveController(this);
  request = vi.fn(async (path: string) =>
    path.includes("export-options")
      ? { available: true, canExportAll: true }
      : new Blob(["record"]),
  ) as unknown as DashboardRequest;
  override render() {
    return html`<dashboard-attendance-export-dialog
        .request=${this.request}
        .open=${true}
        scopeKey="one:1"
        mode="own"
        locationId="place"
        .period=${{ start: "2026-01-01", end: "2026-02-01" }}
      ></dashboard-attendance-export-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("export-leave-test-app", ExportLeaveTest);
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});
async function fixture() {
  setLocale("en-GB");
  const load = modules["./attendance-export-dialog.ts"];
  expect(load).toBeTypeOf("function");
  await load!();
  const { el: app } = await mountWidget<ExportLeaveTest>("export-leave-test-app", {});
  const form = app.shadowRoot!.querySelector<AttendanceExportDialog>(
    "dashboard-attendance-export-dialog",
  )!;
  await form.updateComplete;
  const dialog = form.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await dialog.updateComplete;
  const input = form.shadowRoot!.querySelector<WtInput>("[name=exportFrom]")!;
  return { app, form, dialog, input };
}
async function edit(form: AttendanceExportDialog, value: string) {
  const input = form.shadowRoot!.querySelector<WtInput>("[name=exportFrom]")!;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await form.updateComplete;
}
async function warning(app: ExportLeaveTest) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector<WtUnsavedChanges>("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
it("tracks a detached baseline, including editing then restoring the original selection", async () => {
  const { app, form } = await fixture();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await edit(form, "2020-01-01");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  await edit(form, "2026-01-01");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it.each(["cancel", "escape"] as const)(
  "protects an edited %s, keeps the draft and discards only after the choice",
  async (reason) => {
    const { app, form, dialog, input } = await fixture();
    await edit(form, "2020-01-01");
    const close = () =>
      reason === "cancel"
        ? Promise.resolve(
            form.shadowRoot!.querySelector<HTMLElement>("[data-test=export-cancel]")!.click(),
          )
        : userEvent.keyboard("{Escape}");
    input.focus();
    await close();
    const q = await warning(app);
    await expect.poll(() => q.open).toBe(true);
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
    expect(dialog.open).toBe(true);
    expect(input.value).toBe("2020-01-01");
    await close();
    await expect.poll(() => q.open).toBe(true);
    const closed = dialogClosed(dialog);
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
    await closed;
    expect(form.open).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  },
);
it("keeps navigation and locale refresh from dropping the staged selection", async () => {
  const { app, form } = await fixture();
  await edit(form, "2020-01-01");
  let proceeded = false;
  const leaving = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      proceeded = true;
    },
  });
  const q = await warning(app);
  await expect.poll(() => q.open).toBe(true);
  setLocale("es-ES");
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector<WtInput>("[name=exportFrom]")!.value).toBe("2020-01-01");
  expect(form.shadowRoot!.querySelector<WtInput>("[name=exportFrom]")!.label).toBe("Desde");
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  expect(await leaving).toBe("kept");
  expect(proceeded).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
it("disconnect clears the old selection and any leave decision before a new opening", async () => {
  const { app, form } = await fixture();
  await edit(form, "2020-01-01");
  await reattachAfterDetachedUpdate(form);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(form.open).toBe(false);
  form.open = true;
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector<WtInput>("[name=exportFrom]")!.value).toBe("2026-01-01");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a valid download commits exactly the selection sent", async () => {
  const { app, form } = await fixture();
  await edit(form, "2020-01-01");
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=export-download]")!.click();
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(false);
  await edit(form, "2026-01-01");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
