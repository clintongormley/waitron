import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { leaveCoordinatorFor, type WtInput } from "@waitron/ui";
import type { DashboardApi, OwnProfile } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { setLocale } from "./i18n/t.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

const profile: OwnProfile = {
  displayName: "Ada",
  firstNames: "Ada",
  lastNames: "Lovelace",
  telephone: null,
  email: "ada@example.com",
  pendingEmail: null,
  locale: "en-GB",
  hasPassword: true,
  hasTotp: false,
  hasGoogle: false,
  passkeys: [],
};
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  vi.restoreAllMocks();
});

async function mount(overrides: Partial<DashboardApi> = {}) {
  history.replaceState(null, "", "/manage/profile");
  const { el: app } = await mountWidget<DashboardApp>("dashboard-app", {
    api: {
      getMe: async () => ({
        personId: "p1",
        role: "staff",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Venue",
        permissions: [],
        modules: [],
      }),
      getLocales: async () => ({
        locales: [{ code: "en-GB", label: "English" }],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
        venueName: "Venue",
        onboardingIntent: "prepare",
      }),
      getProfile: async () => profile,
      getGoogleConfig: async () => ({ configured: false }),
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      getStaffRoster: async () => [{ personId: "p1", displayName: "Ada" }],
      listMyShifts: async () => [],
      listMySwaps: async () => [],
      listMyAbsences: async () => [],
      listAlerts: async () => ({ visible: false, alerts: [] }),
      passkeySignals: async () => ({
        rpId: "localhost",
        userId: "cDE",
        credentialIds: [],
        name: "ada@example.com",
        displayName: "Ada",
      }),
      ...overrides,
    } as DashboardApi,
  });
  await expect
    .poll(() =>
      app
        .shadowRoot!.querySelector("dashboard-profile-screen")
        ?.shadowRoot?.querySelector("wt-tabs"),
    )
    .not.toBeNull();
  const screen = app.shadowRoot!.querySelector("dashboard-profile-screen")!;
  const outer = app.shadowRoot!.querySelector("wt-modal")!;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  app.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-profile-details]")!.click();
  await screen.updateComplete;
  const inner = screen.shadowRoot!.querySelector("wt-modal")!;
  await inner.updateComplete;
  return { app, screen, outer, inner, question };
}
type Mounted = Awaited<ReturnType<typeof mount>>;
function change({ screen }: Mounted, value: string) {
  screen
    .shadowRoot!.querySelector("wt-input[name=telephone]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function telephone({ screen }: Mounted) {
  return screen.shadowRoot!.querySelector<WtInput>("wt-input[name=telephone]")!.value;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose({ question }: Mounted, decision: "keep" | "discard") {
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
function close(mounted: Mounted, route: "footer" | "escape") {
  if (route === "footer")
    mounted.app.shadowRoot!.querySelector<HTMLElement>("[data-test=close-profile]")!.click();
  else
    mounted.outer
      .shadowRoot!.querySelector("dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true }));
}

// Removing either outer dismissal gate loses the child value before a decision.
for (const route of ["footer", "escape"] as const) {
  it(`outer ${route} retains edited child values on Keep and closes only after Discard`, async () => {
    const m = await mount();
    change(m, "+34 600 000 001");
    await m.screen.updateComplete;
    expect(unload()).toBe(true);
    close(m, route);
    await expect.poll(() => m.question.open).toBe(true);
    expect(m.outer.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(m.inner.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(location.pathname).toBe("/manage/profile");
    close(m, route);
    await choose(m, "keep");
    expect(telephone(m)).toBe("+34 600 000 001");
    expect(m.screen.isConnected).toBe(true);
    expect(location.pathname).toBe("/manage/profile");
    expect(unload()).toBe(true);
    close(m, route);
    await expect.poll(() => m.question.open).toBe(true);
    await choose(m, "discard");
    await expect.poll(() => m.app.shadowRoot!.querySelector("dashboard-profile-screen")).toBeNull();
    expect(m.outer.open).toBe(false);
    expect(location.pathname).toBe("/manage/my-schedule");
    expect(unload()).toBe(false);
    expect(m.screen.shadowRoot!.querySelector("wt-input[name=telephone]")).toBeNull();
    m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=profile]")!.click();
    await expect
      .poll(() =>
        m.app
          .shadowRoot!.querySelector("dashboard-profile-screen")
          ?.shadowRoot?.querySelector("wt-tabs"),
      )
      .not.toBeNull();
    const next = m.app.shadowRoot!.querySelector("dashboard-profile-screen")!;
    next.editDetails();
    await next.updateComplete;
    expect(next.shadowRoot!.querySelector<WtInput>("wt-input[name=telephone]")!.value).toBe("");
  });
}
it("outer close directly leaves clean and reverted child forms", async () => {
  const m = await mount();
  change(m, "edited");
  expect(unload()).toBe(true);
  change(m, "");
  expect(unload()).toBe(false);
  close(m, "footer");
  await expect.poll(() => m.screen.isConnected).toBe(false);
  expect(m.question.open).toBe(false);
  expect(location.pathname).toBe("/manage/my-schedule");
});
it("outer close never interrupts a child's in-flight save, and a refusal remains protected", async () => {
  let refuse!: (error: unknown) => void;
  const m = await mount({
    saveProfile: () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  });
  change(m, "123456");
  await m.screen.updateComplete;
  m.screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect
    .poll(() => m.screen.shadowRoot!.querySelector<WtInput>("wt-input[name=telephone]")!.disabled)
    .toBe(true);
  close(m, "footer");
  close(m, "escape");
  await m.app.updateComplete;
  expect(m.screen.isConnected).toBe(true);
  expect(m.outer.open).toBe(true);
  expect(m.question.open).toBe(false);
  expect(location.pathname).toBe("/manage/profile");
  refuse({ code: "connection.failed" });
  await expect
    .poll(() => m.screen.shadowRoot!.querySelector<WtInput>("wt-input[name=telephone]")!.disabled)
    .toBe(false);
  close(m, "footer");
  await expect.poll(() => m.question.open).toBe(true);
  await choose(m, "keep");
  expect(telephone(m)).toBe("123456");
});
it("native child Escape preserves its editor and outer profile after Keep", async () => {
  const m = await mount();
  change(m, "123456");
  await m.screen.updateComplete;
  m.screen.shadowRoot!.querySelector<WtInput>("wt-input[name=telephone]")!.focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => m.question.open).toBe(true);
  await choose(m, "keep");
  expect(telephone(m)).toBe("123456");
  expect(m.outer.open).toBe(true);
  expect(m.inner.open).toBe(true);
  expect(m.screen.shadowRoot!.activeElement).toBe(
    m.screen.shadowRoot!.querySelector("wt-input[name=telephone]"),
  );
});
it("disconnect cancels a pending outer answer and clears sensitive child input", async () => {
  const m = await mount();
  change(m, "123456");
  await m.screen.updateComplete;
  close(m, "footer");
  await expect.poll(() => m.question.open).toBe(true);
  await m.question.updateComplete;
  const oldDiscard = m.question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  m.app.remove();
  oldDiscard.click();
  await m.screen.updateComplete;
  expect(unload()).toBe(false);
  expect(m.screen.shadowRoot!.querySelector("wt-input[name=telephone]")).toBeNull();
  expect(leaveCoordinatorFor(m.screen)).toBeUndefined();
});

it("a successful child write commits before a refused refresh, then outer close is direct", async () => {
  let reads = 0;
  let received: unknown;
  const m = await mount({
    getProfile: async () => {
      if (++reads === 1) return profile;
      throw { code: "connection.failed" };
    },
    saveProfile: async (body) => {
      received = body;
      return { emailVerificationSent: false };
    },
  });
  change(m, "123456");
  await m.screen.updateComplete;
  m.screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect.poll(() => m.inner.open).toBe(false);
  expect(received).toEqual({
    displayName: "Ada",
    firstNames: "Ada",
    lastNames: "Lovelace",
    telephone: "123456",
    email: "ada@example.com",
    locale: "en-GB",
  });
  expect(unload()).toBe(false);
  close(m, "footer");
  await expect.poll(() => m.screen.isConnected).toBe(false);
  expect(m.question.open).toBe(false);
});
it("closing a clean profile leaves an unrelated page draft protected", async () => {
  const m = await mount();
  const coordinator = leaveCoordinatorFor(m.app)!;
  let value = "saved";
  const scope = coordinator.register({
    id: {},
    current: () => value,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => {
      value = v;
    },
  });
  value = "page draft";
  scope.changed();
  close(m, "footer");
  await expect.poll(() => m.screen.isConnected).toBe(false);
  expect(m.question.open).toBe(false);
  expect(value).toBe("page draft");
  expect(unload()).toBe(true);
  scope.dispose();
  expect(unload()).toBe(false);
});
it("forced expiry bypasses a pending outer close and clears credential proof", async () => {
  const m = await mount();
  m.screen.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await expect.poll(() => m.inner.open).toBe(false);
  m.screen.shadowRoot!.querySelector<HTMLElement>("[data-test=change-password]")!.click();
  await m.screen.updateComplete;
  await m.inner.updateComplete;
  m.screen
    .shadowRoot!.querySelector("wt-input[name=currentPassword]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "sensitive proof" } }));
  await m.screen.updateComplete;
  close(m, "footer");
  await expect.poll(() => m.question.open).toBe(true);
  await m.question.updateComplete;
  const oldDiscard = m.question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  await expect.poll(() => m.screen.isConnected).toBe(false);
  await m.screen.updateComplete;
  oldDiscard.click();
  expect(m.question.open).toBe(false);
  expect(unload()).toBe(false);
  expect(m.screen.shadowRoot!.querySelector("wt-input[name=currentPassword]")).toBeNull();
  expect(m.app.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  expect(location.pathname).toBe("/manage/");
});

it("a save invalidates an older outer Discard without closing the saved profile", async () => {
  let received: unknown;
  const m = await mount({
    saveProfile: async (body) => {
      received = body;
      return { emailVerificationSent: false };
    },
  });
  change(m, "123456");
  await m.screen.updateComplete;
  close(m, "footer");
  await expect.poll(() => m.question.open).toBe(true);
  await m.question.updateComplete;
  const oldDiscard = m.question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  m.screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect.poll(() => m.inner.open).toBe(false);
  await expect.poll(() => m.question.open).toBe(false);
  oldDiscard.click();
  await m.app.updateComplete;
  expect(received).toEqual({
    displayName: "Ada",
    firstNames: "Ada",
    lastNames: "Lovelace",
    telephone: "123456",
    email: "ada@example.com",
    locale: "en-GB",
  });
  expect(m.outer.open).toBe(true);
  expect(m.screen.isConnected).toBe(true);
  expect(location.pathname).toBe("/manage/profile");
  expect(unload()).toBe(false);
});
