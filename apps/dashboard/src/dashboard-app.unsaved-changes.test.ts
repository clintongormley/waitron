import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leaveCoordinatorFor, navigationGuardFor, type WtInput } from "@waitron/ui";
import type { DashboardApi, MenuPriceRow, OwnProfile, Product } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { MenuPricesTable } from "./widgets/menu-prices-table.js";
import "./widgets/menu-prices-table.js";
import type { MenuStructureTable } from "./widgets/menu-structure-table.js";
import "./widgets/menu-structure-table.js";
import { productMedia } from "./widgets/product-media.js";
import { cleanupWidgets, combinedFixture, mountWidget } from "./widgets/test-helpers.js";

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

async function mount(overrides: Partial<DashboardApi> = {}, request?: DashboardApp["request"]) {
  history.replaceState(null, "", "/manage/profile");
  const { el: app } = await mountWidget<DashboardApp>("dashboard-app", {
    ...(request ? { request } : {}),
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
      getProfile: async () => profile,
      getGoogleConfig: async () => ({ configured: false }),
      getCatalogueSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
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

function selectOrders(m: Mounted) {
  m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-orders]")!.click();
}

it("sidebar navigation keeps the profile and URL until Discard accepts one destination", async () => {
  const m = await mount();
  change(m, "123456");
  await m.screen.updateComplete;
  const length = history.length;
  selectOrders(m);
  await expect.poll(() => m.question.open).toBe(true);
  expect(location.pathname).toBe("/manage/profile");
  expect(telephone(m)).toBe("123456");
  expect(m.screen.isConnected).toBe(true);
  await choose(m, "keep");
  expect(location.pathname).toBe("/manage/profile");
  expect(history.length).toBe(length);
  expect(telephone(m)).toBe("123456");
  selectOrders(m);
  await expect.poll(() => m.question.open).toBe(true);
  await choose(m, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/orders");
  await expect.poll(() => m.screen.isConnected).toBe(false);
  expect(unload()).toBe(false);
});

it("reverted profile input lets sidebar navigation close the profile directly", async () => {
  const m = await mount();
  change(m, "123456");
  change(m, "");
  selectOrders(m);
  await expect.poll(() => location.pathname).toBe("/manage/orders");
  await expect.poll(() => m.screen.isConnected).toBe(false);
  expect(m.question.open).toBe(false);
  expect(unload()).toBe(false);
});

it("forced expiry invalidates a pending sidebar destination before an old Discard answer", async () => {
  const m = await mount();
  change(m, "123456");
  selectOrders(m);
  await expect.poll(() => m.question.open).toBe(true);
  await m.question.updateComplete;
  const oldDiscard = m.question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", {
      detail: { code: "management_session.expired" },
    }),
  );
  await expect.poll(() => location.pathname).toBe("/manage/");
  oldDiscard.click();
  await m.app.updateComplete;
  expect(location.pathname).toBe("/manage/");
  expect(m.app.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  expect(unload()).toBe(false);
});

async function reopenedProfile(m: Mounted): Promise<Mounted> {
  await expect
    .poll(() =>
      m.app
        .shadowRoot!.querySelector("dashboard-profile-screen")
        ?.shadowRoot?.querySelector("wt-tabs"),
    )
    .not.toBeNull();
  const screen = m.app.shadowRoot!.querySelector("dashboard-profile-screen")!;
  m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-profile-details]")!.click();
  await screen.updateComplete;
  const inner = screen.shadowRoot!.querySelector("wt-modal")!;
  await inner.updateComplete;
  return { ...m, screen, inner };
}

for (const direction of ["back", "forward"] as const) {
  it(`dashboard ${direction} restores the edited profile for Keep and closes it only for Discard`, async () => {
    let m = await mount();
    selectOrders(m);
    await expect.poll(() => m.screen.isConnected).toBe(false);
    if (direction === "back") {
      m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=profile]")!.click();
    } else {
      history.back();
    }
    await expect.poll(() => location.pathname).toBe("/manage/profile");
    m = await reopenedProfile(m);
    change(m, "123456");
    await m.screen.updateComplete;
    history[direction]();
    await expect.poll(() => m.question.open).toBe(true);
    expect(location.pathname).toBe("/manage/profile");
    expect(telephone(m)).toBe("123456");
    await choose(m, "keep");
    expect(location.pathname).toBe("/manage/profile");
    expect(m.screen.isConnected).toBe(true);
    history[direction]();
    await expect.poll(() => m.question.open).toBe(true);
    await choose(m, "discard");
    await expect.poll(() => location.pathname).toBe("/manage/orders");
    await expect.poll(() => m.screen.isConnected).toBe(false);
    expect(unload()).toBe(false);
  });
}

