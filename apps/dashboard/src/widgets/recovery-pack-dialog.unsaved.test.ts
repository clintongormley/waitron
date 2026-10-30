import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type WtDialog } from "@waitron/ui";
import type { DashboardApi, OwnProfile, RecoveryPackStatus } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import type { FreshSignIn } from "./fresh-sign-in.js";
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

const PROFILE: OwnProfile = {
  displayName: "Marta",
  firstNames: "Marta",
  lastNames: "López",
  telephone: null,
  email: "marta@example.test",
  pendingEmail: null,
  locale: null,
  hasPassword: true,
  hasTotp: false,
  hasGoogle: false,
  passkeys: [],
};

const STATUS: RecoveryPackStatus = {
  latest: null,
  upToDate: false,
  incomplete: false,
  unreceived: null,
  reasons: [],
  keep: [],
  backupsUseOlderKey: false,
};

async function fixture() {
  setLocale("en-GB");
  const makeRecoveryPack = vi.fn();
  const api = {
    getProfile: vi.fn().mockResolvedValue(PROFILE),
    recoveryPackPasskeyOptions: vi.fn(),
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
  await expect
    .poll(() => host.shadowRoot!.querySelector<FreshSignIn>("dashboard-fresh-sign-in")?.ways)
    .not.toBeNull();
  const signIn = host.shadowRoot!.querySelector<FreshSignIn>("dashboard-fresh-sign-in")!;
  await signIn.updateComplete;
  const password = signIn.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=current-password]",
  )!;
  await password.updateComplete;
  return { app, host, dialog, signIn, password, makeRecoveryPack };
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
  const { app, dialog, password } = await fixture();
  password.shadowRoot!.querySelector("input")!.focus();
  const closed = dialogClosed(dialog);
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(dialog.open).toBe(false);
  expect((await question(app)).open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("a typed password asks before Escape, and Keep keeps it", async () => {
  const { app, dialog, signIn, password, makeRecoveryPack } = await fixture();
  password.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("hunter2");
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  await choose(app, "keep");
  await expect.poll(async () => (await question(app)).open).toBe(false);
  expect(dialog.open).toBe(true);
  expect(password.value).toBe("hunter2");
  expect(signIn.typed).toBe(true);
  expect(makeRecoveryPack).not.toHaveBeenCalled();
});

it("a typed password asks before Escape, and Discard closes and forgets it", async () => {
  const { app, dialog, signIn, password, makeRecoveryPack } = await fixture();
  password.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("hunter2");
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(app)).open).toBe(true);
  const closed = dialogClosed(dialog);
  await choose(app, "discard");
  await closed;
  expect(dialog.open).toBe(false);
  expect(signIn.typed).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(makeRecoveryPack).not.toHaveBeenCalled();
});

it("a ticked box alone asks before Cancel", async () => {
  const { app, host, dialog } = await fixture();
  host.shadowRoot!.querySelector<HTMLInputElement>("input[name=new-server-key]")!.click();
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  host.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=cancel-pack]")!.click();
  await expect.poll(async () => (await question(app)).open).toBe(true);
  expect(dialog.open).toBe(true);
  const closed = dialogClosed(dialog);
  await choose(app, "discard");
  await closed;
  expect(dialog.open).toBe(false);
});

it("the dialog being dismissed releases its draft", async () => {
  const { app, host, dialog, password } = await fixture();
  password.shadowRoot!.querySelector("input")!.focus();
  await userEvent.keyboard("hunter2");
  await expect.poll(() => app.leave.coordinator.isDirty()).toBe(true);
  host.dismiss();
  await host.updateComplete;
  await expect.poll(() => dialog.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(app)).open).toBe(false);
});
