import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequest, LiveData, type FetchLike } from "@waitron/dashboard-kit";
import { leaveCoordinatorFor } from "@waitron/ui";
import { DashboardApi, type ServerListing } from "./api/client.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import { codeMessage } from "./i18n/codes.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { LoginScreen } from "./screens/login-screen.js";
import type { ServersScreen } from "./screens/servers-screen.js";
import { createSessionEpoch, createSessionSignals } from "./session-signals.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

// A box replaced by a handover answers every /management-api request with this refusal
// (apps/server/src/restricted-start.ts), and serves its own page at every dashboard address.
const STEPPING_DOWN = { error: { code: "handover.stepping_down", params: {} } };

const original = { locale: currentLocale(), path: location.href };
beforeEach(() => {
  setLocale("en-GB");
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = async () => false;
    },
  );
});
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  setLocale(original.locale);
  history.replaceState(null, "", original.path);
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ME = {
  personId: "owner",
  roleIds: ["manager"],
  email: "owner@example.test",
  locale: "en-GB",
  venueLocale: "en-GB",
  sessionDefault: "en-GB",
  venueName: "Test venue",
  modules: [],
  permissions: ["venue.view"],
  sessionExpiresInSeconds: 1800,
  sessionIdleTimeoutSeconds: 1800,
};

/** The box the dashboard talks to, through the same request, signal and epoch wiring as `main.ts`. */
function box(options: { signedIn?: boolean } = {}) {
  const state = {
    signedIn: options.signedIn ?? false,
    /** Set once the box has been replaced: from then on every /management-api request is refused. */
    replaced: false,
    refused: new Set<string>(),
    /** Paths that fail for a reason that has nothing to do with the box being replaced. */
    failing: new Set<string>(),
  };
  const fetchImpl: FetchLike = async (path) => {
    if ((state.replaced && path.startsWith("/management-api/")) || state.refused.has(path))
      return json(STEPPING_DOWN, 503);
    if (state.failing.has(path)) return json({ error: { code: "server.internal" } }, 500);
    switch (path) {
      case "/management-api/session/me":
        return state.signedIn
          ? json(ME)
          : json({ error: { code: "management_session.required" } }, 401);
      case "/management-api/locales":
        return json({
          locales: [{ code: "en-GB", label: "English" }],
          venueDefault: "en-GB",
          loginDefault: "en-GB",
          venueName: "Test venue",
        });
      case "/management-api/google/config":
        return json({ configured: true });
      case "/legal/about":
        return json({ release: null, build: "test" });
      case "/api/theme":
        return json({ hash: "waitron", css: "", logo: null });
      case "/api/content-languages":
        return json({ defaultLanguage: "en", languages: ["en"] });
      case "/management-api/alerts":
        return json({ visible: false, alerts: [] });
      case "/management-api/disk-stop":
        return json({ stopped: false, deleted: null });
      default:
        return json({ error: { code: "test.unrouted" } }, 404);
    }
  };
  return { state, fetchImpl };
}

async function mountDashboard(fetchImpl: FetchLike) {
  const epoch = createSessionEpoch();
  const signals = createSessionSignals({ sessionGeneration: epoch.current });
  const api = new DashboardApi("", fetchImpl, signals.reportError, signals.reportActivity, false, {
    sessionGeneration: epoch.current,
  });
  const reload = vi.fn();
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api,
    sessionEpoch: epoch,
    reload,
    request: createRequest({
      fetchImpl,
      onError: signals.reportError,
      onSuccess: signals.reportActivity,
      sessionGeneration: epoch.current,
    }),
  });
  return { el, reload };
}

async function settle(el: DashboardApp): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

async function signInScreen(el: DashboardApp): Promise<LoginScreen> {
  let login: LoginScreen | null = null;
  await vi.waitFor(() => {
    login = el.shadowRoot!.querySelector<LoginScreen>("dashboard-login-screen");
    expect(login).not.toBeNull();
  });
  await settle(el);
  return login!;
}

async function atPassword(login: LoginScreen): Promise<void> {
  Object.assign(login as unknown as Record<string, string>, {
    email: "owner@example.test",
    step: "password",
  });
  await login.updateComplete;
}

function click(login: LoginScreen, test: string): void {
  login.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!.click();
}