it("opening and closing Account settings retains the edited main page without a warning", async () => {
  const m = await mount();
  const departing = pageDraft(m);
  m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=close-profile]")!.click();
  await expect.poll(() => location.pathname).toBe("/manage/my-schedule");
  expect(m.question.open).toBe(false);
  m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=profile]")!.click();
  await expect.poll(() => location.pathname).toBe("/manage/profile");
  expect(m.question.open).toBe(false);
  expect(departing.input.isConnected).toBe(true);
  expect(departing.input.value).toBe("page edited");
  expect(unload()).toBe(true);
});

it.each([
  ["/manage/orders?keep=1#orders", "/manage/orders"],
  ["/manage?keep=1#orders", "/manage/my-schedule"],
])(
  "an ordinary same-app anchor %s from a child shadow root asks before its default navigation",
  async (href, destination) => {
    const m = await mount();
    change(m, "123456");
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.textContent = "Orders";
    m.screen.shadowRoot!.append(anchor);
    let reachedBrowser = false;
    const blockDefault = (event: MouseEvent) => {
      reachedBrowser = !event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", blockDefault, { once: true });
    anchor.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
    );
    document.removeEventListener("click", blockDefault);
    expect(reachedBrowser).toBe(false);
    await expect.poll(() => m.question.open).toBe(true);
    expect(location.pathname).toBe("/manage/profile");
    await choose(m, "keep");
    expect(telephone(m)).toBe("123456");
    document.addEventListener("click", blockDefault, { once: true });
    anchor.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
    );
    document.removeEventListener("click", blockDefault);
    await expect.poll(() => m.question.open).toBe(true);
    await choose(m, "discard");
    await expect.poll(() => location.pathname).toBe(destination);
    expect(location.search).toBe("?keep=1");
    expect(location.hash).toBe("#orders");
    expect(unload()).toBe(false);
  },
);

it("a guarded product deep link accepts the product and screen in one history stop", async () => {
  const m = await mount({
    getMe: async () => ({
      personId: "p1",
      email: "ada@example.com",
      role: "manager",
      locale: "en-GB",
      venueLocale: "en-GB",
      sessionDefault: "en-GB",
      venueName: "Venue",
      permissions: ["product.manage"],
      modules: [],
    }),
  });
  change(m, "123456");
  const pushed = vi.spyOn(history, "pushState");
  const request = () =>
    m.app.shadowRoot!.querySelector(".body")!.firstElementChild!.dispatchEvent(
      new CustomEvent("wt-edit-product", {
        detail: { productId: "product-1" },
        bubbles: true,
        composed: true,
      }),
    );
  request();
  await expect.poll(() => m.question.open).toBe(true);
  expect(location.pathname).toBe("/manage/profile");
  await choose(m, "keep");
  expect(telephone(m)).toBe("123456");
  request();
  await expect.poll(() => m.question.open).toBe(true);
  await choose(m, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/catalogue/product/product-1");
  expect(pushed).toHaveBeenCalledTimes(1);
  expect(m.app.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
  expect(unload()).toBe(false);
});

it.each([
  "ctrl",
  "meta",
  "shift",
  "alt",
  "middle",
  "download",
  "new-tab",
  "external",
  "other-app",
] as const)(
  "%s links keep browser handling without discarding edited profile input",
  async (kind) => {
    const m = await mount();
    change(m, "123456");
    const anchor = document.createElement("a");
    anchor.href =
      kind === "external"
        ? "https://example.invalid/manage/orders"
        : kind === "other-app"
          ? "/setup/"
          : "/manage/orders";
    if (kind === "download") anchor.download = "orders";
    if (kind === "new-tab") anchor.target = "_blank";
    m.screen.shadowRoot!.append(anchor);
    let reachedBrowser = false;
    const blockDefault = (event: MouseEvent) => {
      reachedBrowser = !event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", blockDefault, { once: true });
    anchor.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        cancelable: true,
        ctrlKey: kind === "ctrl",
        metaKey: kind === "meta",
        shiftKey: kind === "shift",
        altKey: kind === "alt",
        button: kind === "middle" ? 1 : 0,
      }),
    );
    document.removeEventListener("click", blockDefault);
    await m.app.updateComplete;
    expect(reachedBrowser).toBe(true);
    expect(m.question.open).toBe(false);
    expect(location.pathname).toBe("/manage/profile");
    expect(telephone(m)).toBe("123456");
    expect(unload()).toBe(true);
  },
);

