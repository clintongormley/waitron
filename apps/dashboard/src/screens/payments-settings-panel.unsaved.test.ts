import { html, LitElement } from "lit";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./payments-screen.js";

class PaymentsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;

  override render() {
    return html`<dashboard-payments-settings .api=${this.api}></dashboard-payments-settings>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("payments-settings-leave-test", PaymentsLeaveApp);
afterEach(cleanupWidgets);

it("keeps an unsaved switch when the manager chooses to stay on the page", async () => {
  const { el } = await mountWidget<PaymentsLeaveApp>("payments-settings-leave-test", {
    api: {
      getPaymentSettings: async () => ({
        tipsEnabled: false,
        testProviders: false,
        testProvidersAvailable: true,
        revision: 0,
      }),
    } as DashboardApi,
  });
  const tips = page.getByRole("switch", { name: "Offer tips at the till" });
  await tips.click();
  const leaving = el.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  const dialog = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => dialog.open).toBe(true);
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  expect(await leaving).toBe("kept");
  await expect.element(tips).toBeChecked();
});
