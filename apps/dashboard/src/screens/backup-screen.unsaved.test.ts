import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import { commands, page, userEvent } from "vitest/browser";
import type { BackupStatusView, DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./backup-screen.js";

class BackupLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-backup-screen .api=${this.api}></dashboard-backup-screen>
      ${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("backup-leave-test-app", BackupLeaveApp);
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});
type Screen = HTMLElementTagNameMap["dashboard-backup-screen"];
const off: BackupStatusView = {
  enabled: false,
  isPrimary: true,
  managedByEnvironment: false,
  destinations: [],
  backupStatus: { configured: false },
  archiveUnderCurrentKey: false,
  recoveryKeySet: true,
  recoveryKeyTooShort: false,
};
const on: BackupStatusView = {
  ...off,
  enabled: true,
  destinations: [{ id: "primary", dir: "/mnt/usb/waitron" }],
  schedule: { kind: "wall-clock", days: [1, 2, 3, 4, 5], at: "auto" },
  retention: { count: 7, days: 30 },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(
  status = off,
  overrides: Partial<DashboardApi> = {},
  theme: "light" | "dark" = "light",
) {
  const api = {
    liveData: new LiveData(),
    getBackupStatus: async () => status,
    mintBackupKey: async () => ({ key: "synthetic-minted-key" }),
    getBackupRecoveryKey: async () => ({ key: "synthetic-held-key" }),
    applyBackup: async () => on,
    rotateBackupKey: async () => on,
    exportConfiguration: async () => new Blob(["synthetic encrypted export"]),
    getStreamSettings: async () => ({
      isPrimary: true,
      configured: false,
      bucket: null,
      status: { state: "off" },
      recoveryKeySet: true,
      keyFingerprint: null,
    }),
    ...overrides,
  } as DashboardApi;
  const { el: app } = await mountWidget<BackupLeaveApp>("backup-leave-test-app", { api }, theme);
  const screen = app.shadowRoot!.querySelector("dashboard-backup-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=status]")).not.toBeNull();
  await screen.updateComplete;
  return { app, screen, api };
}
function field(screen: Screen, name: string) {
  return screen.shadowRoot!.querySelector<HTMLElement & { value: string }>(`[data-test=${name}]`)!;
}
async function change(screen: Screen, name: string, value: string) {
  field(screen, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
}
async function click(screen: Screen, name: string) {
  field(screen, name).click();
  await screen.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: BackupLeaveApp) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
}
async function choose(app: BackupLeaveApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  warning.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
  );
  await expect.poll(() => warning.open).toBe(false);
}
async function edit(screen: Screen) {
  await click(screen, "edit-settings");
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=destination]"))
    .not.toBeNull();
}
async function credentials(screen: Screen) {
  await change(screen, "configuration-passphrase", "synthetic passphrase");
  await change(screen, "configuration-confirm", "synthetic passphrase");
}

