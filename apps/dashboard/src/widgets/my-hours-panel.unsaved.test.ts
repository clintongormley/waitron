import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { OwnAttendanceCommand } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget, dialogClosed } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { hoursView } from "../../test/hours-fixtures.js";
import "./my-hours-panel.js";
class HoursLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  request!: DashboardRequest;
  override render() {
    return html`<dashboard-my-hours-panel
        .request=${this.request}
        personId="p1"
        active
      ></dashboard-my-hours-panel
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("hours-leave-test-app", HoursLeaveApp);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
async function mount(failedRefresh = false) {
  setLocale("en-GB");
  let written = false;
  const request: DashboardRequest = async <T>(url: string, method = "GET", body?: unknown) => {
    if (method === "POST") {
      written = true;
      return {
        commandId: (body as OwnAttendanceCommand).commandId,
        entryIds: ["requested"],
        replayed: false,
      } as T;
    }
    if (written && failedRefresh) throw { code: "connection.lost" };
    const view = hoursView({ selection: { kind: "week" } });
    return (
      url.endsWith("/inbox")
        ? {
            personId: "p1",
            revision: "r",
            locations: [{ id: "venue", name: "Deli", timeZone: "Europe/Madrid" }],
            prompts: [],
            items: [],
          }
        : url.includes("/day?")
          ? {
              personId: "p1",
              locationId: "venue",
              date: "2026-01-05",
              timeZone: "Europe/Madrid",
              revision: "day-r",
              record: view.record,
              items: [],
            }
          : view
    ) as T;
  };
  const { el: app } = await mountWidget<HoursLeaveApp>("hours-leave-test-app", { request });
  const panel = app.shadowRoot!.querySelector("dashboard-my-hours-panel")!;
  await vi.waitFor(() =>
    expect(panel.shadowRoot!.querySelector("dashboard-hours-record")?.view).not.toBeNull(),
  );
  panel
    .shadowRoot!.querySelector("dashboard-hours-record")!
    .dispatchEvent(
      new CustomEvent("hours-day", {
        detail: { date: "2026-01-05", locationId: "venue" },
        bubbles: true,
        composed: true,
      }),
    );
  await vi.waitFor(() => expect(panel.shadowRoot!.querySelector("[data-retime]")).not.toBeNull());
  await userEvent.click(panel.shadowRoot!.querySelector("[data-retime]")!);
  const editor = panel.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!;
  await editor.updateComplete;
  const reason = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-textarea"]>(
    '[name="attendanceReason"]',
  )!;
  await reason.updateComplete;
  const native = reason.shadowRoot!.querySelector("textarea")!;
  await userEvent.fill(page.elementLocator(native), "Finished stock count");
  await editor.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  return { app, panel, editor, native };
}
async function choose(app: HoursLeaveApp, decision: "keep" | "discard") {
  await vi.waitFor(() =>
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true),
  );
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
  await app.updateComplete;
}
it("native Escape keeps the worker request draft, then discards it through the existing dialog guard", async () => {
  const { app, editor, native } = await mount();
  await userEvent.keyboard("{Escape}");
  await choose(app, "keep");
  expect(editor.open).toBe(true);
  expect(native.value).toBe("Finished stock count");
  const dialog = editor.shadowRoot!.querySelector("wt-dialog")!;
  const closed = dialogClosed(dialog);
  await userEvent.keyboard("{Escape}");
  await choose(app, "discard");
  await closed;
  await editor.updateComplete;
  expect(editor.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("closes a successfully saved dirty request before a refresh refusal and leaves no unsaved warning", async () => {
  const { app, panel, editor } = await mount(true);
  await userEvent.click(editor.shadowRoot!.querySelector("[data-save]")!);
  await vi.waitFor(() => expect(editor.open).toBe(false));
  await vi.waitFor(() =>
    expect(panel.shadowRoot!.querySelector("[data-read-error]")).not.toBeNull(),
  );
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(panel.shadowRoot!.querySelector("[data-action-error]")).toBeNull();
});
it("a locale switch retains the exact worker draft and its dirty scope", async () => {
  const { app, editor, native } = await mount();
  setLocale("es-ES");
  await editor.updateComplete;
  expect(editor.shadowRoot!.querySelector("wt-dialog")!.heading).toBe(
    "Solicitar un cambio de horas",
  );
  expect(native.value).toBe("Finished stock count");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
