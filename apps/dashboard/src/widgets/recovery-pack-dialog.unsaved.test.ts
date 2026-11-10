import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtDialog } from "@waitron/ui";
import type { DashboardApi, RecoveryPackStatus } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import type { RecoveryPackDialog } from "./recovery-pack-dialog.js";
import "./recovery-pack-dialog.js";

class RecoveryPackLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-recovery-pack-dialog .api=${this.api}></dashboard-recovery-pack-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("recovery-pack-leave-test-app", RecoveryPackLeaveApp);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const STATUS: RecoveryPackStatus = {
  latest: null,
  upToDate: false,
  incomplete: false,
  unreceived: null,
  reasons: [],
  keep: [],
  backupsUseOlderKey: false,
  timeZone: "Europe/Madrid",
};

async function fixture() {
  setLocale("en-GB");
  const makeRecoveryPack = vi.fn();
  const api = {
    makeRecoveryPack,
    markRecoveryPackReceived: vi.fn(),
    getRecoveryPackStatus: vi.fn(),
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<RecoveryPackLeaveApp>("recovery-pack-leave-test-app", {
    api,
  });
  const host = app.shadowRoot!.querySelector<RecoveryPackDialog>("dashboard-recovery-pack-dialog")!;
  host.show(STATUS);
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  const choice = host.shadowRoot!.querySelector<HTMLInputElement>("input[name=new-server-key]")!;
  return { app, host, dialog, choice, makeRecoveryPack };
}

async function question(app: RecoveryPackLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

async function choose(app: RecoveryPackLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await q.updateComplete;
}

it("an untouched dialog closes on Escape without asking", async () => {
  const { app, dialog, choice } = await fixture();
  choice.focus();
  const closed = dialogClosed(dialog);
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("a ticked box alone asks before Escape", async () => {
  const { app, host, dialog } = await fixture();
  host.shadowRoot!.querySelector<HTMLInputElement>("input[name=new-server-key]")!.click();
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  const closed = dialogClosed(dialog);
  await choose(app, "discard");
  await closed;
  expect(dialog.open).toBe(false);
});

it("the dialog being dismissed releases its draft", async () => {
  const { app, host, dialog, choice } = await fixture();
  choice.focus();
  choice.click();
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  host.dismiss();
  await host.updateComplete;
  await expect.poll(() => dialog.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
});

it("a new-key choice makes the browser ask before the page is left, and closing stops it", async () => {
  const { dialog, choice } = await fixture();
  const leaving = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(leaving()).toBe(false);
  choice.focus();
  choice.click();
  await expect.poll(leaving).toBe(true);
  dialog.closeAfter("security");
  await expect.poll(leaving).toBe(false);
});