it.each([
  ["plain", false],
  ["shift", true],
] as const)(
  "a %s click on a same-app anchor two shadow roots deep is handled like one a single root deep",
  async (kind, toBrowser) => {
    const m = await mount();
    const cell = document.createElement("div");
    cell.attachShadow({ mode: "open" });
    const anchor = document.createElement("a");
    anchor.href = "/manage/orders";
    cell.shadowRoot!.append(anchor);
    m.screen.shadowRoot!.append(cell);
    let reachedBrowser = false;
    const blockDefault = (event: MouseEvent) => {
      reachedBrowser = !event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener("click", blockDefault, { once: true });
    anchor.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        cancelable: true,
        shiftKey: kind === "shift",
      }),
    );
    document.removeEventListener("click", blockDefault);
    expect(reachedBrowser).toBe(toBrowser);
    if (toBrowser) expect(location.pathname).toBe("/manage/profile");
    else await expect.poll(() => location.pathname).toBe("/manage/orders");
  },
);

it("an encoded Account settings link retains the edited underlying page", async () => {
  const m = await mount();
  const departing = pageDraft(m);
  m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=close-profile]")!.click();
  await expect.poll(() => location.pathname).toBe("/manage/my-schedule");
  const anchor = document.createElement("a");
  anchor.href = "/manage/%70rofile";
  (departing.input.getRootNode() as ShadowRoot).append(anchor);
  const blockDefault = (event: MouseEvent) => event.preventDefault();
  document.addEventListener("click", blockDefault, { once: true });
  anchor.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
  );
  document.removeEventListener("click", blockDefault);
  await expect.poll(() => location.pathname).toBe("/manage/%70rofile");
  expect(m.question.open).toBe(false);
  expect(departing.input.isConnected).toBe(true);
  expect(departing.input.value).toBe("page edited");
  expect(unload()).toBe(true);
});

it("a malformed route segment still asks before discarding the profile and falls back safely", async () => {
  const m = await mount();
  change(m, "123456");
  const anchor = document.createElement("a");
  anchor.href = "/manage/%ZZ";
  m.screen.shadowRoot!.append(anchor);
  const blockDefault = (event: MouseEvent) => event.preventDefault();
  document.addEventListener("click", blockDefault, { once: true });
  anchor.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
  );
  document.removeEventListener("click", blockDefault);
  await expect.poll(() => m.question.open).toBe(true);
  expect(location.pathname).toBe("/manage/profile");
  await choose(m, "discard");
  await expect.poll(() => location.pathname).toBe("/manage/my-schedule");
  expect(m.screen.isConnected).toBe(false);
  expect(unload()).toBe(false);
});

