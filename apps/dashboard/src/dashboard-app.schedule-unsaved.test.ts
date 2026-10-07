import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtInput } from "@waitron/ui";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(path = "/manage/my-schedule") {
  history.replaceState(null, "", path);
  let logouts = 0;
  const locales: string[] = [];
  const { el: app } = await mountWidget<DashboardApp>("dashboard-app", {
    api: {
      getMe: async () => ({
        personId: "p1",
        email: "ada@example.com",
        role: "staff",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Venue",
        permissions: [],
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
      getStaffRoster: async () => [{ personId: "p1", displayName: "Ada" }],
      listMyShifts: async () => [],
      listMySwaps: async () => [],
      listMyAbsences: async () => [],
      listOrderStaff: async () => ({ staff: [] }),
      listOrderPages: async () => ({ rows: [], next: null, from: null, to: null }),
      listAlerts: async () => ({ visible: false, alerts: [] }),
      passkeySignals: async () => ({
        rpId: "localhost",
        userId: "cDE",
        credentialIds: [],
        name: "ada@example.com",
        displayName: "Ada",
      }),
      logout: async () => {
        logouts++;
      },
      putLocale: async (code: string) => {
        locales.push(code);
      },
    } as unknown as DashboardApi,
  });
  await expect
    .poll(() => app.shadowRoot!.querySelector("[data-test=nav-my-schedule]"))
    .toBeTruthy();
  return { app, logouts: () => logouts, locales };
}
async function edit(app: DashboardApp) {
  await expect
    .poll(() =>
      app
        .shadowRoot!.querySelector("dashboard-my-schedule-screen")
        ?.shadowRoot?.querySelector<WtInput>("wt-input[name=abs-note]"),
    )
    .toBeTruthy();
  const screen = app.shadowRoot!.querySelector("dashboard-my-schedule-screen")!;
  const field = screen.shadowRoot!.querySelector<WtInput>("wt-input[name=abs-note]")!;
  await field.updateComplete;
  await userEvent.fill(
    page.elementLocator(field.shadowRoot!.querySelector("input")!),
    "Keep my note",
  );
  await screen.updateComplete;
  return screen;
}
function note(screen: HTMLElementTagNameMap["dashboard-my-schedule-screen"]) {
  return screen.shadowRoot!.querySelector<WtInput>("wt-input[name=abs-note]")!.value;
}
function nav(app: DashboardApp, target: string) {
  app.shadowRoot!.querySelector<HTMLElement>(`[data-test=nav-${target}]`)!.click();
}
async function choose(app: DashboardApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  await userEvent.click(
    page.elementLocator(question.shadowRoot!.querySelector(`[data-choice=${decision}]`)!),
  );
  await expect.poll(() => question.open).toBe(false);
}
for (const action of ["sidebar", "logout", "locale"] as const) {
  it(`real My schedule ${action} leave retains the native note on Keep then accepts Discard`, async () => {
    const { app, logouts, locales } = await mount();
    const screen = await edit(app);
    const leave = () => {
      if (action === "sidebar") nav(app, "orders");
      else if (action === "logout")
        app.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
      else
        app.shadowRoot!.querySelector("wt-language-chooser")!.dispatchEvent(
          new CustomEvent("wt-locale-selected", {
            detail: { code: "es-ES" },
            bubbles: true,
            composed: true,
          }),
        );
    };
    leave();
    await choose(app, "keep");
    expect(screen.isConnected).toBe(true);
    expect(note(screen)).toBe("Keep my note");
    expect(location.pathname).toBe("/manage/my-schedule");
    expect(logouts()).toBe(0);
    expect(locales).toEqual([]);
    leave();
    await choose(app, "discard");
    if (action === "sidebar") await expect.poll(() => location.pathname).toBe("/manage/orders");
    else if (action === "logout") await expect.poll(() => logouts()).toBe(1);
    else {
      await expect.poll(currentLocale).toBe("es-ES");
      expect(locales).toEqual(["es-ES"]);
      await expect
        .poll(
          () =>
            app
              .shadowRoot!.querySelector("dashboard-my-schedule-screen")
              ?.shadowRoot?.querySelector<WtInput>("wt-input[name=abs-note]")?.value,
        )
        .toBe("");
    }
  });
}
it("native history Back keeps the schedule and URL until Discard replays the traversal", async () => {
  const { app } = await mount("/manage/orders");
  nav(app, "my-schedule");
  const screen = await edit(app);
  history.back();
  await choose(app, "keep");
  expect(location.pathname).toBe("/manage/my-schedule");
  expect(screen.isConnected).toBe(true);
  expect(note(screen)).toBe("Keep my note");
  history.back();
  await choose(app, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/orders");
  expect(screen.isConnected).toBe(false);
});
it("forced session expiry clears the schedule draft and invalidates an unanswered leave", async () => {
  const { app, logouts } = await mount();
  const screen = await edit(app);
  nav(app, "orders");
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  const oldDiscard = question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  await expect.poll(() => screen.isConnected).toBe(false);
  oldDiscard.click();
  await expect.poll(() => location.pathname).toBe("/manage/");
  expect(note(screen)).toBe("");
  expect(question.open).toBe(false);
  expect(logouts()).toBe(0);
});
