import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./daily-report-mail-form.js";

class DailyReportLeaveHost extends LitElement {
  api!: DashboardApi;
  readonly leave = new LeaveController(this);

  override render() {
    return html`<dashboard-daily-report-mail-form
        .api=${this.api}
      ></dashboard-daily-report-mail-form>
      ${this.leave.render({
        heading: "Unsaved changes",
        message: "Keep your changes?",
        keepLabel: "Keep editing",
        discardLabel: "Discard",
      })}`;
  }
}
customElements.define("daily-report-leave-host", DailyReportLeaveHost);
afterEach(cleanupWidgets);

it("keeps the page open for a changed report setting until the person discards it", async () => {
  const { el } = await mountWidget<DailyReportLeaveHost>("daily-report-leave-host", {
    api: {
      getDailyReportSettings: async () => ({
        enabled: false,
        recipientIds: [],
        revision: 0,
        recipients: [],
      }),
    } as unknown as DashboardApi,
  });
  const form = el.shadowRoot!.querySelector("dashboard-daily-report-mail-form")!;
  const toggle = () => form.shadowRoot!.querySelector("wt-switch")!;
  await vi.waitFor(() => expect(toggle()).not.toBeNull());
  toggle().shadowRoot!.querySelector("input")!.click();
  const proceed = vi.fn();
  const leaving = el.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(question.open).toBe(true));
  expect(proceed).not.toHaveBeenCalled();
  question.dispatchEvent(new CustomEvent("wt-unsaved-choice", { detail: { decision: "discard" } }));
  expect(await leaving).toBe("proceeded");
  expect(proceed).toHaveBeenCalledOnce();
  await form.updateComplete;
  expect(toggle().checked).toBe(false);
});
