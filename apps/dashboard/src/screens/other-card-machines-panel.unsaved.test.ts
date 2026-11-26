import { html, LitElement } from "lit";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./other-card-machines-panel.js";

class MachinesLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;

  override render() {
    return html`<dashboard-other-card-machines .api=${this.api}></dashboard-other-card-machines>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("other-card-machines-leave-test", MachinesLeaveApp);
afterEach(cleanupWidgets);

async function leaveWith(choice: "keep" | "discard") {
  const { el } = await mountWidget<MachinesLeaveApp>("other-card-machines-leave-test", {
    api: {
      getOtherCardMachines: async () => ({
        otherCardMachines: [{ id: "m1", name: "Bar terminal", paysInto: "other" }],
        revision: 0,
      }),
    } as unknown as DashboardApi,
  });
  const name = page.getByRole("textbox", { name: "Name" });
  await expect.element(name).toHaveValue("Bar terminal");
  await name.fill("Bar");
  const leaving = el.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  const dialog = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => dialog.open).toBe(true);
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  return { leaving, name };
}

it("keeps an unsaved name when the manager chooses to stay on the page", async () => {
  const { leaving, name } = await leaveWith("keep");
  expect(await leaving).toBe("kept");
  await expect.element(name).toHaveValue("Bar");
});

it("puts the stored name back when the manager discards the change", async () => {
  const { leaving, name } = await leaveWith("discard");
  expect(await leaving).not.toBe("kept");
  await expect.element(name).toHaveValue("Bar terminal");
});
