import { LiveData } from "@waitron/dashboard-kit";
import { html, LitElement } from "lit";
import { afterEach, expect, it, vi } from "vitest";
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

let liveData = new LiveData();
let stored = {
  otherCardMachines: [{ id: "m1", name: "Bar terminal", paysInto: "other" }],
  revision: 0,
};
let getOtherCardMachines = vi.fn(async () => structuredClone(stored));
afterEach(() => {
  liveData = new LiveData();
  stored = {
    otherCardMachines: [{ id: "m1", name: "Bar terminal", paysInto: "other" }],
    revision: 0,
  };
  getOtherCardMachines = vi.fn(async () => structuredClone(stored));
});

async function leaveWith(choice: "keep" | "discard", whileEditing?: () => Promise<void>) {
  const { el } = await mountWidget<MachinesLeaveApp>("other-card-machines-leave-test", {
    api: {
      liveData,
      getOtherCardMachines,
    } as unknown as DashboardApi,
  });
  const name = page.getByRole("textbox", { name: "Name" });
  await expect.element(name).toHaveValue("Bar terminal");
  await name.fill("Bar");
  await whileEditing?.();
  const leaving = el.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  const dialog = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => dialog.open).toBe(true);
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  return { el, leaving, name };
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

it("shows the newest list when the manager discards after it changed during their edit", async () => {
  const { el, leaving } = await leaveWith("discard", async () => {
    stored = {
      otherCardMachines: [
        { id: "m1", name: "Bar terminal", paysInto: "other" },
        { id: "m2", name: "Patio", paysInto: "other" },
      ],
      revision: 1,
    };
    liveData.invalidate([{ type: "settings.payments" }]);
    await vi.waitFor(() => expect(getOtherCardMachines).toHaveBeenCalledTimes(2));
  });
  expect(await leaving).not.toBe("kept");
  const names = page.getByRole("textbox", { name: "Name" });
  await expect.element(names.nth(0)).toHaveValue("Bar terminal");
  await expect.element(names.nth(1)).toHaveValue("Patio");
  await expect.element(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(el.leave.coordinator.isDirty()).toBe(false);
});
