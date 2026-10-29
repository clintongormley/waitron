import { html } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData, type DashboardModuleContext } from "@waitron/dashboard-kit";
import { draftScopeFor } from "@waitron/ui";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { LoginScreen } from "./screens/login-screen.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

const contexts: DashboardModuleContext[] = [];
vi.mock("@waitron/dashboard-modules", async (original) => ({
  ...(await original<typeof import("@waitron/dashboard-modules")>()),
  DASHBOARD_MODULES: [
    {
      module: "test-evidence",
      strings: {
        en: { "nav.test-evidence": "Evidence" },
        es: { "nav.test-evidence": "Evidencia" },
      },
      screen: {
        id: "test-evidence",
        navLabelKey: "nav.test-evidence",
        group: "service",
        requiresPermission: "system.manage",
        readPermission: "fiscal.view",
      },
      create(ctx: DashboardModuleContext) {
        contexts.push(ctx);
        return {
          render: () =>
            html`<p data-test="evidence-surface">Empty evidence surface</p>
              <wt-button
                data-test="evidence-sign-in"
                @click=${() => void ctx.permissionContinuation?.signIn({ permission: "system.manage", signal: new AbortController().signal })}
                >Sign in</wt-button
              >`,
        };
      },
    },
  ],
}));

const originalLocale = currentLocale();
beforeEach(() => {
  contexts.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en-GB");
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = async () => false;
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  setLocale(originalLocale);
});

function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function identity(permissions = ["fiscal.view"], personId = "reader") {
  return {
    personId,
    role: "manager" as const,
    email: `${personId}@example.test`,
    locale: "en-GB",
    venueLocale: "en-GB",
    sessionDefault: "en-GB",
    venueName: "Test venue",
    modules: ["test-evidence"],
    permissions,
    sessionExpiresInSeconds: 1800,
    sessionIdleTimeoutSeconds: 1800,
  };
}
async function mount(path = "/manage/test-evidence") {
  let me = identity();
  const getMe = vi.fn<DashboardApi["getMe"]>(async () => me);
  const login = vi.fn<DashboardApi["login"]>(async () => ({
    personId: "untrusted-login-detail",
    offerPasskey: true,
  }));
  const logout = vi.fn();
  const request = vi.fn(async () => ({}) as never);
  const api = {
    getMe,
    login,
    logout,
    liveData: new LiveData(),
    getGoogleConfig: async () => ({ configured: false }),
    getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    getLocales: async () => ({
      locales: [{ code: "en-GB", label: "English" }],
      venueDefault: "en-GB",
      loginDefault: "en-GB",
      venueName: "Test venue",
    }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getDiskStop: async () => ({ stopped: false, deleted: null }),
  } as unknown as DashboardApi;
  history.replaceState(null, "", path);
  const { el: app } = await mountWidget<DashboardApp>("dashboard-app", { api, request });
  await vi.waitFor(() =>
    expect(app.shadowRoot!.querySelector("[data-test=evidence-surface]")).not.toBeNull(),
  );
  const continuation = contexts.at(-1)!.permissionContinuation;
  expect(continuation).toBeDefined();
  return {
    app,
    api,
    getMe,
    login,
    logout,
    request,
    continuation: continuation!,
    setMe: (next: ReturnType<typeof identity>) => {
      me = next;
    },
  };
}
const loginScreen = (app: DashboardApp) =>
  app.shadowRoot!.querySelector<LoginScreen>("dashboard-login-screen")!;
const dialog = (app: DashboardApp) =>
  app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    "[data-test=permission-sign-in]",
  );
async function fillLogin(app: DashboardApp) {
  const screen = loginScreen(app);
  await vi.waitFor(() => expect(screen?.shadowRoot?.querySelector("[name=email]")).not.toBeNull());
  const email =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=email]")!;
  await email.updateComplete;
  await userEvent.fill(email.shadowRoot!.querySelector("input")!, "administrator@example.test");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
  await screen.updateComplete;
  const password =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=password]")!;
  await password.updateComplete;
  await userEvent.fill(password.shadowRoot!.querySelector("input")!, "synthetic-secret-731");
  await screen.updateComplete;
  return screen;
}
async function begin(h: Awaited<ReturnType<typeof mount>>) {
  const controller = new AbortController();
  const result = h.continuation.signIn({ permission: "system.manage", signal: controller.signal });
  await vi.waitFor(() => expect(dialog(h.app)?.open).toBe(true));
  return { controller, result };
}