it.each(["same-app", "device"] as const)(
  "the actual demo bar %s link respects the edited profile's leave route",
  async (destination) => {
    const m = await mount({
      getMe: async () => ({
        personId: "p1",
        email: "ada@example.com",
        role: "manager",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Venue",
        permissions: [],
        modules: [],
        onboardingIntent: "prepare",
      }),
      getEmailInbox: async () => ({ mode: "unconfigured", count: 0, messages: [] }),
    });
    change(m, "123456");
    await m.screen.updateComplete;
    const bar = m.app.shadowRoot!.querySelector("wt-demo-bar")!;
    await bar.updateComplete;
    const link = bar.shadowRoot!.querySelector<HTMLAnchorElement>(
      destination === "device" ? 'a[href="/"]' : 'a[href="/manage/email"]',
    )!;
    expect(link).not.toBeNull();
    let browserDefault = false;
    const blockNavigation = (event: MouseEvent) => {
      browserDefault = !event.defaultPrevented;
      event.preventDefault();
    };
    const click = () => {
      document.addEventListener("click", blockNavigation, { once: true });
      try {
        link.dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
        );
      } finally {
        document.removeEventListener("click", blockNavigation);
      }
    };
    click();
    if (destination === "device") {
      expect(browserDefault).toBe(true);
      expect(m.question.open).toBe(false);
      expect(telephone(m)).toBe("123456");
      expect(unload()).toBe(true);
      expect(location.pathname).toBe("/manage/profile");
      return;
    }
    await expect.poll(() => m.question.open).toBe(true);
    expect(browserDefault).toBe(false);
    expect(location.pathname).toBe("/manage/profile");
    await choose(m, "keep");
    expect(telephone(m)).toBe("123456");
    expect(unload()).toBe(true);
    click();
    await expect.poll(() => m.question.open).toBe(true);
    await choose(m, "discard");
    await expect.poll(() => location.pathname).toBe("/manage/email");
    expect(m.screen.isConnected).toBe(false);
    expect(unload()).toBe(false);
  },
);

