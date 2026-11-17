import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtDialog, type WtInput } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./box-wifi-dialog.js";
class WifiLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api = { scanBoxNetwork: vi.fn().mockResolvedValue({ networks: [] }) } as unknown as DashboardApi;
  override render() {
    return html`<dashboard-box-wifi-dialog .api=${this.api}></dashboard-box-wifi-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("wifi-leave-test-app", WifiLeaveApp);
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en");
});
it("keeps a staged password on Keep and erases it on Discard, then leaves cleanly", async () => {
  setLocale("en");
  vi.spyOn(document, "URL", "get").mockReturnValue("https://box.example/box-status");
  const { el: app } = await mountWidget<WifiLeaveApp>("wifi-leave-test-app", {});
  const wifi = app.shadowRoot!.querySelector("dashboard-box-wifi-dialog")!;
  wifi.show(false);
  await wifi.updateComplete;
  const dialog = wifi.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  const input = dialog.querySelector<WtInput>("wt-input")!;
  await input.updateComplete;
  await userEvent.fill(input.shadowRoot!.querySelector("input")!, "secret password");
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  const closing = dialog.requestClose("escape");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await userEvent.click(question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
  await closing;
  expect(dialog.open).toBe(true);
  expect(input.value).toBe("secret password");
  const closed = dialogClosed(dialog);
  void dialog.requestClose("escape");
  await expect.poll(() => question.open).toBe(true);
  await userEvent.click(question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
  await closed;
  expect(input.value).toBe("");
  expect(app.leave.coordinator.isDirty()).toBe(false);
  wifi.show(false);
  await wifi.updateComplete;
  const gone = dialogClosed(dialog);
  void dialog.requestClose("escape");
  await gone;
  expect(question.open).toBe(false);
});