/** Every text the page shows, through its components' own shadow roots. */
function shownText(root: Node): string {
  let text = "";
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    if (node instanceof Element && node.shadowRoot) walk(node.shadowRoot);
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return text;
}

const refusalShown = (el: DashboardApp) =>
  shownText(el).includes(codeMessage("handover.stepping_down"));

describe("dashboard: a box that no longer runs the venue, on the sign-in screen", () => {
  it("reloads once, showing no refusal, when Reset by email is refused", async () => {
    const { state, fetchImpl } = box();
    const { el, reload } = await mountDashboard(fetchImpl);
    const login = await signInScreen(el);
    await atPassword(login);
    state.replaced = true;
    click(login, "reset-by-email");
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
    expect(refusalShown(el)).toBe(false);
  });

  it("reloads once, showing no refusal, when a password sign-in is refused", async () => {
    const { state, fetchImpl } = box();
    const { el, reload } = await mountDashboard(fetchImpl);
    const login = await signInScreen(el);
    await atPassword(login);
    login
      .shadowRoot!.querySelector("wt-input[name=password]")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "correct horse battery" } }));
    await login.updateComplete;
    state.replaced = true;
    click(login, "submit");
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
    expect(refusalShown(el)).toBe(false);
  });

  it("reloads once, showing no refusal, when a passkey sign-in is refused", async () => {
    const { state, fetchImpl } = box();
    const { el, reload } = await mountDashboard(fetchImpl);
    const login = await signInScreen(el);
    await atPassword(login);
    state.replaced = true;
    click(login, "passkey-login");
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
    expect(refusalShown(el)).toBe(false);
  });

  it("reloads once, showing no refusal, when a Google start is refused", async () => {
    const { state, fetchImpl } = box();
    const { el, reload } = await mountDashboard(fetchImpl);
    const login = await signInScreen(el);
    await atPassword(login);
    state.replaced = true;
    click(login, "google-login");
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
    expect(refusalShown(el)).toBe(false);
  });

  it("reloads once when every read the page makes on opening is refused", async () => {
    const { state, fetchImpl } = box();
    state.replaced = true;
    const { el, reload } = await mountDashboard(fetchImpl);
    await settle(el);
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
    expect(refusalShown(el)).toBe(false);
  });

  it("reloads once, showing no refusal, when an account link's check is refused", async () => {
    history.replaceState(null, "", "/account?token=token-1&purpose=invitation");
    const { state, fetchImpl } = box();
    state.refused.add("/management-api/account-actions/inspect");
    const { el, reload } = await mountDashboard(fetchImpl);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
    expect(refusalShown(el)).toBe(false);
  });

  it("does not reload for a refusal that is not about the box", async () => {
    const { state, fetchImpl } = box();
    const { el, reload } = await mountDashboard(fetchImpl);
    const login = await signInScreen(el);
    await atPassword(login);
    state.failing.add("/management-api/password-reset");
    click(login, "reset-by-email");
    await settle(el);
    expect(reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(shownText(el)).toContain(codeMessage("server.internal")));
  });
});

describe("dashboard: a box that no longer runs the venue, while signed in", () => {
  it("reloads once when the box is replaced under an open, signed-in page", async () => {
    const { state, fetchImpl } = box({ signedIn: true });
    const { el, reload } = await mountDashboard(fetchImpl);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("dashboard-overview-screen")).not.toBeNull(),
    );
    await settle(el);
    expect(reload).not.toHaveBeenCalled();
    state.replaced = true;
    // The person comes back to the tab: the shell reads its session again.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle(el);
    // A module screen's own request, through the shell's request primitive, as well.
    await expect(el.request("/management-api/some-module/read", "GET")).rejects.toMatchObject({
      code: "handover.stepping_down",
    });
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
    expect(refusalShown(el)).toBe(false);
  });
  it("drops an unsaved draft before reloading, so the browser asks nothing and the reload goes ahead", async () => {
    const { state, fetchImpl } = box({ signedIn: true });
    const { el, reload } = await mountDashboard(fetchImpl);
    let overview: HTMLElement | null = null;
    await vi.waitFor(() => {
      overview = el.shadowRoot!.querySelector<HTMLElement>("dashboard-overview-screen");
      expect(overview).not.toBeNull();
    });
    await settle(el);
    let value = "saved";
    const scope = leaveCoordinatorFor(overview!)!.register({
      id: overview!,
      current: () => value,
      snapshot: (draft) => draft,
      equal: (a, b) => a === b,
      restore: (draft) => {
        value = draft;
      },
    });
    value = "edited";
    scope.changed();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(true);
    state.replaced = true;
    await expect(el.request("/management-api/some-module/read", "GET")).rejects.toMatchObject({
      code: "handover.stepping_down",
    });
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
    expect(unload()).toBe(false);
  });
});

