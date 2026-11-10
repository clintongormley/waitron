import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtButton, type WtReportDialog, type WtTextarea } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale, t } from "./i18n/t.js";
import "./problem-report.js";

class ReportLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<dashboard-problem-report></dashboard-problem-report>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("report-leave-test-app", ReportLeaveApp);

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

async function fixture() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<ReportLeaveApp>("report-leave-test-app", {});
  const report = app.shadowRoot!.querySelector("dashboard-problem-report")!;
  return { app, report, ...(await open(report)) };
}
async function open(report: HTMLElementTagNameMap["dashboard-problem-report"]) {
  const trigger = report.shadowRoot!.querySelector<WtButton>("[data-report-problem]")!;
  await trigger.updateComplete;
  await userEvent.click(trigger.shadowRoot!.querySelector("button")!);
  await report.updateComplete;
  const dialog = report.shadowRoot!.querySelector<WtReportDialog>("wt-report-dialog")!;
  await dialog.updateComplete;
  const field = dialog.shadowRoot!.querySelector<WtTextarea>("wt-textarea")!;
  await field.updateComplete;
  return { dialog, input: field.shadowRoot!.querySelector("textarea")! };
}
async function edit(dialog: WtReportDialog, input: HTMLTextAreaElement, value: string) {
  await userEvent.fill(input, value);
  await expect.poll(() => dialog.description).toBe(value);
}
function cancel(dialog: WtReportDialog) {
  return userEvent.click(dialog.shadowRoot!.querySelector<WtButton>('[slot="cancel"]')!);
}
function closed(dialog: WtReportDialog) {
  return new Promise<void>((resolve) =>
    dialog.addEventListener("wt-close", () => resolve(), { once: true }),
  );
}
function question(app: ReportLeaveApp) {
  return app.shadowRoot!.querySelector("wt-unsaved-changes")!;
}
async function choose(app: ReportLeaveApp, choice: "keep" | "discard") {
  const warning = question(app);
  await warning.updateComplete;
  await userEvent.click(warning.shadowRoot!.querySelector<WtButton>(`[data-choice=${choice}]`)!);
}
function underlyingDraft(app: ReportLeaveApp) {
  let value = "Saved title";
  const scope = app.leave.coordinator.register({
    id: {},
    current: () => value,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => {
      value = v;
    },
  });
  scope.commit(value);
  value = "Unfinished menu title";
  scope.changed();
  return { scope, value: () => value };
}

it("Keep retains the report, while Discard closes only its draft and preserves another edit", async () => {
  const { app, dialog, input } = await fixture();
  const underlying = underlyingDraft(app);
  await edit(dialog, input, "The bill is hard to read.");
  await cancel(dialog);
  await expect.poll(() => question(app).open).toBe(true);
  await choose(app, "keep");
  await expect.poll(() => question(app).open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(input.value).toBe("The bill is hard to read.");
  await cancel(dialog);
  await expect.poll(() => question(app).open).toBe(true);
  const didClose = closed(dialog);
  await choose(app, "discard");
  await didClose;
  expect(dialog.open).toBe(false);
  expect(underlying.scope.isDirty()).toBe(true);
  expect(underlying.value()).toBe("Unfinished menu title");
});

it.each([false, true])(
  "Cancel closes without asking when a description is clean (reverted=%s)",
  async (reverted) => {
    const { app, dialog, input } = await fixture();
    if (reverted) {
      await edit(dialog, input, "Temporary description");
      await edit(dialog, input, "");
    }
    const didClose = closed(dialog);
    await cancel(dialog);
    await didClose;
    expect(dialog.open).toBe(false);
    expect(question(app).open).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  },
);

it("Download closes only the report and reopening captures a fresh report", async () => {
  const { app, report, dialog, input } = await fixture();
  const underlying = underlyingDraft(app);
  const original = dialog.preview;
  await edit(dialog, input, "The bill is hard to read.");
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await userEvent.click(dialog.shadowRoot!.querySelector<WtButton>("[data-download]")!);
  await report.updateComplete;
  expect(dialog.open).toBe(false);
  expect(question(app).open).toBe(false);
  expect(underlying.scope.isDirty()).toBe(true);
  expect(underlying.value()).toBe("Unfinished menu title");
  const reopened = await open(report);
  expect(reopened.input.value).toBe("");
  expect(reopened.dialog.preview).not.toBe(original);
});

it("disconnect releases an edited report and reconnect starts without the old description", async () => {
  const { app, report, dialog, input } = await fixture();
  await edit(dialog, input, "The bill is hard to read.");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  report.remove();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  app.shadowRoot!.append(report);
  await report.updateComplete;
  const reopened = await open(report);
  expect(reopened.input.value).toBe("");
  expect(reopened.dialog.preview).not.toContain("The bill is hard to read.");
});