it.each([
  { use: { kind: "receipt" }, path: "/manage/venue-settings/view/receipts" },
  {
    use: { kind: "section", id: "section-one", internalName: "Lunch", ownerMenuId: "menu-one" },
    path: "/manage/menus/menu/menu-one/view/structure",
  },
  {
    use: {
      kind: "product",
      id: "product-one",
      catalogueId: "catalogue-one",
      name: "Staff bread",
      active: true,
    },
    path: "/manage/catalogue/product/product-one",
  },
  { use: { kind: "included-menu" }, path: "/manage/menus/menu/menu-two/view/structure" },
  { use: { kind: "menu-preview" }, path: "/manage/menus/menu/menu-one/view/preview" },
  { use: { kind: "routing-device" }, path: "/manage/devices" },
  { use: { kind: "routing-watcher" }, path: "/manage/prep-stations/view/watchers" },
] as const)(
  "the rendered $use.kind link asks before leaving actual edited profile input",
  async ({ use, path }) => {
    const image = {
      id: "image-one",
      filename: "one.png",
      names: { en: "Bread" },
      createdAt: "2026-10-06T10:00:00Z",
      updatedAt: "2026-10-06T10:00:00Z",
      usageCount: 1,
    };
    const m = await mount(
      {
        getMe: async () => ({
          personId: "p1",
          email: "ada@example.com",
          role: "manager",
          locale: "en-GB",
          venueLocale: "en-GB",
          sessionDefault: "en-GB",
          venueName: "Venue",
          permissions: [
            "image.manage",
            "venue.view",
            "venue.configure",
            "product.manage",
            "venue_service.manage",
            "device.manage",
          ],
          modules: ["media", "venue-service"],
        }),
        listCatalogues: async () => [
          { id: "menu-one", name: "Lunch", active: true, version: 1 },
          { id: "menu-two", name: "Dinner", active: true, version: 1 },
        ],
        listLibraryProducts: async () => [],
        listProducts: async () => [],
        listCategories: async () => [],
        getMenuStatuses: async () => ({ "menu-one": { state: "unpublished", clashes: 0 } }),
        getMenuStatus: async () => ({
          state: "changed",
          clashes: 0,
          version: 1,
          publishedAt: "2026-10-06T10:00:00Z",
          hash: "menu-hash",
        }),
        getMenuStructure: async () => ({
          rootSectionId: "root",
          root: {
            id: "root",
            internalName: "Lunch",
            names: {},
            image: null,
            color: null,
            members: [],
          },
          nodes: [],
          includable: [],
          includedBy: [{ id: "menu-two", name: "Dinner" }],
        }),
        getProductEditor: async () => {
          throw { code: "product.not_found" };
        },
        getReceipt: async () => ({ receipt: {}, venueAddress: [] }),
        getLocationSettings: async () => ({ name: "Venue", operationDescription: "Sale" }),
        getReceiptLanguage: async () => ({ language: "en-GB", choices: ["en-GB"], fixed: null }),
        getVenueDepartments: async () => [],
      },
      async (url) => {
        if (url === "/management-api/images/image-one") return { image, uses: [use] } as never;
        if (url.startsWith("/management-api/images?"))
          return { images: [image], total: 1 } as never;
        if (url === "/management-api/venue-service/routing")
          return {
            zones: [],
            categories: [],
            products: [],
            cells: [],
            canMakeDefault: false,
            defaultStationId: "bar",
            stations: [{ id: "bar", name: "Bar", active: true }],
            stationTimes: [],
            todayEnds: { timeOfDay: "06:00", tomorrow: true },
            clockReadable: true,
          } as never;
        if (url === "/management-api/stations?includeDisabled=true")
          return [
            {
              id: "bar",
              name: "Bar",
              active: true,
              isDefault: true,
              displayOrder: 0,
              warmAfterMinutes: 5,
              overdueAfterMinutes: 10,
              forgottenAfterMinutes: 15,
              timingDefaults: {
                warmAfterMinutes: 5,
                overdueAfterMinutes: 10,
                forgottenAfterMinutes: 15,
              },
              timingOverrides: {
                warmAfterMinutes: null,
                overdueAfterMinutes: null,
                forgottenAfterMinutes: null,
              },
              showsRestOfOrder: false,
            },
          ] as never;
        if (url === "/management-api/stations/health")
          return {
            capturedAt: "2026-10-06T10:00:00Z",
            stations: [],
            outputsDown: { printersDown: [], screensDark: [] },
          } as never;
        if (url === "/management-api/stations/outputs-down")
          return { printersDown: [], screensDark: [] } as never;
        if (
          [
            "/management-api/categories",
            "/management-api/zones",
            "/management-api/products",
            "/management-api/printers",
            "/management-api/devices",
            "/management-api/watchers?includeDisabled=true",
            "/management-api/stations/bar/printers",
          ].includes(url)
        )
          return [] as never;
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    let link: HTMLAnchorElement;
    if (use.kind === "routing-device" || use.kind === "routing-watcher") {
      await navigationGuardFor(window)!.write("/manage/prep-stations/view/tickets");
      await expect
        .poll(() =>
          m.app
            .shadowRoot!.querySelector("dashboard-prep-stations-screen")
            ?.shadowRoot?.querySelector("[data-test=tickets-table]"),
        )
        .not.toBeNull();
      const prep = m.app.shadowRoot!.querySelector("dashboard-prep-stations-screen")!;
      const table = prep.shadowRoot!.querySelector("wt-data-table")!;
      await expect.poll(() => table.shadowRoot!.querySelector(`a[href="${path}"]`)).not.toBeNull();
      link = table.shadowRoot!.querySelector<HTMLAnchorElement>(`a[href="${path}"]`)!;
    } else if (use.kind === "included-menu" || use.kind === "menu-preview") {
      await navigationGuardFor(window)!.write("/manage/menus/menu/menu-one/view/structure");
      await expect
        .poll(() => m.app.shadowRoot!.querySelector("dashboard-menus-screen"))
        .not.toBeNull();
      const menus = m.app.shadowRoot!.querySelector("dashboard-menus-screen")!;
      const selector =
        use.kind === "included-menu" ? "[data-test=included-by] a" : "[data-test=status-changes]";
      await expect.poll(() => menus.shadowRoot!.querySelector(selector)).not.toBeNull();
      link = menus.shadowRoot!.querySelector<HTMLAnchorElement>(selector)!;
    } else {
      await navigationGuardFor(window)!.write("/manage/images");
      await expect
        .poll(() => m.app.shadowRoot!.querySelector("dashboard-image-library"))
        .not.toBeNull();
      const library = m.app.shadowRoot!.querySelector("dashboard-image-library")!;
      await expect
        .poll(() => library.shadowRoot!.querySelector("[data-test=preview-image-one]"))
        .not.toBeNull();
      library.shadowRoot!.querySelector<HTMLElement>("[data-test=preview-image-one]")!.click();
      await expect.poll(() => library.shadowRoot!.querySelector("wt-modal .uses a")).not.toBeNull();
      link = library.shadowRoot!.querySelector<HTMLAnchorElement>("wt-modal .uses a")!;
    }
    const source = m.app.shadowRoot!.querySelector(".body")!.firstElementChild!;
    expect(link.pathname).toBe(path);
    m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=profile]")!.click();
    await expect
      .poll(() =>
        m.app
          .shadowRoot!.querySelector("dashboard-profile-screen")
          ?.shadowRoot?.querySelector("wt-tabs"),
      )
      .not.toBeNull();
    const screen = m.app.shadowRoot!.querySelector("dashboard-profile-screen")!;
    m.app.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-profile-details]")!.click();
    await screen.updateComplete;
    const field = screen.shadowRoot!.querySelector<WtInput>("wt-input[name=telephone]")!;
    field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "654321" } }));
    await screen.updateComplete;
    const click = () =>
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
      );
    click();
    await expect.poll(() => m.question.open).toBe(true);
    expect(location.pathname).toBe(
      use.kind === "included-menu" || use.kind === "menu-preview"
        ? "/manage/profile/view/structure"
        : use.kind === "routing-device" || use.kind === "routing-watcher"
          ? "/manage/profile/view/tickets"
          : "/manage/profile",
    );
    await choose(m, "keep");
    expect(field.value).toBe("654321");
    expect(source.isConnected).toBe(true);
    expect(unload()).toBe(true);
    click();
    await expect.poll(() => m.question.open).toBe(true);
    await choose(m, "discard");
    await expect.poll(() => location.pathname).toBe(path);
    expect(screen.isConnected).toBe(false);
    expect(unload()).toBe(false);
  },
);