describe("dashboard: reloading for a replaced box never loops", () => {
  it("a page loaded straight after that reload shows the refusal instead of reloading again", async () => {
    const first = box();
    first.state.replaced = true;
    const { el: before, reload: firstReload } = await mountDashboard(first.fetchImpl);
    await vi.waitFor(() => expect(firstReload).toHaveBeenCalledOnce());
    await settle(before);
    cleanupWidgets();

    // The reload came back to the dashboard (a box only does this when something in front of it
    // serves the dashboard's files), and the box still refuses.
    const second = box();
    const { el, reload } = await mountDashboard(second.fetchImpl);
    const login = await signInScreen(el);
    await atPassword(login);
    second.state.replaced = true;
    click(login, "reset-by-email");
    await settle(el);
    expect(reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(refusalShown(el)).toBe(true));
  });

  it("still reloads only once when the browser refuses session storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    const { state, fetchImpl } = box({ signedIn: true });
    const { el, reload } = await mountDashboard(fetchImpl);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("dashboard-overview-screen")).not.toBeNull(),
    );
    state.replaced = true;
    for (const path of ["/management-api/one", "/management-api/two"])
      await expect(el.request(path, "GET")).rejects.toMatchObject({
        code: "handover.stepping_down",
      });
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads again once the earlier reload is a minute old", async () => {
    const first = box();
    first.state.replaced = true;
    const { reload: firstReload } = await mountDashboard(first.fetchImpl);
    await vi.waitFor(() => expect(firstReload).toHaveBeenCalledOnce());
    cleanupWidgets();

    const later = Date.now() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    const second = box();
    second.state.replaced = true;
    const { reload } = await mountDashboard(second.fetchImpl);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });
});

