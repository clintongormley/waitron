import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(path = "/manage/backup") {
  history.replaceState(null, "", path);
  let logouts = 0;
  const locales: string[] = [];
  const { el: app } = await mountWidget<DashboardApp>("dashboard-app", {
    api: {
      liveData: new LiveData(),
      getMe: async () => ({
        personId: "p1",
        email: "ada@example.com",
        role: "manager",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Venue",
        permissions: ["venue.view", "venue.configure"],
        modules: [],
      }),
      getLocales: async () => ({
        locales: [
          { code: "en-GB", label: "English" },
          { code: "es-ES", label: "Español" },
        ],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
        venueName: "Venue",
        onboardingIntent: "prepare",
      }),
      getGoogleConfig: async () => ({ configured: false }),
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      listAlerts: async () => ({ visible: false, alerts: [] }),
      passkeySignals: async () => ({
        rpId: "localhost",
        userId: "cDE",
        credentialIds: [],
        name: "ada@example.com",
        displayName: "Ada",
      }),
      getBackupStatus: async () => ({
        enabled: false,
        isPrimary: true,
        managedByEnvironment: false,
        destinations: [],
        backupStatus: { configured: false },
        archiveUnderCurrentKey: false,
        recoveryKeySet: true,
        recoveryKeyTooShort: false,
      }),
      getStreamSettings: async () => ({
        isPrimary: true,
        configured: false,
        bucket: null,
        status: { state: "off" },
        recoveryKeySet: true,
        keyFingerprint: null,
      }),
      logout: async () => {
        logouts++;
      },
      putLocale: async (code: string) => {
        locales.push(code);
      },
    } as unknown as DashboardApi,
  });
  await expect.poll(() => app.shadowRoot!.querySelector("[data-test=nav-backup]")).not.toBeNull();
  if (path.endsWith("backup"))
    await expect
      .poll(() => backup(app)?.shadowRoot?.querySelector("[data-test=destination]"))
      .not.toBeNull();
  return { app, logouts: () => logouts, locales };
}
function backup(app: DashboardApp) {
  return app.shadowRoot!.querySelector("dashboard-backup-screen")!;
}
function field(app: DashboardApp, name: string) {
  return backup(app).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[data-test=${name}]`,
  )!;
}
async function enter(app: DashboardApp, name: string, value: string) {
  const input = field(app, name);
  await input.updateComplete;
  await userEvent.fill(input.shadowRoot!.querySelector("input")!, value);
  await backup(app).updateComplete;
  return input;
}
async function choose(app: DashboardApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  await userEvent.click(
    warning
      .shadowRoot!.querySelector(`[data-choice=${decision}]`)!
      .shadowRoot!.querySelector("button")!,
  );
  await expect.poll(() => warning.open).toBe(false);
}

it("the actual dashboard sidebar keeps archive and export inputs until Discard", async () => {
  const { app } = await mount();
  const screen = backup(app);
  const destination = await enter(app, "destination", "/mnt/edited");
  const secret = await enter(app, "configuration-passphrase", "synthetic secret");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/backup");
  expect(destination.value).toBe("/mnt/edited");
  expect(secret.value).toBe("synthetic secret");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  expect(screen.isConnected).toBe(false);
  await screen.updateComplete;
  expect(secret.value).toBe("");
});
it("real Back keeps an export draft and accepted Back/Forward returns with empty credentials", async () => {
  const { app } = await mount("/manage/overview");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-backup]")!.click();
  await expect.poll(() => field(app, "configuration-passphrase")).not.toBeNull();
  const secret = await enter(app, "configuration-passphrase", "synthetic secret");
  history.back();
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/backup");
  expect(secret.value).toBe("synthetic secret");
  history.back();
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/overview");
  history.forward();
  await expect.poll(() => location.pathname).toBe("/manage/backup");
  await expect.poll(() => field(app, "configuration-passphrase")?.value).toBe("");
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("export drafts protect voluntary sign-out and language replacement before their requests", async () => {
  const { app, logouts, locales } = await mount();
  const secret = await enter(app, "configuration-passphrase", "synthetic secret");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
  await choose(app, "keep");
  expect(logouts()).toBe(0);
  app.shadowRoot!.querySelector("wt-language-chooser")!.dispatchEvent(
    new CustomEvent("wt-locale-selected", {
      detail: { code: "es-ES" },
      bubbles: true,
      composed: true,
    }),
  );
  await choose(app, "keep");
  expect(locales).toEqual([]);
  expect(secret.value).toBe("synthetic secret");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
  await choose(app, "discard");
  await expect.poll(logouts).toBe(1);
  await expect.poll(() => location.pathname).toBe("/manage/");
});
it("forced expiry clears export credentials and cancels an unanswered leave decision", async () => {
  const { app, logouts } = await mount();
  const screen = backup(app);
  const secret = await enter(app, "configuration-passphrase", "synthetic secret");
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.click();
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  const discard = warning.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  await expect.poll(() => screen.isConnected).toBe(false);
  await screen.updateComplete;
  discard.click();
  expect(logouts()).toBe(0);
  expect(secret.value).toBe("");
  expect(location.pathname).toBe("/manage/");
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