describe("a product swatch link under the app's link router", () => {
  async function swatch(busy: boolean, open?: () => void) {
    const m = await mount({
      getMe: async () => ({
        personId: "p1",
        email: "ada@example.com",
        role: "manager",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Venue",
        permissions: ["product.manage"],
        modules: [],
      }),
    });
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" });
    m.screen.shadowRoot!.append(host);
    render(
      productMedia({
        key: "probe",
        name: "Probe",
        image: null,
        color: null,
        busy,
        ...(open ? { open } : {}),
      }),
      host.shadowRoot!,
    );
    const anchor = host.shadowRoot!.querySelector("a")!;
    let leaked = false;
    anchor.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      leaked = true;
      event.preventDefault();
    });
    const write = vi.spyOn(navigationGuardFor(window)!, "write");
    const event = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
    anchor.querySelector("span")!.dispatchEvent(event);
    return { m, event, write, leaked: () => leaked };
  }

  it("does nothing when busy: the browser does not follow it and the app does not route it", async () => {
    const { event, write, leaked } = await swatch(true);
    expect(event.defaultPrevented).toBe(true);
    expect(leaked()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/manage/profile");
  });

  it("opens the product's Edit in place when the list gives it a way to, without routing", async () => {
    const open = vi.fn();
    const { event, write, leaked } = await swatch(false, open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(leaked()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/manage/profile");
  });

  it("is routed in the app to the product's Edit when nothing opens it in place", async () => {
    const { event, write, leaked } = await swatch(false);
    expect(event.defaultPrevented).toBe(true);
    expect(leaked()).toBe(false);
    expect(write).toHaveBeenCalled();
    const url = new URL(String(write.mock.calls[0]![0]));
    expect(`${url.pathname}${url.search}`).toBe("/manage/catalogue/product/probe?field=image");
    await expect.poll(() => location.pathname).toBe("/manage/catalogue/product/probe");
  });
});

describe("a price override row's Edit product link under the app's link router", () => {
  const burger: MenuPriceRow = {
    menuItemId: "mi-burger",
    combined: combinedFixture("p-burger", "12.00", [], null, "12.00", {}),
    productId: "p-burger",
    name: "Burger",
    categoryId: null,
    placements: [[]],
    override: null,
    effectivePrice: "12.00",
    active: true,
    available: true,
    variants: [],
  };
  const lemonade: MenuPriceRow = {
    menuItemId: "mi-lemonade",
    combined: combinedFixture(
      "p-lemonade",
      "2.50",
      [{ variantId: "v-large", price: null }],
      null,
      "2.50",
      { "v-large": "3.40" },
    ),
    productId: "p-lemonade",
    name: "Lemonade",
    categoryId: null,
    placements: [[]],
    override: null,
    effectivePrice: "2.50",
    active: true,
    available: true,
    variants: [{ variantId: "v-large", price: null, active: true, available: true }],
  };
  const lemonadeProduct = {
    id: "p-lemonade",
    name: "Lemonade",
    variants: [{ id: "v-large", name: "Large", unitPrice: "3.40", available: true }],
  } as unknown as Product;

  it.each([
    ["mi-burger", "p-burger"],
    ["mi-lemonade:v-large", "v-large"],
  ])("is routed in the app to the editor: %s opens %s", async (key, id) => {
    const m = await mount({
      getMe: async () => ({
        personId: "p1",
        email: "ada@example.com",
        role: "manager",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Venue",
        permissions: ["product.manage"],
        modules: [],
      }),
    });
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" });
    m.screen.shadowRoot!.append(host);
    const prices = document.createElement("dashboard-menu-prices-table") as MenuPricesTable;
    prices.rows = [burger, lemonade];
    prices.products = [lemonadeProduct];
    prices.menuName = "Lunch";
    host.shadowRoot!.append(prices);
    await prices.updateComplete;
    const table = prices.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    if (key.includes(":")) {
      table
        .shadowRoot!.querySelector<HTMLButtonElement>(
          'tr[data-row-key="mi-lemonade"] button.tree-toggle',
        )!
        .click();
      await table.updateComplete;
    }
    const menu = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      `tr[data-row-key="${key}"] td[data-pinned="end"] wt-row-actions`,
    )!;
    menu.show();
    const link = menu.querySelector<HTMLAnchorElement>(`a[data-test="edit-product-${key}"]`)!;
    let leaked = false;
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      leaked = true;
      event.preventDefault();
    });
    const write = vi.spyOn(navigationGuardFor(window)!, "write");
    const event = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(leaked).toBe(false);
    // The first write is the link's; the app then rewrites the same address in place.
    expect(write).toHaveBeenCalled();
    expect(new URL(String(write.mock.calls[0]![0])).pathname).toBe(
      `/manage/catalogue/product/${id}`,
    );
    await expect.poll(() => location.pathname).toBe(`/manage/catalogue/product/${id}`);
    expect(m.app.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
  });
});