it("gives a read-only module an explicit local sign-in and Stop preserves the current session/surface", async () => {
  const h = await mount();
  const before = h.continuation.snapshot();
  const { controller, result } = await begin(h);
  expect(h.continuation.snapshot().accountGeneration).toBeGreaterThan(before.accountGeneration);
  expect(dialog(h.app)!.textContent).toContain("dashboard account");
  controller.abort();
  await expect(result).resolves.toBe("stopped");
  await vi.waitFor(() => expect(dialog(h.app)).toBeNull());
  expect(h.continuation.snapshot()).toMatchObject({
    authenticated: true,
    permissions: ["fiscal.view"],
  });
  expect(h.app.shadowRoot!.querySelector("[data-test=evidence-surface]")).not.toBeNull();
  expect(h.logout).not.toHaveBeenCalled();
  expect(h.request).not.toHaveBeenCalled();
});

it("offers a visible keyboard Stop and ignores an old dialog close after reopening", async () => {
  const h = await mount();
  const first = await begin(h);
  const oldDialog = dialog(h.app)!;
  const stop = oldDialog.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=permission-stop]",
  )!;
  await stop.updateComplete;
  expect(stop.shadowRoot!.querySelector("button")!.checkVisibility()).toBe(true);
  await userEvent.click(stop.shadowRoot!.querySelector("button")!);
  await expect(first.result).resolves.toBe("stopped");
  await vi.waitFor(() => expect(dialog(h.app)).toBeNull());
  const second = await begin(h);
  oldDialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await h.app.updateComplete;
  expect(dialog(h.app)?.open).toBe(true);
  second.controller.abort();
  await expect(second.result).resolves.toBe("stopped");
});

it.each(["other-account", "same-account", "no-privilege"] as const)(
  "rebuilds %s rights from getMe and returns an empty fresh module without replay",
  async (kind) => {
    const h = await mount();
    const snapshots: unknown[] = [];
    const unsubscribe = h.continuation.subscribe((snapshot) => snapshots.push(snapshot));
    const { result } = await begin(h);
    const screen = await fillLogin(h.app);
    h.setMe(
      identity(
        kind === "no-privilege" ? ["fiscal.view"] : ["fiscal.view", "system.manage"],
        kind === "other-account" ? "administrator" : "reader",
      ),
    );
    const nativePassword = screen
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=password]")!
      .shadowRoot!.querySelector("input")!;
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await expect(result).resolves.toBe("signed-in");
    await vi.waitFor(() => expect(dialog(h.app)).toBeNull());
    expect(h.continuation.snapshot().permissions).toEqual(
      kind === "no-privilege" ? ["fiscal.view"] : ["fiscal.view", "system.manage"],
    );
    expect(contexts.length).toBeGreaterThan(1);
    expect(h.getMe).toHaveBeenLastCalledWith({ sessionErrors: "caller" });
    expect(nativePassword.value).toBe("");
    expect(h.logout).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
    expect(snapshots.length).toBeGreaterThan(1);
    unsubscribe();
  },
);

it.each(["success", "unavailable"] as const)(
  "Stop during a submitted password reconciles %s settlement without replay and blocks another authentication",
  async (outcome) => {
    const h = await mount();
    const submitted = held<{ personId: string; offerPasskey: boolean }>();
    h.login.mockImplementation(() => submitted.promise);
    const { controller, result } = await begin(h);
    const screen = await fillLogin(h.app);
    const passwordField =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=password]")!;
    const nativePassword = passwordField.shadowRoot!.querySelector("input")!;
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await vi.waitFor(() => expect(h.login).toHaveBeenCalledOnce());
    controller.abort();
    await expect(result).resolves.toBe("stopped");
    await passwordField.updateComplete;
    expect(nativePassword.value).toBe("");
    expect(h.continuation.snapshot().authenticated).toBe(false);
    expect(h.app.shadowRoot!.querySelector("[data-test=evidence-surface]")).toBeNull();
    await expect(
      h.continuation.signIn({ permission: "system.manage", signal: new AbortController().signal }),
    ).resolves.toBe("stopped");
    h.setMe(identity(["fiscal.view", "system.manage"], "actual-cookie-account"));
    if (outcome === "success")
      submitted.resolve({ personId: "discarded-login-event", offerPasskey: false });
    else submitted.reject({ code: "connection.failed" });
    await vi.waitFor(() => expect(h.continuation.snapshot().authenticated).toBe(true));
    expect(h.continuation.snapshot().permissions).toEqual(["fiscal.view", "system.manage"]);
    expect(dialog(h.app)).toBeNull();
    expect(h.logout).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  },
);