describe("dashboard: a planned handover started from this page", () => {
  const listing: ServerListing = {
    term: 2,
    nodes: [
      {
        nodeId: "old",
        contactUrl: "https://old.example",
        standing: "serving-primary",
        isSelf: true,
        removable: false,
        canClear: false,
        requiresRetirementConfirmation: false,
        returnOutstanding: false,
        needsResetStatement: false,
        reset: null,
        canReset: false,
        canWipeWithLoss: false,
        returnScenario: null,
        recoveredRecordsBackup: null,
      },
      {
        nodeId: "new",
        contactUrl: "https://new.example",
        standing: "serving-secondary",
        isSelf: false,
        removable: true,
        canClear: false,
        requiresRetirementConfirmation: false,
        returnOutstanding: false,
        needsResetStatement: false,
        reset: null,
        canReset: false,
        canWipeWithLoss: false,
        returnScenario: null,
        recoveredRecordsBackup: null,
      },
    ],
  };
  const steppingDown = () =>
    window.dispatchEvent(
      new CustomEvent("waitron-session-invalid", { detail: { code: "handover.stepping_down" } }),
    );

  async function serversPage(reset = false) {
    let down = false;
    let answer!: (value: { handoverPage: string }) => void;
    const startHandover = vi.fn(
      () =>
        new Promise<{ handoverPage: string }>((resolve) => {
          answer = resolve;
        }),
    );
    const api = {
      liveData: new LiveData(),
      getMe: async () => {
        if (down) throw new Error("box restarting");
        return { ...ME, permissions: ["venue.view", "node.manage"], onboardingIntent: "demo" };
      },
      getGoogleConfig: async () => ({ configured: false }),
      getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
      getLegalAbout: async () => ({ release: null, build: "test" }),
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      getLocales: async () => ({
        locales: [{ code: "en-GB", label: "English" }],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
        venueName: "Test venue",
      }),
      listAlerts: async () => ({ visible: false, alerts: [] }),
      getDiskStop: async () => ({ stopped: false, deleted: null }),
      listServers: async () =>
        reset ? { term: 0, nodes: [listing.nodes[0]], resetThisBox: "available" } : listing,
      resetThisBox: async () => ({ setupUrl: `${location.href}#setup` }),
      forgetLocales: () => {},
      getProfile: async () => ({
        displayName: "Owner",
        firstNames: null,
        lastNames: null,
        telephone: null,
        email: "owner@example.test",
        pendingEmail: null,
        locale: "en",
        hasPassword: true,
        hasTotp: true,
        hasGoogle: false,
        passkeys: [],
      }),
      startHandover,
    } as unknown as DashboardApi;
    Object.defineProperty(api, "background", { get: () => api });
    history.replaceState(null, "", "/servers");
    const reload = vi.fn();
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api,
      reload,
      request: vi.fn(async () => {
        throw new Error("Unexpected module request");
      }),
    });
    let screen!: ServersScreen;
    await vi.waitFor(() => {
      screen = el.shadowRoot!.querySelector<ServersScreen>("dashboard-servers-screen")!;
      expect(
        screen
          .shadowRoot!.querySelector("wt-data-table")!
          .shadowRoot!.querySelector(
            reset ? '[data-test="reset-this-box"]' : '[data-test="handover-new"]',
          ),
      ).not.toBeNull();
    });
    return {
      el,
      screen,
      reload,
      startHandover,
      boxDown: () => {
        down = true;
      },
      answer: (url: string) => answer({ handoverPage: url }),
    };
  }

  it.each(["node.reset", "visibilitychange"])(
    "opens Setup after reset despite %s",
    async (interruption) => {
      let setupReady = false;
      vi.stubGlobal("fetch", async () => json({ provisioned: !setupReady }));
      const { el, screen, boxDown } = await serversPage(true);
      const table = screen.shadowRoot!.querySelector("wt-data-table")!;
      table.shadowRoot!.querySelector<HTMLElement>("[data-test=reset-this-box]")!.click();
      await vi.waitFor(() =>
        expect(screen.shadowRoot!.querySelector("dashboard-reset-this-box-dialog")).not.toBeNull(),
      );
      const root = screen.shadowRoot!.querySelector("dashboard-reset-this-box-dialog")!.shadowRoot!;
      root
        .querySelector("wt-input")!
        .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "reset" } }));
      await vi.waitFor(() =>
        expect(root.querySelector("wt-button:not([slot])")?.hasAttribute("disabled")).toBe(false),
      );
      root.querySelector<HTMLElement>("wt-button:not([slot])")!.click();
      await vi.waitFor(() => expect(root.querySelector("[role=status]")).not.toBeNull());
      boxDown();
      if (interruption === "node.reset") {
        window.dispatchEvent(
          new CustomEvent("waitron-session-invalid", { detail: { code: interruption } }),
        );
      } else {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
        document.dispatchEvent(new Event(interruption));
      }
      await settle(el);
      expect(screen.isConnected).toBe(true);
      setupReady = true;
      await vi.waitFor(() => expect(location.hash).toBe("#setup"), { timeout: 4000 });
    },
  );

  async function startHandover(screen: ServersScreen): Promise<void> {
    screen
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>('[data-test="handover-new"]')!
      .click();
    let confirm!: HTMLElement & { disabled: boolean };
    await vi.waitFor(() => {
      confirm = screen.shadowRoot!.querySelector("[data-test=confirm-handover]")!;
      expect(confirm.disabled).toBe(false);
    });
    confirm.click();
  }

  it("is not reloaded away while the handover it started is under way, nor once it heads for the handover page", async () => {
    const { el, screen, reload, startHandover: start, answer } = await serversPage();
    await startHandover(screen);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    // The box closes its doors as part of the handover this page asked for, so other reads are
    // refused before the start's own answer arrives.
    steppingDown();
    await settle(el);
    expect(reload).not.toHaveBeenCalled();
    const target = `${location.href}#handover-page`;
    answer(target);
    await vi.waitFor(() => expect(location.href).toBe(target));
    steppingDown();
    await settle(el);
    expect(reload).not.toHaveBeenCalled();
  });

  it("is reloaded when the box is replaced while no handover is being started from it", async () => {
    const { el, reload } = await serversPage();
    steppingDown();
    await settle(el);
    expect(reload).toHaveBeenCalledOnce();
  });
});