describe("a Structure tab product row's Edit product link under the app's link router", () => {
  it("is routed in the app to that product's editor", async () => {
    const m = await mount({
      getMe: async () => ({
        personId: "p1",
        email: "ada@example.com",
        role: "manager",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Venue",
        permissions: ["product.manage"],
        modules: [],
      }),
    });
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" });
    m.screen.shadowRoot!.append(host);
    const tree = document.createElement("dashboard-menu-structure-table") as MenuStructureTable;
    tree.nodes = [{ memberId: "m-burger", ref: { kind: "product", productId: "p-burger" } }];
    tree.products = [{ id: "p-burger", name: "Burger", image: null, available: true } as Product];
    tree.menuName = "Lunch";
    host.shadowRoot!.append(tree);
    await tree.updateComplete;
    const table = tree.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const menu = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="actions-m-burger"]',
    )!;
    menu.show();
    const link = menu.querySelector<HTMLAnchorElement>('a[data-test="edit-product-m-burger"]')!;
    let leaked = false;
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      leaked = true;
      event.preventDefault();
    });
    const write = vi.spyOn(navigationGuardFor(window)!, "write");
    const event = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(leaked).toBe(false);
    expect(write).toHaveBeenCalled();
    expect(new URL(String(write.mock.calls[0]![0])).pathname).toBe(
      "/manage/catalogue/product/p-burger",
    );
    await expect.poll(() => location.pathname).toBe("/manage/catalogue/product/p-burger");
    expect(m.app.shadowRoot!.querySelector("dashboard-catalogue-screen")).not.toBeNull();
  });
});