it("keeps protected content cleared when post-Stop reconciliation fails and offers Read again", async () => {
  const h = await mount();
  const submitted = held<{ personId: string; offerPasskey: boolean }>();
  h.login.mockImplementation(() => submitted.promise);
  const { controller } = await begin(h);
  const screen = await fillLogin(h.app);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
  await vi.waitFor(() => expect(h.login).toHaveBeenCalledOnce());
  controller.abort();
  h.getMe.mockRejectedValueOnce({ code: "connection.failed" });
  submitted.resolve({ personId: "discarded", offerPasskey: false });
  await vi.waitFor(() =>
    expect(h.app.shadowRoot!.querySelector("[data-test=permission-read-again]")).not.toBeNull(),
  );
  expect(h.continuation.snapshot().authenticated).toBe(false);
  expect(h.app.shadowRoot!.querySelector("[data-test=evidence-surface]")).toBeNull();
  h.setMe(identity(["fiscal.view", "system.manage"]));
  h.app.shadowRoot!.querySelector<HTMLElement>("[data-test=permission-read-again]")!.click();
  await vi.waitFor(() => expect(h.continuation.snapshot().authenticated).toBe(true));
  expect(h.request).not.toHaveBeenCalled();
});

it("a reset during submitted authentication prevents late reconciliation from restoring access", async () => {
  const h = await mount();
  const submitted = held<{ personId: string; offerPasskey: boolean }>();
  h.login.mockImplementation(() => submitted.promise);
  const { result } = await begin(h);
  const screen = await fillLogin(h.app);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
  await vi.waitFor(() => expect(h.login).toHaveBeenCalledOnce());
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "node.reset" } }),
  );
  await expect(result).resolves.toBe("stopped");
  const reads = h.getMe.mock.calls.length;
  h.setMe(identity(["fiscal.view", "system.manage"], "late"));
  submitted.resolve({ personId: "late", offerPasskey: false });
  await Promise.resolve();
  await Promise.resolve();
  await h.app.updateComplete;
  expect(h.continuation.snapshot().authenticated).toBe(false);
  expect(h.getMe).toHaveBeenCalledTimes(reads);
  expect(h.app.shadowRoot!.querySelector("[data-test=evidence-surface]")).toBeNull();
});

it("tracks an explicit passkey verification through Stop without cancelling its session write", async () => {
  const h = await mount();
  const submitted = held<{ personId: string }>();
  const verify = vi.fn(() => submitted.promise);
  h.api.passkeyAuthOptions = vi.fn(async () => ({
    challengeHandle: "synthetic-handle",
    options: { challenge: "AQID" },
  }));
  h.api.passkeyAuthVerify = verify;
  const getCredential = vi.spyOn(navigator.credentials, "get").mockResolvedValue({
    id: "synthetic-credential",
    rawId: new Uint8Array([1]).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: new Uint8Array([2]).buffer,
      authenticatorData: new Uint8Array([3]).buffer,
      signature: new Uint8Array([4]).buffer,
      userHandle: new Uint8Array([5]).buffer,
    },
    getClientExtensionResults: () => ({}),
    toJSON: () => ({}),
  } as unknown as PublicKeyCredential);
  const { controller, result } = await begin(h);
  const screen = await fillLogin(h.app);
  expect(getCredential).not.toHaveBeenCalled();
  await screen.updateComplete;
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
  await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce());
  controller.abort();
  await expect(result).resolves.toBe("stopped");
  expect(h.continuation.snapshot().authenticated).toBe(false);
  h.setMe(identity(["fiscal.view", "system.manage"], "passkey-account"));
  submitted.resolve({ personId: "discarded" });
  await vi.waitFor(() =>
    expect(h.continuation.snapshot().permissions).toEqual(["fiscal.view", "system.manage"]),
  );
  expect(dialog(h.app)).toBeNull();
  expect(h.request).not.toHaveBeenCalled();
  expect(h.logout).not.toHaveBeenCalled();
});

