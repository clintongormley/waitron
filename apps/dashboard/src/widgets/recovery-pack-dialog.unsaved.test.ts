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
  masterKey: null,
  keepOldPackUntil: "2026-11-11T12:00:00.000Z",
  serverKey: "set",
  timeZone: "Europe/Madrid",
};

async function fixture(kind: "pack" | "master-key" = "master-key") {
  setLocale("en-GB");
  const makeRecoveryPack = vi.fn().mockResolvedValue({
    pdf: new Blob(["%PDF-1.7 pack"], { type: "application/pdf" }),
    number: 4,
    key: "replaced",
    madeAt: "2026-11-23T09:00:00.000Z",
    masterKey: { key: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5", name: "2026-11-23 · QZJV" },
  });
  const api = {
    makeRecoveryPack,
    markRecoveryPackReceived: vi.fn().mockResolvedValue(undefined),
    getRecoveryPackStatus: vi.fn(),
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<RecoveryPackLeaveApp>("recovery-pack-leave-test-app", {
    api,
  });
  const host = app.shadowRoot!.querySelector<RecoveryPackDialog>("dashboard-recovery-pack-dialog")!;
  host.show(STATUS, kind);
  await host.updateComplete;
  const dialog = host.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  const press = (test: string) =>
    (host.shadowRoot!.querySelector<HTMLElement>(`wt-button[data-test=${test}]`) ??
      host
        .shadowRoot!.querySelector("wt-master-key-box")
        ?.shadowRoot!.querySelector<HTMLElement>(`wt-button[data-test=${test}]`))!;
  return { app, host, dialog, press, makeRecoveryPack };
}

/** Makes the new master key and waits for the dialog to show it. */
async function showKey(f: Awaited<ReturnType<typeof fixture>>) {
  f.press("make-pack").click();
  await expect
    .poll(
      () =>
        f.host
          .shadowRoot!.querySelector("wt-master-key-box")
          ?.shadowRoot!.querySelector("[data-test=master-key]") ?? null,
    )
    .not.toBeNull();
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

it.each(["pack", "master-key"] as const)(
  "an untouched %s dialog closes on Escape without asking",
  async (kind) => {
    const { app, dialog, press } = await fixture(kind);
    press("make-pack").focus();
    const closed = dialogClosed(dialog);
    await userEvent.keyboard("{Escape}");
    await closed;
    expect(dialog.open).toBe(false);
    expect((await question(app)).open).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  },
);

it("a shown master key not yet downloaded or printed asks before Escape", async () => {
  const f = await fixture();
  await showKey(f);
  await expect.poll(() => f.app.leave.coordinator.isDirty()).toBe(true);
  f.press("copy").focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(f.app)).open).toBe(true);
  expect(f.dialog.open).toBe(true);
  const closed = dialogClosed(f.dialog);
  await choose(f.app, "discard");
  await closed;
  expect(f.dialog.open).toBe(false);
});

it("a shown master key that was only copied still asks before Escape: the pack also holds the new box key", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const f = await fixture();
  await showKey(f);
  f.press("copy").click();
  await expect
    .poll(
      () =>
        f.host
          .shadowRoot!.querySelector("wt-master-key-box")
          ?.shadowRoot!.querySelector("[data-test=copied]") ?? null,
    )
    .not.toBeNull();
  expect(f.app.leave.coordinator.isDirty()).toBe(true);
  f.press("copy").focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(async () => (await question(f.app)).open).toBe(true);
  expect(f.dialog.open).toBe(true);
});

it("a shown master key that was downloaded closes on Escape without asking", async () => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const f = await fixture();
  await showKey(f);
  f.press("download").click();
  await expect.poll(() => f.app.leave.coordinator.isDirty()).toBe(false);
  f.press("copy").focus();
  const closed = dialogClosed(f.dialog);
  await userEvent.keyboard("{Escape}");
  await closed;
  expect((await question(f.app)).open).toBe(false);
});

it("the dialog being dismissed releases its draft", async () => {
  const f = await fixture();
  await showKey(f);
  await expect.poll(() => f.app.leave.coordinator.isDirty()).toBe(true);
  f.host.dismiss();
  await f.host.updateComplete;
  await expect.poll(() => f.dialog.open).toBe(false);
  expect(f.app.leave.coordinator.isDirty()).toBe(false);
  expect((await question(f.app)).open).toBe(false);
});

it("a shown master key makes the browser ask before the page is left, and closing stops it", async () => {
  const f = await fixture();
  const leaving = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(leaving()).toBe(false);
  await showKey(f);
  await expect.poll(leaving).toBe(true);
  f.dialog.closeAfter("security");
  await expect.poll(leaving).toBe(false);
});
