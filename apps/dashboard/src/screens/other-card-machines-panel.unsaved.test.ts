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
let saveOtherCardMachines = vi.fn();
afterEach(() => {
  liveData = new LiveData();
  stored = {
    otherCardMachines: [{ id: "m1", name: "Bar terminal", paysInto: "other" }],
    revision: 0,
  };
  getOtherCardMachines = vi.fn(async () => structuredClone(stored));
  saveOtherCardMachines = vi.fn();
});

async function leaveWith(choice: "keep" | "discard", whileEditing?: () => Promise<void>) {
  const { el } = await mountWidget<MachinesLeaveApp>("other-card-machines-leave-test", {
    api: {
      liveData,
      getOtherCardMachines,
      saveOtherCardMachines,
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

it("does not bring back a discarded edit when the save sent before the discard is out of date", async () => {
  let refuse!: () => void;
  saveOtherCardMachines.mockImplementationOnce(
    () =>
      new Promise((_saved, refused) => {
        refuse = () => {
          stored = {
            otherCardMachines: [
              { id: "m1", name: "Bar terminal", paysInto: "other" },
              { id: "m2", name: "Patio", paysInto: "other" },
            ],
            revision: 1,
          };
          refused({ code: "settings.out_of_date", params: { revision: 1 } });
        };
      }),
  );
  const save = page.getByRole("button", { name: "Save", exact: true });
  const { el, leaving } = await leaveWith("discard", async () => {
    await save.click();
    await vi.waitFor(() => expect(saveOtherCardMachines).toHaveBeenCalledTimes(1));
  });
  expect(await leaving).not.toBe("kept");
  refuse();
  const names = page.getByRole("textbox", { name: "Name" });
  await expect.element(names.nth(1)).toHaveValue("Patio");
  await expect.element(names.nth(0)).toHaveValue("Bar terminal");
  await expect.element(save).toBeDisabled();
  expect(el.leave.coordinator.isDirty()).toBe(false);
});

async function discardDuringSave(refusal: { code: string; params?: object }) {
  let refuse!: () => void;
  saveOtherCardMachines.mockImplementationOnce(
    () =>
      new Promise((_saved, refused) => {
        refuse = () => refused(refusal);
      }),
  );
  const save = page.getByRole("button", { name: "Save", exact: true });
  const { leaving, name } = await leaveWith("discard", async () => {
    await save.click();
    await vi.waitFor(() => expect(saveOtherCardMachines).toHaveBeenCalledTimes(1));
  });
  expect(await leaving).not.toBe("kept");
  return { refuse, name, save };
}
const notConnected = () =>
  page.getByText("This browser could not connect to Waitron.", { exact: false });

it("shows nothing for a refusal of a save the manager discarded", async () => {
  const { refuse, name, save } = await discardDuringSave({ code: "connection.failed" });
  refuse();
  await expect.element(save).toBeDisabled();
  await new Promise(requestAnimationFrame);
  await expect.element(notConnected()).not.toBeInTheDocument();
  await expect.element(name).toHaveValue("Bar terminal");
  expect(getOtherCardMachines).toHaveBeenCalledTimes(1);
});

it("says so when the list cannot be read again after a discarded save went out of date", async () => {
  const { refuse, name } = await discardDuringSave({
    code: "settings.out_of_date",
    params: { revision: 1 },
  });
  getOtherCardMachines.mockRejectedValueOnce({ code: "connection.failed" });
  refuse();
  await expect.element(notConnected()).toBeVisible();
  await expect.element(name).toHaveValue("Bar terminal");
});
