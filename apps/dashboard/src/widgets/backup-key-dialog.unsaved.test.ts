import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { encodeMasterKeyCode } from "@waitron/shared";
import { LeaveController, type WtDialog } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import type { RecoveryPackStatus } from "../api/backup-api.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import type { BackupKeyDialog } from "./backup-key-dialog.js";
import "./backup-key-dialog.js";

class BackupKeyLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-backup-key-dialog .api=${this.api}></dashboard-backup-key-dialog>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("backup-key-leave-test-app", BackupKeyLeaveApp);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});

const STATUS: RecoveryPackStatus = {
  latest: null,
  upToDate: false,
  incomplete: false,
  unreceived: null,
  reasons: [],
  keep: [],
  backupsUseOlderKey: false,
  masterKey: { name: "2026-11-23 · QZJV", pack: 1 },
  keepOldPackUntil: "2026-12-23T12:00:00.000Z",
  timeZone: "Europe/Madrid",
  backupKey: { number: 3, fingerprint: "4f9a21c0", changedAt: null, fromCurrentMasterKey: true },
};

const KEY = encodeMasterKeyCode(new Uint8Array(16).fill(7));

async function fixture() {
  setLocale("en-GB");
  const rotateBackupKey = vi.fn().mockResolvedValue({ enabled: true });
  const api = {
    rotateBackupKey,
    getRecoveryPackStatus: vi.fn().mockResolvedValue(STATUS),
    liveData: new LiveData(),
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<BackupKeyLeaveApp>("backup-key-leave-test-app", { api });
  const host = app.shadowRoot!.querySelector<BackupKeyDialog>("dashboard-backup-key-dialog")!;
  host.show(STATUS);
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  const press = (test: string) =>
    host.shadowRoot!.querySelector<HTMLElement>(`wt-button[data-test=${test}]`)!;
  return { app, host, dialog, press, rotateBackupKey };
}

async function type(host: BackupKeyDialog, text: string) {
  const field = host.shadowRoot!.querySelector<LitElement>("wt-master-key-input")!;
  const input = field.shadowRoot!.querySelector<LitElement>("wt-input")!;
  await input.updateComplete;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await field.updateComplete;
  await host.updateComplete;
}

async function question(app: BackupKeyLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}

async function choose(app: BackupKeyLeaveApp, choice: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await q.updateComplete;
}

it("an untouched dialog closes on Escape without asking", async () => {
  const { app, dialog, press } = await fixture();
  press("cancel-backup-key").focus();
  const closed = dialogClosed(dialog);
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("Cancel is the person's own choice: it closes and forgets a typed key without asking", async () => {
  const f = await fixture();
  await type(f.host, KEY);
  await expect.poll(() => f.app.leave.coordinator.isDirty()).toBe(true);
  const closed = dialogClosed(f.dialog);
  f.press("cancel-backup-key").click();
  await closed;
  expect((await question(f.app)).open).toBe(false);
  expect(f.app.leave.coordinator.isDirty()).toBe(false);
  expect(f.rotateBackupKey).not.toHaveBeenCalled();
});

it("a typed master key asks before Escape, and Keep editing keeps it", async () => {
  const f = await fixture();
  await type(f.host, KEY);
  await expect.poll(() => f.app.leave.coordinator.isDirty()).toBe(true);
  f.press("cancel-backup-key").focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(f.app)).open).toBe(true);
  await choose(f.app, "keep");
  expect(f.dialog.open).toBe(true);
  expect(f.press("change-backup-key").hasAttribute("disabled")).toBe(false);
  expect(f.rotateBackupKey).not.toHaveBeenCalled();
});

it("a typed master key asks before Escape, and Discard closes and forgets it", async () => {
  const f = await fixture();
  await type(f.host, KEY.slice(0, 6));
  await expect.poll(() => f.app.leave.coordinator.isDirty()).toBe(true);
  f.press("cancel-backup-key").focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(f.app)).open).toBe(true);
  expect(f.dialog.open).toBe(true);
  const closed = dialogClosed(f.dialog);
  await choose(f.app, "discard");
  await closed;
  expect(f.dialog.open).toBe(false);
  expect(f.app.leave.coordinator.isDirty()).toBe(false);
  f.host.show(STATUS);
  await f.host.updateComplete;
  await expect.poll(() => f.dialog.open).toBe(true);
  expect(f.press("change-backup-key").hasAttribute("disabled")).toBe(true);
});

it("a changed key leaves nothing unsaved: Close does not ask", async () => {
  const f = await fixture();
  await type(f.host, KEY);
  f.press("change-backup-key").click();
  await expect.poll(() => f.host.shadowRoot!.querySelector("[data-test=done]")).not.toBeNull();
  expect(f.app.leave.coordinator.isDirty()).toBe(false);
  const closed = dialogClosed(f.dialog);
  f.press("close-backup-key").click();
  await closed;
  expect((await question(f.app)).open).toBe(false);
});