it("ignores old account expiry and activity events but never ignores node reset", async () => {
  const h = await mount();
  const old = h.continuation.snapshot().accountGeneration;
  const { result } = await begin(h);
  const screen = await fillLogin(h.app);
  h.setMe(identity(["fiscal.view", "system.manage"], "next"));
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
  await result;
  const deadline = localStorage.getItem("waitron-management-session-deadline");
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", {
      detail: { code: "management_session.expired", generation: old },
    }),
  );
  window.dispatchEvent(new CustomEvent("waitron-session-active", { detail: { generation: old } }));
  await h.app.updateComplete;
  expect(h.continuation.snapshot()).toMatchObject({
    authenticated: true,
    permissions: ["fiscal.view", "system.manage"],
  });
  expect(localStorage.getItem("waitron-management-session-deadline")).toBe(deadline);
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "node.reset", generation: old } }),
  );
  await vi.waitFor(() =>
    expect(h.app.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull(),
  );
  expect(h.continuation.snapshot().authenticated).toBe(false);
});

it("session invalidation never publishes cached authenticated rights in the new epoch", async () => {
  const h = await mount();
  const snapshots: ReturnType<typeof h.continuation.snapshot>[] = [];
  const unsubscribe = h.continuation.subscribe((snapshot) => snapshots.push(snapshot));
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", { detail: { code: "management_session.expired" } }),
  );
  expect(snapshots.length).toBeGreaterThan(0);
  expect(
    snapshots.every((snapshot) => !snapshot.authenticated && snapshot.permissions.length === 0),
  ).toBe(true);
  unsubscribe();
});

it("a disconnected shell publishes no usable rights to its module subscribers", async () => {
  const h = await mount();
  const snapshots: ReturnType<typeof h.continuation.snapshot>[] = [];
  h.continuation.subscribe((snapshot) => snapshots.push(snapshot));
  h.app.remove();
  expect(snapshots.length).toBeGreaterThan(0);
  expect(
    snapshots.every((snapshot) => !snapshot.authenticated && snapshot.permissions.length === 0),
  ).toBe(true);
});

it("a delayed old-account session probe cannot replace the new identity or surface", async () => {
  const h = await mount();
  const oldProbe = held<ReturnType<typeof identity>>();
  h.getMe.mockImplementationOnce(() => oldProbe.promise);
  document.dispatchEvent(new Event("visibilitychange"));
  const { result } = await begin(h);
  const screen = await fillLogin(h.app);
  h.setMe(identity(["fiscal.view", "system.manage"], "next"));
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
  await result;
  const epoch = h.continuation.snapshot().accountGeneration;
  oldProbe.resolve(identity(["fiscal.view"], "old"));
  await Promise.resolve();
  await h.app.updateComplete;
  expect(h.continuation.snapshot()).toEqual({
    accountGeneration: epoch,
    authenticated: true,
    permissions: ["fiscal.view", "system.manage"],
  });
  expect(h.app.shadowRoot!.querySelector("[data-test=evidence-surface]")).not.toBeNull();
});

it("a late old-account refusal cannot erase the current continuation's native password", async () => {
  const h = await mount();
  const old = h.continuation.snapshot().accountGeneration;
  const { controller, result } = await begin(h);
  const screen = await fillLogin(h.app);
  const password =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=password]")!;
  window.dispatchEvent(
    new CustomEvent("waitron-session-invalid", {
      detail: { code: "management_session.expired", generation: old },
    }),
  );
  await screen.updateComplete;
  expect(password.shadowRoot!.querySelector("input")!.value).toBe("synthetic-secret-731");
  expect(dialog(h.app)?.open).toBe(true);
  controller.abort();
  await expect(result).resolves.toBe("stopped");
});

