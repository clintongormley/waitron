import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { change, click, mountManagerHours, openDay } from "../../test/manager-hours-fixtures.js";
class ManagerHoursLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("manager-hours-leave-app", ManagerHoursLeaveApp);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
async function mount() {
  setLocale("en-GB");
  const m = await mountManagerHours();
  const { el: app } = await mountWidget<ManagerHoursLeaveApp>("manager-hours-leave-app", {});
  app.append(m.host);
  await openDay(m.root);
  await click(m.root, "[data-retime]");
  const editor = m.root.querySelector("dashboard-attendance-proposal-dialog")!;
  await editor.updateComplete;
  const field = editor.shadowRoot!.querySelector("wt-textarea")!;
  await field.updateComplete;
  const native = field.shadowRoot!.querySelector("textarea")!;
  await userEvent.fill(page.elementLocator(native), "Finished the stock count");
  await editor.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  return { ...m, app, editor, native };
}
async function choose(app: ManagerHoursLeaveApp, decision: "keep" | "discard") {
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
  await app.updateComplete;
}
it("protects a manager Hours proposal on native Escape, page leave and selector changes", async () => {
  const m = await mount();
  await change(m.root, "attendancePerson", "retained");
  await change(m.root, "hoursPeriodDate", "2025-12-01");
  expect(m.editor.view?.personId).toBe("worker");
  expect(m.native.value).toBe("Finished the stock count");
  expect(m.reads.some((r) => r.path.includes("date=2025-12-01"))).toBe(false);
  await userEvent.keyboard("{Escape}");
  await choose(m.app, "keep");
  expect(m.editor.open).toBe(true);
  expect(m.native.value).toBe("Finished the stock count");
  let proceeded = false;
  const leaving = m.app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed: () => {
      proceeded = true;
    },
  });
  await choose(m.app, "keep");
  expect(await leaving).toBe("kept");
  expect(proceeded).toBe(false);
  const dialog = m.editor.shadowRoot!.querySelector("wt-dialog")!;
  const closed = dialogClosed(dialog);
  await userEvent.keyboard("{Escape}");
  await choose(m.app, "discard");
  await closed;
  await m.editor.updateComplete;
  expect(m.editor.open).toBe(false);
  expect(m.app.leave.coordinator.isDirty()).toBe(false);
});
it("commits a saved manager proposal before a failed Hours refresh, with no remaining leave warning", async () => {
  const m = await mount();
  m.fail();
  await click(m.editor.shadowRoot!, "[data-save]");
  await expect.poll(() => m.editor.open).toBe(false);
  await expect.poll(() => m.root.querySelector("[data-read-error]")).toBeTruthy();
  expect(m.root.querySelector("[data-action-error]")).toBeNull();
  expect(m.app.leave.coordinator.isDirty()).toBe(false);
});
it("retains the manager draft and baseline across a language change", async () => {
  const m = await mount();
  setLocale("es-ES");
  await m.editor.updateComplete;
  expect(m.native.value).toBe("Finished the stock count");
  expect(m.app.leave.coordinator.isDirty()).toBe(true);
  expect(m.editor.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
    "Proponer un cambio de horas",
  );
});
