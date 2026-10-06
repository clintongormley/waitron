import { afterEach, expect, it, vi } from "vitest";
import { leaveCoordinatorFor, type WtInput } from "@waitron/ui";
import type { DashboardApi, OwnProfile } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
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
        locales: [
          { code: "en-GB", label: "English" },
          { code: "es-ES", label: "Español" },
        ],
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

function pageDraft(m: Mounted) {
  const page = m.app.shadowRoot!.querySelector(".body")!.firstElementChild!;
  const input = document.createElement("wt-input") as WtInput;
  input.name = "departingPageDraft";
  input.value = "page saved";
  page.shadowRoot!.append(input);
  const scope = leaveCoordinatorFor(m.app)!.register({
    id: input,
    current: () => input.value,
    snapshot: (value) => value,
    equal: (a, b) => a === b,
    restore: (value) => {
      input.value = value;
    },
  });
  input.value = "page edited";
  scope.changed();
  return { input, scope };
}
function leave(m: Mounted, action: "logout" | "locale") {
  if (action === "logout")
    m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=logout]")!.click();
  else
    m.app.shadowRoot!.querySelector("wt-language-chooser")!.dispatchEvent(
      new CustomEvent("wt-locale-selected", {
        detail: { code: "es-ES" },
        bubbles: true,
        composed: true,
      }),
    );
}
for (const action of ["logout", "locale"] as const) {
  it(`${action} asks before its API call, keeps actual profile inputs, then accepts Discard once`, async () => {
    const logout = vi.fn(async () => {});
    const putLocale = vi.fn(async () => {});
    const m = await mount({ logout, putLocale });
    const departing = action === "locale" ? pageDraft(m) : undefined;
    change(m, "123456");
    await m.screen.updateComplete;
    leave(m, action);
    await expect.poll(() => m.question.open).toBe(true);
    expect(logout).not.toHaveBeenCalled();
    expect(putLocale).not.toHaveBeenCalled();
    expect(telephone(m)).toBe("123456");
    expect(departing?.input.value).toBe(action === "locale" ? "page edited" : undefined);
    expect(m.screen.isConnected).toBe(true);
    expect(location.pathname).toBe("/manage/profile");
    expect(currentLocale()).toBe("en-GB");
    leave(m, action === "logout" ? "locale" : "logout");
    await choose(m, "keep");
    expect(logout).not.toHaveBeenCalled();
    expect(putLocale).not.toHaveBeenCalled();
    expect(telephone(m)).toBe("123456");
    expect(unload()).toBe(true);
    leave(m, action);
    await expect.poll(() => m.question.open).toBe(true);
    await choose(m, "discard");
    if (action === "logout") {
      await expect
        .poll(() => m.app.shadowRoot!.querySelector("dashboard-login-screen"))
        .not.toBeNull();
      expect(logout).toHaveBeenCalledTimes(1);
      expect(putLocale).not.toHaveBeenCalled();
      expect(location.pathname).toBe("/manage/");
      expect(m.screen.isConnected).toBe(false);
    } else {
      await expect.poll(currentLocale).toBe("es-ES");
      expect(putLocale.mock.calls).toEqual([["es-ES"]]);
      expect(logout).not.toHaveBeenCalled();
      expect(location.pathname).toBe("/manage/profile");
      expect(telephone(m)).toBe("123456");
      expect(departing!.input.value).toBe("page saved");
      expect(departing!.input.isConnected).toBe(false);
    }
    expect(unload()).toBe(action === "locale");
  });
  it(`${action} directly accepts reverted inputs without warning`, async () => {
    const logout = vi.fn(async () => {});
    const putLocale = vi.fn(async () => {});
    const m = await mount({ logout, putLocale });
    const departing = action === "locale" ? pageDraft(m) : undefined;
    change(m, "123456");
    change(m, "");
    if (departing) {
      departing.input.value = "page saved";
      departing.scope.changed();
    }
    leave(m, action);
    await expect
      .poll(() => (action === "logout" ? logout.mock.calls.length : putLocale.mock.calls.length))
      .toBe(1);
    expect(m.question.open).toBe(false);
    expect(unload()).toBe(false);
  });
  it(`${action} cannot proceed from an old answer after forced expiry`, async () => {
    const logout = vi.fn(async () => {});
    const putLocale = vi.fn(async () => {});
    const m = await mount({ logout, putLocale });
    if (action === "locale") pageDraft(m);
    change(m, "123456");
    leave(m, action);
    await expect.poll(() => m.question.open).toBe(true);
    await m.question.updateComplete;
    const oldDiscard = m.question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    window.dispatchEvent(
      new CustomEvent("waitron-session-invalid", {
        detail: { code: "management_session.expired" },
      }),
    );
    await expect.poll(() => m.screen.isConnected).toBe(false);
    oldDiscard.click();
    expect(logout).not.toHaveBeenCalled();
    expect(putLocale).not.toHaveBeenCalled();
    expect(m.question.open).toBe(false);
    expect(unload()).toBe(false);
    expect(location.pathname).toBe("/manage/");
  });
  it(`${action} cannot proceed after a coordinator reset retires its pending question`, async () => {
    const logout = vi.fn(async () => {});
    const putLocale = vi.fn(async () => {});
    const m = await mount({ logout, putLocale });
    if (action === "locale") pageDraft(m);
    change(m, "123456");
    leave(m, action);
    await expect.poll(() => m.question.open).toBe(true);
    await m.question.updateComplete;
    const oldDiscard = m.question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    const coordinator = leaveCoordinatorFor(m.app)!;
    coordinator.forceReset();
    await expect.poll(() => m.question.open).toBe(false);
    oldDiscard.click();
    expect(logout).not.toHaveBeenCalled();
    expect(putLocale).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/manage/profile");
    expect(telephone(m)).toBe("123456");
  });
}
it("picking the current language persists the preference without discarding an edited form", async () => {
  const putLocale = vi.fn(async () => {});
  const m = await mount({ putLocale });
  change(m, "123456");
  m.app.shadowRoot!.querySelector("wt-language-chooser")!.dispatchEvent(
    new CustomEvent("wt-locale-selected", {
      detail: { code: "en-GB" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => putLocale.mock.calls).toEqual([["en-GB"]]);
  expect(m.question.open).toBe(false);
  expect(telephone(m)).toBe("123456");
  expect(unload()).toBe(true);
});

it("an accepted language write cannot repaint an expired session when its response arrives", async () => {
  let accept!: () => void;
  const putLocale = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
  );
  const m = await mount({ putLocale });
  pageDraft(m);
  change(m, "123456");
  leave(m, "locale");
  await expect.poll(() => m.question.open).toBe(true);
  await choose(m, "discard");
  await expect.poll(() => putLocale.mock.calls.length).toBe(1);
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  await expect.poll(() => m.screen.isConnected).toBe(false);
  accept();
  await m.app.updateComplete;
  await Promise.resolve();
  expect(currentLocale()).toBe("en-GB");
  expect(location.pathname).toBe("/manage/");
  expect(m.app.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  expect(unload()).toBe(false);
});
for (const action of ["logout", "locale"] as const) {
  it(`${action} leaves no continuation after the shell disconnects with a question pending`, async () => {
    const logout = vi.fn(async () => {});
    const putLocale = vi.fn(async () => {});
    const m = await mount({ logout, putLocale });
    if (action === "locale") pageDraft(m);
    change(m, "123456");
    leave(m, action);
    await expect.poll(() => m.question.open).toBe(true);
    await m.question.updateComplete;
    const oldDiscard = m.question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    m.app.remove();
    oldDiscard.click();
    await m.screen.updateComplete;
    expect(logout).not.toHaveBeenCalled();
    expect(putLocale).not.toHaveBeenCalled();
    expect(unload()).toBe(false);
    expect(m.screen.shadowRoot!.querySelector("wt-input[name=telephone]")).toBeNull();
    expect(location.pathname).toBe("/manage/profile");
  });
  it(`${action} cannot discard a successfully saved child from an older question`, async () => {
    let received: unknown;
    const logout = vi.fn(async () => {});
    const putLocale = vi.fn(async () => {});
    const m = await mount({
      logout,
      putLocale,
      saveProfile: async (body) => {
        received = body;
        return { emailVerificationSent: false };
      },
    });
    if (action === "locale") pageDraft(m);
    change(m, "123456");
    await m.screen.updateComplete;
    leave(m, action);
    await expect.poll(() => m.question.open).toBe(true);
    await m.question.updateComplete;
    const oldDiscard = m.question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
    m.screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await expect.poll(() => m.inner.open).toBe(false);
    await expect.poll(() => m.question.open).toBe(action === "locale");
    oldDiscard.click();
    if (action === "locale") await expect.poll(currentLocale).toBe("es-ES");
    expect(received).toEqual({
      displayName: "Ada",
      firstNames: "Ada",
      lastNames: "Lovelace",
      telephone: "123456",
      email: "ada@example.com",
      locale: "en-GB",
    });
    expect(logout).not.toHaveBeenCalled();
    expect(putLocale.mock.calls).toEqual(action === "locale" ? [["es-ES"]] : []);
    expect(location.pathname).toBe("/manage/profile");
    expect(unload()).toBe(false);
  });
}

it("an old language response cannot repaint a reconnected shell", async () => {
  let accept!: () => void;
  const putLocale = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
  );
  const m = await mount({ putLocale });
  pageDraft(m);
  change(m, "123456");
  leave(m, "locale");
  await expect.poll(() => m.question.open).toBe(true);
  await choose(m, "discard");
  await expect.poll(() => putLocale.mock.calls.length).toBe(1);
  const parent = m.app.parentElement!;
  m.app.remove();
  parent.append(m.app);
  await m.app.updateComplete;
  accept();
  await Promise.resolve();
  await m.app.updateComplete;
  expect(currentLocale()).toBe("en-GB");
  expect(unload()).toBe(false);
});

it("an old logout response cannot clear a newly authenticated session", async () => {
  let finish!: () => void;
  const logout = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const m = await mount({ logout });
  change(m, "123456");
  leave(m, "logout");
  await expect.poll(() => m.question.open).toBe(true);
  await choose(m, "discard");
  await expect.poll(() => logout.mock.calls.length).toBe(1);
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  await expect.poll(() => m.app.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  m.app
    .shadowRoot!.querySelector("dashboard-login-screen")!
    .dispatchEvent(new CustomEvent("logged-in", { bubbles: true, composed: true }));
  await expect.poll(() => m.app.shadowRoot!.querySelector("dashboard-login-screen")).toBeNull();
  expect(location.pathname).toBe("/manage/my-schedule");
  finish();
  await Promise.resolve();
  await m.app.updateComplete;
  expect(m.app.shadowRoot!.querySelector("dashboard-login-screen")).toBeNull();
  expect(location.pathname).toBe("/manage/my-schedule");
  expect(logout).toHaveBeenCalledTimes(1);
});

it("changing language retains the profile draft when no departing page is dirty", async () => {
  const putLocale = vi.fn(async () => {});
  const m = await mount({ putLocale });
  change(m, "123456");
  leave(m, "locale");
  await expect.poll(() => putLocale.mock.calls.length).toBe(1);
  expect(m.question.open).toBe(false);
  expect(telephone(m)).toBe("123456");
  expect(m.screen.isConnected).toBe(true);
  expect(unload()).toBe(true);
});