it.each(["management_session.expired", "management_session.required", "person.suspended"])(
  "%s during continuation clears protected content and keeps sign-in at this surface",
  async (code) => {
    const h = await mount();
    const { controller, result } = await begin(h);
    window.dispatchEvent(
      new CustomEvent("waitron-session-invalid", {
        detail: {
          code,
          generation: h.continuation.snapshot().accountGeneration,
        },
      }),
    );
    await h.app.updateComplete;
    expect(dialog(h.app)?.open).toBe(true);
    expect(location.pathname).toBe("/manage/test-evidence");
    expect(h.continuation.snapshot().authenticated).toBe(false);
    expect(h.app.shadowRoot!.querySelector("[data-test=evidence-surface]")).toBeNull();
    controller.abort();
    await expect(result).resolves.toBe("stopped");
    await vi.waitFor(() => expect(dialog(h.app)).toBeNull());
    expect(h.app.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
    expect(h.logout).not.toHaveBeenCalled();
  },
);

it("same-account rights changes discard the previous screen instance and notify its epoch", async () => {
  const h = await mount();
  const previous = h.app.shadowRoot!.querySelector<HTMLElement>("[data-test=evidence-surface]")!;
  previous.textContent = "old account evidence";
  const epoch = h.continuation.snapshot().accountGeneration;
  h.setMe(identity(["fiscal.view", "system.manage"]));
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() =>
    expect(h.continuation.snapshot().accountGeneration).toBeGreaterThan(epoch),
  );
  await h.app.updateComplete;
  expect(h.app.shadowRoot!.querySelector("[data-test=evidence-surface]")!.textContent).toBe(
    "Empty evidence surface",
  );
  expect(previous.isConnected).toBe(false);
  expect(h.request).not.toHaveBeenCalled();
});

it("Stop before submission preserves the existing idle expiry instead of dropping or extending it", async () => {
  const h = await mount();
  vi.useFakeTimers();
  h.setMe({ ...identity(), sessionExpiresInSeconds: 300, sessionIdleTimeoutSeconds: 1800 });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(h.getMe).toHaveBeenCalledTimes(2));
  await h.app.updateComplete;
  const { controller, result } = await begin(h);
  controller.abort();
  await expect(result).resolves.toBe("stopped");
  expect(h.continuation.snapshot().authenticated).toBe(true);
  await vi.advanceTimersByTimeAsync(299_000);
  expect(h.continuation.snapshot().authenticated).toBe(true);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(h.continuation.snapshot().authenticated).toBe(false);
});

it("reconnects live updates for the preserved session's new epoch on sign-in start and Stop", async () => {
  const h = await mount();
  const live = { start: vi.fn(), stop: vi.fn() };
  h.app.liveUpdates = live;
  const { controller, result } = await begin(h);
  expect(live.start).toHaveBeenCalledOnce();
  controller.abort();
  await expect(result).resolves.toBe("stopped");
  expect(live.start).toHaveBeenCalledTimes(2);
  expect(live.stop).not.toHaveBeenCalled();
});

it("asks the leave coordinator about another edited form before opening login", async () => {
  const h = await mount();
  const owner = document.createElement("div");
  h.app.shadowRoot!.append(owner);
  let value = "saved";
  const { scope: draft } = draftScopeFor(owner, {
    id: owner,
    current: () => value,
    snapshot: (current) => current,
    equal: (a, b) => a === b,
    restore: (saved) => {
      value = saved;
    },
  });
  value = "edited";
  draft.changed();
  const result = h.continuation.signIn({
    permission: "system.manage",
    signal: new AbortController().signal,
  });
  await vi.waitFor(() =>
    expect(h.app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true),
  );
  expect(dialog(h.app)).toBeNull();
  h.app.shadowRoot!.querySelector("wt-unsaved-changes")!.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "keep" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect(result).resolves.toBe("stopped");
  expect(value).toBe("edited");
  draft.dispose();
});

it("Google carries only a nonsecret surface and returns to fresh server-derived content without replay", async () => {
  const h = await mount();
  h.api.getGoogleConfig = vi.fn(async () => ({ configured: true }));
  h.api.beginGoogleLogin = vi.fn(async () => ({
    authorizationUrl: "https://accounts.google.test/authorize",
  }));
  const { result } = await begin(h);
  const screen = loginScreen(h.app);
  const navigate = vi.fn();
  screen.navigate = navigate;
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-test=google-login]")).not.toBeNull(),
  );
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=google-login]")!.click();
  await vi.waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.test/authorize"),
  );
  const marker = sessionStorage.getItem("waitron-permission-return");
  expect(JSON.parse(marker!)).toEqual({ path: "/manage/test-evidence" });
  cleanupWidgets();
  await expect(result).resolves.toBe("stopped");
  const returned = await mount("/manage/?login=google");
  expect(location.pathname).toBe("/manage/test-evidence");
  expect(location.search).toBe("");
  expect(sessionStorage.getItem("waitron-permission-return")).toBeNull();
  expect(dialog(returned.app)).toBeNull();
  expect(returned.request).not.toHaveBeenCalled();
});