it("default configuration and generated-key output leave without warning", async () => {
  const { app, screen } = await mount({ ...off, recoveryKeySet: false });
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=minted-key]"))
    .not.toBeNull();
  expect(await leave(app)).toBe("proceeded");
  expect(unload()).toBe(false);
});
it("destination edits warn, Keep preserves the native value, and Discard restores the opening", async () => {
  const { app, screen } = await mount();
  await change(screen, "destination", "/mnt/changed");
  expect(unload()).toBe(true);
  const kept = leave(app);
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(
    field(screen, "destination").shadowRoot!.querySelector<HTMLInputElement>("input")!.value,
  ).toBe("/mnt/changed");
  const discarded = leave(app);
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await screen.updateComplete;
  expect(field(screen, "destination").value).toBe("");
  expect(unload()).toBe(false);
});
it("settings Cancel protects changed values but normalized retention and weekday reverts close directly", async () => {
  const { app, screen } = await mount(on);
  await edit(screen);
  await change(screen, "retain-count", "invalid");
  await click(screen, "cancel-edit");
  await choose(app, "keep");
  expect(field(screen, "retain-count").value).toBe("invalid");
  await change(screen, "retain-count", "7.0");
  const monday = field(screen, "weekday-1");
  monday.dispatchEvent(new Event("change"));
  await screen.updateComplete;
  monday.dispatchEvent(new Event("change"));
  await screen.updateComplete;
  expect(unload()).toBe(false);
  await click(screen, "cancel-edit");
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=save-settings]")).toBeNull();
});
it("pasted rotation keys are protected while generated keys and saved-key acknowledgement are exempt", async () => {
  const { app, screen } = await mount(on);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=minted-key]"))
    .not.toBeNull();
  await click(screen, "advanced-toggle");
  expect(unload()).toBe(false);
  await change(screen, "paste-key", "synthetic pasted key");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  await change(screen, "paste-key", "");
  expect(unload()).toBe(false);
});
it("a refused settings write keeps the unsaved draft", async () => {
  const { app, screen } = await mount(on, {
    applyBackup: async () => {
      throw { code: "backup.request_invalid" };
    },
  });
  await edit(screen);
  await change(screen, "destination", "/mnt/changed");
  await click(screen, "save-settings");
  await expect.poll(() => screen.shadowRoot!.querySelector(".error")).not.toBeNull();
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  expect(field(screen, "destination").value).toBe("/mnt/changed");
});
it("accepted settings commit only the submitted values and retain newer input", async () => {
  const write = deferred<BackupStatusView>();
  const { app, screen } = await mount(on, { applyBackup: () => write.promise });
  await edit(screen);
  await change(screen, "destination", "/mnt/submitted");
  await click(screen, "save-settings");
  await change(screen, "destination", "/mnt/newer");
  write.resolve({ ...on, destinations: [{ id: "primary", dir: "/mnt/submitted" }] });
  await expect.poll(() => field(screen, "save-settings")?.hasAttribute("disabled")).toBe(false);
  expect(field(screen, "destination").value).toBe("/mnt/newer");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  expect(await pending).toBe("proceeded");
  await screen.updateComplete;
  expect(field(screen, "destination").value).toBe("/mnt/submitted");
  expect(unload()).toBe(false);
});
it("accepted archive settings do not commit independent export credentials", async () => {
  const { app, screen } = await mount(on);
  await edit(screen);
  await credentials(screen);
  await change(screen, "destination", "/mnt/changed");
  await click(screen, "save-settings");
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=save-settings]")).toBeNull();
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  expect(field(screen, "configuration-passphrase").value).toBe("synthetic passphrase");
});
it("export credentials stay protected after a refused export", async () => {
  const write = deferred<Blob>();
  const { app, screen } = await mount(off, { exportConfiguration: () => write.promise });
  await credentials(screen);
  expect(unload()).toBe(true);
  await click(screen, "configuration-export");
  write.reject(new Error("refused"));
  await expect
    .poll(() => field(screen, "configuration-export").hasAttribute("disabled"))
    .toBe(false);
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
});
it("export credentials revert cleanly and successful export leaves no warning", async () => {
  const { app, screen } = await mount();
  await credentials(screen);
  await change(screen, "configuration-passphrase", "");
  await change(screen, "configuration-confirm", "");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
  await credentials(screen);
  await click(screen, "configuration-export");
  await expect.poll(() => field(screen, "configuration-confirm").value).toBe("");
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});
it("Discard on settings Cancel restores only the archive draft, preserving export credentials", async () => {
  const { app, screen } = await mount(on);
  await edit(screen);
  await credentials(screen);
  await change(screen, "destination", "/mnt/changed");
  await click(screen, "cancel-edit");
  await choose(app, "discard");
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=save-settings]")).toBeNull();
  expect(field(screen, "configuration-passphrase").value).toBe("synthetic passphrase");
  expect(unload()).toBe(true);
  await edit(screen);
  expect(field(screen, "destination").value).toBe("/mnt/usb/waitron");
});
it("a live backup read cannot reset an edited opening baseline", async () => {
  let status = on;
  const { app, screen, api } = await mount(on, { getBackupStatus: async () => status });
  await edit(screen);
  await change(screen, "destination", "/mnt/changed");
  status = { ...on, destinations: [{ id: "primary", dir: "/mnt/changed" }] };
  api.liveData.invalidate([{ type: "backup_status" }]);
  await expect.poll(() => field(screen, "status").textContent).toContain("/mnt/changed");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  expect(await pending).toBe("proceeded");
  await screen.updateComplete;
  expect(field(screen, "destination").value).toBe("/mnt/usb/waitron");
});
it("archive setup commits an accepted write while a refused write still warns", async () => {
  let refused = true;
  const { app, screen } = await mount(off, {
    applyBackup: async (body) => {
      expect(body).toEqual({
        destinationDir: "/mnt/new",
        schedule: { kind: "wall-clock", days: "daily", at: "auto" },
        retention: { count: 7, days: 30 },
      });
      if (refused) throw { code: "backup.request_invalid" };
      return on;
    },
  });
  await change(screen, "destination", " /mnt/new ");
  await click(screen, "apply");
  await expect.poll(() => screen.shadowRoot!.querySelector(".error")).not.toBeNull();
  expect(unload()).toBe(true);
  const kept = leave(app);
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  refused = false;
  await click(screen, "apply");
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=rotate]")).not.toBeNull();
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});
it("an accepted rotation retains a newer pasted key against the submitted baseline", async () => {
  const write = deferred<BackupStatusView>();
  const { app, screen } = await mount(on, { rotateBackupKey: () => write.promise });
  await click(screen, "show-old-key");
  await click(screen, "advanced-toggle");
  await change(screen, "paste-key", "synthetic submitted key");
  const acknowledgement = field(screen, "saved-it") as HTMLInputElement;
  acknowledgement.checked = true;
  acknowledgement.dispatchEvent(new Event("change"));
  await screen.updateComplete;
  await click(screen, "rotate-confirm");
  await change(screen, "paste-key", "synthetic newer key");
  write.resolve(on);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  await expect.poll(() => field(screen, "paste-key")?.value).toBe("synthetic newer key");
  expect(field(screen, "paste-key").value).toBe("synthetic newer key");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  expect(await pending).toBe("proceeded");
  await screen.updateComplete;
  expect(field(screen, "paste-key").value).toBe("synthetic submitted key");
  expect(unload()).toBe(false);
});
it("a departed settings write cannot close a reconnected settings draft", async () => {
  const write = deferred<BackupStatusView>();
  const { app, screen } = await mount(on, { applyBackup: () => write.promise });
  await edit(screen);
  await change(screen, "destination", "/mnt/old");
  await click(screen, "save-settings");
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  await edit(screen);
  await change(screen, "destination", "/mnt/new");
  write.resolve(on);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(field(screen, "destination").value).toBe("/mnt/new");
  expect(unload()).toBe(true);
});
it("accepted setup retains newer policy input and commits the submitted setup baseline", async () => {
  const write = deferred<BackupStatusView>();
  const { app, screen } = await mount(off, { applyBackup: () => write.promise });
  await change(screen, "destination", "/mnt/submitted");
  await click(screen, "apply");
  await change(screen, "destination", "/mnt/newer");
  write.resolve(on);
  await expect.poll(() => field(screen, "destination")?.value).toBe("/mnt/newer");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(field(screen, "destination")?.value).toBe("/mnt/newer");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  expect(await pending).toBe("proceeded");
  await screen.updateComplete;
  expect(field(screen, "destination").value).toBe("/mnt/submitted");
  expect(unload()).toBe(false);
});
it("a departed setup write cannot replace a reconnected draft or release its unload protection", async () => {
  const write = deferred<BackupStatusView>();
  const { app, screen } = await mount(off, { applyBackup: () => write.promise });
  await change(screen, "destination", "/mnt/old");
  await click(screen, "apply");
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  await change(screen, "destination", "/mnt/new");
  write.resolve(on);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(field(screen, "destination")?.value).toBe("/mnt/new");
  expect(unload()).toBe(true);
});
it("successful export leaves a simultaneous archive draft protected", async () => {
  const { app, screen } = await mount();
  await change(screen, "destination", "/mnt/unsaved");
  await credentials(screen);
  await click(screen, "configuration-export");
  await expect.poll(() => field(screen, "configuration-passphrase").value).toBe("");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  expect(field(screen, "destination").value).toBe("/mnt/unsaved");
});
it("successful export keeps credentials entered during the download protected", async () => {
  const write = deferred<Blob>();
  const { app, screen } = await mount(off, { exportConfiguration: () => write.promise });
  await credentials(screen);
  await click(screen, "configuration-export");
  await change(screen, "configuration-passphrase", "newer synthetic passphrase");
  await change(screen, "configuration-confirm", "newer synthetic passphrase");
  write.resolve(new Blob(["encrypted"]));
  await expect
    .poll(() => field(screen, "configuration-export").hasAttribute("disabled"))
    .toBe(false);
  expect(field(screen, "configuration-passphrase").value).toBe("newer synthetic passphrase");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
});
it("a departed export cannot clear a reconnected form or its busy gate", async () => {
  const old = deferred<Blob>();
  const next = deferred<Blob>();
  let calls = 0;
  const { app, screen } = await mount(off, {
    exportConfiguration: () => (++calls === 1 ? old.promise : next.promise),
  });
  await credentials(screen);
  await click(screen, "configuration-export");
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  await credentials(screen);
  await click(screen, "configuration-export");
  old.resolve(new Blob(["old"]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(field(screen, "configuration-passphrase").value).toBe("synthetic passphrase");
  expect(field(screen, "configuration-export").hasAttribute("disabled")).toBe(true);
  next.resolve(new Blob(["new"]));
  await expect.poll(() => field(screen, "configuration-passphrase").value).toBe("");
  expect(unload()).toBe(false);
});
it("a departed key mint cannot replace the new opening's generated key", async () => {
  const old = deferred<{ key: string }>();
  let calls = 0;
  const { app, screen } = await mount(
    { ...off, recoveryKeySet: false },
    {
      mintBackupKey: () =>
        ++calls === 1 ? old.promise : Promise.resolve({ key: "synthetic current key" }),
    },
  );
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  old.resolve({ key: "synthetic departed key" });
  await expect.poll(() => field(screen, "minted-key")?.textContent).toBe("synthetic current key");
  expect(unload()).toBe(false);
});
it("a departed settings-key read cannot overwrite a reconnected edited opening", async () => {
  const old = deferred<{ key: string | null }>();
  let calls = 0;
  const { app, screen } = await mount(on, {
    getBackupRecoveryKey: () =>
      ++calls === 1 ? old.promise : Promise.resolve({ key: "synthetic current key" }),
  });
  await click(screen, "edit-settings");
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  await edit(screen);
  await change(screen, "destination", "/mnt/current");
  old.resolve({ key: "synthetic departed key" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(field(screen, "destination").value).toBe("/mnt/current");
  expect(unload()).toBe(true);
});
it("a departed rotation cannot clear a reconnected pasted key", async () => {
  const write = deferred<BackupStatusView>();
  const { app, screen } = await mount(on, { rotateBackupKey: () => write.promise });
  await click(screen, "show-old-key");
  await click(screen, "advanced-toggle");
  await change(screen, "paste-key", "synthetic old key");
  const acknowledgement = field(screen, "saved-it") as HTMLInputElement;
  acknowledgement.checked = true;
  acknowledgement.dispatchEvent(new Event("change"));
  await screen.updateComplete;
  await click(screen, "rotate-confirm");
  screen.remove();
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  await click(screen, "advanced-toggle");
  await change(screen, "paste-key", "synthetic current key");
  write.resolve(on);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(field(screen, "paste-key").value).toBe("synthetic current key");
  expect(unload()).toBe(true);
});

for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      it(`${locale} ${theme} ${width}: native settings Cancel, Escape, Keep and Discard`, async () => {
        setLocale(locale);
        await page.viewport(width, 850);
        const { app, screen } = await mount(on, {}, theme);
        await edit(screen);
        const native = field(screen, "destination").shadowRoot!.querySelector<HTMLInputElement>(
          "input",
        )!;
        await userEvent.fill(native, "/mnt/native-draft");
        await screen.updateComplete;
        const cancel = field(screen, "cancel-edit").shadowRoot!.querySelector("button")!;
        await userEvent.click(cancel);
        const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
        await expect.poll(() => warning.open).toBe(true);
        await warning.updateComplete;
        const modal = warning.shadowRoot!.querySelector("wt-modal")!;
        await modal.updateComplete;
        expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
        await commands.parkPointer();
        await expectNoA11yViolations(warning);
        await page.screenshot({
          path: `__screenshots__/w69-backup-look/${locale}-${theme}-${width}-warning.png`,
        });
        await userEvent.keyboard("{Escape}");
        await expect.poll(() => warning.open).toBe(false);
        expect(native.value).toBe("/mnt/native-draft");
        expect(unload()).toBe(true);
        await commands.parkPointer();
        await page.screenshot({
          path: `__screenshots__/w69-backup-look/${locale}-${theme}-${width}-kept.png`,
        });
        await userEvent.click(cancel);
        await expect.poll(() => warning.open).toBe(true);
        await userEvent.click(
          warning
            .shadowRoot!.querySelector("[data-choice=keep]")!
            .shadowRoot!.querySelector("button")!,
        );
        await expect.poll(() => warning.open).toBe(false);
        expect(native.value).toBe("/mnt/native-draft");
        await userEvent.click(cancel);
        await expect.poll(() => warning.open).toBe(true);
        await userEvent.click(
          warning
            .shadowRoot!.querySelector("[data-choice=discard]")!
            .shadowRoot!.querySelector("button")!,
        );
        await expect
          .poll(() => screen.shadowRoot!.querySelector("[data-test=save-settings]"))
          .toBeNull();
        expect(unload()).toBe(false);
      });
    }

it("a detached update cannot consume the next opening's archive registration", async () => {
  const { app, screen } = await mount(off);
  await credentials(screen);
  screen.remove();
  await screen.updateComplete;
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  await change(screen, "destination", "/mnt/reconnected");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
});
it("a departed key reveal cannot put the previous opening's key into a reconnected page", async () => {
  const read = deferred<{ key: string | null }>();
  const { app, screen } = await mount(on, { getBackupRecoveryKey: () => read.promise });
  await click(screen, "show-old-key");
  screen.remove();
  await screen.updateComplete;
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  read.resolve({ key: "synthetic departed key" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=old-key]")).toBeNull();
});
it("another caller enabling archives cannot hide or rebaseline this page's setup draft", async () => {
  let status = off;
  const { app, screen, api } = await mount(off, { getBackupStatus: async () => status });
  await change(screen, "destination", "/mnt/draft");
  status = on;
  api.liveData.invalidate([{ type: "backup_status" }]);
  await expect.poll(() => field(screen, "status").textContent).toContain("/mnt/usb/waitron");
  expect(field(screen, "destination")?.value).toBe("/mnt/draft");
  expect(unload()).toBe(true);
  const pending = leave(app);
  await choose(app, "discard");
  expect(await pending).toBe("proceeded");
  await screen.updateComplete;
  expect(field(screen, "destination").value).toBe("");
  expect(unload()).toBe(false);
});
it("switching from a pasted rotation draft to settings asks before replacing that form", async () => {
  const { app, screen } = await mount(on);
  await click(screen, "advanced-toggle");
  await change(screen, "paste-key", "synthetic pasted key");
  await click(screen, "edit-settings");
  await choose(app, "keep");
  expect(field(screen, "paste-key").value).toBe("synthetic pasted key");
  expect(screen.shadowRoot!.querySelector("[data-test=save-settings]")).toBeNull();
  await click(screen, "edit-settings");
  await choose(app, "discard");
  await expect.poll(() => field(screen, "save-settings")).not.toBeNull();
  expect(unload()).toBe(false);
});
it("opening settings does not consume or ask about independent export credentials", async () => {
  const { app, screen } = await mount(on);
  await credentials(screen);
  await edit(screen);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(field(screen, "configuration-passphrase").value).toBe("synthetic passphrase");
  expect(unload()).toBe(true);
});
it("a settings-key read cannot replace rotation input entered while that read was waiting", async () => {
  const read = deferred<{ key: string | null }>();
  const { app, screen } = await mount(on, { getBackupRecoveryKey: () => read.promise });
  await click(screen, "edit-settings");
  await click(screen, "advanced-toggle");
  await change(screen, "paste-key", "synthetic newer input");
  read.resolve({ key: "synthetic held key" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(field(screen, "paste-key")?.value).toBe("synthetic newer input");
  expect(unload()).toBe(true);
  expect(screen.shadowRoot!.querySelector("[data-test=save-settings]")).toBeNull();
  const pending = leave(app);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
});
