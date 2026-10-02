import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { DashboardApi } from "../api/client.js";
import { LoginScreen } from "./login-screen.js";

// Keep the real WebAuthn library; stub only the hardware boundary so an earlier
// library import still reaches the stub when the operator starts the ceremony.
function passkeyCredential(id = "cred-abc"): PublicKeyCredential {
  return {
    id,
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
    toJSON: vi.fn(),
  } as PublicKeyCredential;
}

let conditionalMediationAvailable: ReturnType<typeof vi.fn>;
beforeEach(() => {
  conditionalMediationAvailable = vi.fn().mockResolvedValue(false);
  vi.stubGlobal(
    "PublicKeyCredential",
    class {
      static isConditionalMediationAvailable = conditionalMediationAvailable;
    },
  );
  vi.spyOn(navigator.credentials, "get").mockResolvedValue(passkeyCredential());
});

afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());
afterEach(() => vi.useRealTimers());
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    // Stubbed so "does not fetch the roster on connect" can show the screen never calls it.
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    passkeyOfferSeen: vi.fn().mockResolvedValue(undefined),
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    inspectAccountAction: vi.fn((_token, purpose) =>
      Promise.resolve({ email: "new@example.test", purpose }),
    ),
    completeAccountAction: vi.fn().mockResolvedValue({ personId: "p1", authenticated: true }),
    passkeyAuthOptions: vi
      .fn()
      .mockResolvedValue({ challengeHandle: "h1", options: { challenge: "AQID" } }),
    passkeyAuthVerify: vi.fn().mockResolvedValue({ personId: "p9" }),
    getGoogleConfig: vi.fn().mockResolvedValue({
      configured: true,
      privacyNoticeUrl: "https://restaurant.example/privacy",
    }),
    beginGoogleLogin: vi.fn().mockResolvedValue({
      authorizationUrl: "https://accounts.google.test/login",
    }),
    getLocales: vi
      .fn()
      .mockResolvedValue({ locales: [{ code: "en-GB", label: "English" }], venueDefault: "es-ES" }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: LoginScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function continueWithEmail(el: LoginScreen, email = "owner@x.com"): Promise<void> {
  (el as unknown as { email: string }).email = email;
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
  await el.updateComplete;
}

async function openPasskey(el: LoginScreen, email = "owner@x.com"): Promise<void> {
  Object.assign(el as unknown as Record<string, string>, { email, step: "passkey" });
  await el.updateComplete;
}

async function openPassword(el: LoginScreen, email = "owner@x.com"): Promise<void> {
  Object.assign(el as unknown as Record<string, string>, { email, step: "password" });
  await el.updateComplete;
}

async function openGoogle(el: LoginScreen, email = "owner@x.com"): Promise<void> {
  Object.assign(el as unknown as Record<string, string>, { email, step: "google" });
  await el.updateComplete;
}

function input(el: LoginScreen, name: string, value: string): void {
  el.shadowRoot!.querySelector(`wt-input[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}

/** The current form's one message about a failed submission: shown by the form itself above its
 * primary button, or else by its action row. */
async function bottomMessageOf(el: LoginScreen): Promise<Element | null> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions");
  await actions?.updateComplete;
  return (
    el.shadowRoot!.querySelector("[data-error]") ??
    actions?.shadowRoot!.querySelector("[data-error]") ??
    null
  );
}

/** The current form's one message about a failed submission; "" when there is none. */
async function bottomOf(el: LoginScreen): Promise<string> {
  return (await bottomMessageOf(el))?.textContent?.trim() ?? "";
}

async function mountPasskeyOffer(overrides: Partial<DashboardApi> = {}) {
  history.replaceState(null, "", "/manage/account?token=setup&purpose=invitation");
  const api = stubApi(overrides);
  const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
  await flush(el);
  input(el, "new-password", "new password");
  input(el, "new-pin", "4321");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!.click();
  await flush(el);
  return { el, api };
}

async function signInWithPassword(overrides: Partial<DashboardApi> = {}) {
  const api = stubApi(overrides);
  const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
  await flush(el);
  await openPassword(el, "clinton@example.com");
  input(el, "password", "correct horse battery");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
  await flush(el);
  return { el, api };
}

/** Pending until `release()`, which settles every call made meanwhile, so a test that provokes a
 * second call does not hang on it. */
function pendingOfferSeen() {
  const pending: Array<() => void> = [];
  return {
    passkeyOfferSeen: vi.fn(
      () =>
        new Promise<void>((done) => {
          pending.push(() => done());
        }),
    ),
    release: () => {
      for (const done of pending) done();
    },
  };
}

function passkeyRegistrationStubs(): Partial<DashboardApi> {
  vi.spyOn(navigator.credentials, "create").mockResolvedValue({
    id: "new-key",
    rawId: new Uint8Array([1]).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: new Uint8Array([2]).buffer,
      attestationObject: new Uint8Array([3]).buffer,
      getTransports: () => ["internal"],
    },
    getClientExtensionResults: () => ({}),
  } as unknown as PublicKeyCredential);
  return {
    passkeyRegisterOptions: vi.fn().mockResolvedValue({
      challengeHandle: "register",
      options: {
        challenge: "AQID",
        rp: { name: "Waitron", id: "localhost" },
        user: { id: "BAUG", name: "clinton@example.com", displayName: "Clinton" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      },
    }),
    passkeyRegisterVerify: vi.fn().mockResolvedValue({ credentialId: "new-key" }),
  } as unknown as Partial<DashboardApi>;
}

describe("login-screen", () => {
  it("keeps an opted-in account when cancelling someone else's setup link", async () => {
    const saved = JSON.stringify({ email: "saved@example.test", method: "password" });
    localStorage.setItem("waitron-login-preference", saved);
    history.replaceState(null, "", "/manage/account?token=setup&purpose=invitation");
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-account-action]")!.click();
    await flush(el);
    expect(localStorage.getItem("waitron-login-preference")).toBe(saved);
  });

  it("keeps an opted-in account while completing someone else's setup link", async () => {
    const saved = JSON.stringify({ email: "saved@example.test", method: "password" });
    localStorage.setItem("waitron-login-preference", saved);
    const { el } = await mountPasskeyOffer();
    expect(localStorage.getItem("waitron-login-preference")).toBe(saved);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
    await flush(el);
    expect(localStorage.getItem("waitron-login-preference")).toBe(saved);
  });

  it("restarts passive passkey autofill after changing away from a remembered account", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    vi.mocked(navigator.credentials.get).mockImplementation(() => new Promise(() => undefined));
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "saved@example.test", method: "password" }),
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    expect(navigator.credentials.get).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
    await flush(el);
    expect(navigator.credentials.get).toHaveBeenCalledWith(
      expect.objectContaining({ mediation: "conditional" }),
    );
    expect(localStorage.getItem("waitron-login-preference")).toBeNull();
  });

  it("uses a reset heading and unified Spanish replacement confirmation for a reset link", async () => {
    expect(t("account.link_resent", "es-ES")).toContain("restablecer");
    history.replaceState(null, "", "/manage/account?token=reset&purpose=password_reset");
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("h1")?.textContent?.trim()).toBe(t("account.reset_title"));
  });

  it("clears enrollment errors and returns to password entry after Skip", async () => {
    const { el } = await mountPasskeyOffer();
    input(el, "passkey-name", "x".repeat(81));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-input[name=password]")).not.toBeNull();
    expect(await bottomOf(el)).toBe("");
  });

  it("restores a remembered Google method without redirecting until clicked", async () => {
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "saved@example.test", method: "google" }),
    );
    const api = stubApi();
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api, navigate });
    await flush(el);
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe(t("login.google_heading"));
    expect(navigate).not.toHaveBeenCalled();
    expect(
      el.shadowRoot!.querySelector("wt-button[variant=secondary][data-test=use-password]"),
    ).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=google-login]")!.click();
    await flush(el);
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.test/login");
    expect(JSON.parse(sessionStorage.getItem("waitron-google-login-preference")!)).toEqual({
      expiresAt: expect.any(Number),
      rememberedEmail: "saved@example.test",
    });
  });

  it("binds a returning account's remembered consent to that email", async () => {
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "saved@example.test", method: "passkey" }),
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
    await flush(el);
    expect((loggedIn.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      personId: "p9",
      loginMethod: "passkey",
      rememberEmail: true,
      rememberedEmail: "saved@example.test",
    });
  });

  it("explains an overlong passkey name before requesting registration", async () => {
    const { el, api } = await mountPasskeyOffer({ passkeyRegisterOptions: vi.fn() });
    input(el, "passkey-name", "x".repeat(81));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    await flush(el);
    expect(api.passkeyRegisterOptions).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("wt-input[name=passkey-name]")?.getAttribute("error")).toBe(
      t("profile.passkey_name_too_long"),
    );
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });

  it.each([
    new DOMException("Cancelled", "NotAllowedError"),
    { code: "passkey.verification_failed" },
  ])("keeps the passkey offer skippable after registration fails (%j)", async (error) => {
    const { el } = await mountPasskeyOffer({
      passkeyRegisterOptions: vi.fn().mockRejectedValue(error),
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    await flush(el);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-test=skip-passkey]")!
        .disabled,
    ).toBe(false);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      error instanceof DOMException ? null : "passkey.verification_failed",
    );
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
    await flush(el);
    expect(loggedIn).toHaveBeenCalledTimes(1);
  });

  it("shows the already-registered message and keeps the offer open when the device holds a passkey", async () => {
    const { el, api } = await mountPasskeyOffer(passkeyRegistrationStubs());
    // The library wraps this in a WebAuthnError whose `.code` must not reach codeOf, or the generic
    // banner shows instead of this message.
    vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
      new DOMException("already registered", "InvalidStateError"),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    await flush(el);
    expect(api.passkeyRegisterVerify).not.toHaveBeenCalled();
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "passkey.already_registered",
    );
    expect(await bottomOf(el)).toBe(codeMessage("passkey.already_registered"));
    expect(el.shadowRoot!.querySelector("[data-test=skip-passkey]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).not.toBeNull();
  });

  it("requests an authenticator code when registration reauthentication requires it", async () => {
    const { el, api } = await mountPasskeyOffer({
      passkeyRegisterOptions: vi.fn().mockRejectedValue({ code: "totp.invalid" }),
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-input[name=one-time-code]")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    await flush(el);
    expect(api.passkeyRegisterOptions).toHaveBeenCalledTimes(1);
    input(el, "one-time-code", "654321");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    await flush(el);
    expect(api.passkeyRegisterOptions).toHaveBeenLastCalledWith({
      currentPassword: "new password",
      totp: "654321",
    });
  });

  it("keeps the account fixed while password authentication is pending", async () => {
    let finish!: (value: { personId: string }) => void;
    const api = stubApi({
      login: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await continueWithEmail(el);
    input(el, "password", "password");
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await el.updateComplete;
    const change = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=change-account]",
    )!;
    expect(change.disabled).toBe(true);
    change.click();
    expect((el as unknown as { email: string }).email).toBe("owner@x.com");
    finish({ personId: "old-account" });
    await flush(el);
    expect(loggedIn).toHaveBeenCalledTimes(1);
  });

  it("ignores account inspection after disconnect", async () => {
    let finish!: (value: { email: string; purpose: "invitation" }) => void;
    history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({
        inspectAccountAction: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        ),
      }),
    });
    el.remove();
    finish({ email: "old@example.test", purpose: "invitation" });
    await flush(el);
    expect((el as unknown as { actionValidated: boolean }).actionValidated).toBe(false);
  });

  it("offers a named passkey after activation and uses the newly set password for registration", async () => {
    history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
    const api = stubApi({
      passkeyRegisterOptions: vi.fn().mockResolvedValue({
        challengeHandle: "register",
        options: {
          challenge: "AQID",
          rp: { name: "Waitron", id: "localhost" },
          user: { id: "BAUG", name: "new@example.test", displayName: "New" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        },
      }),
      passkeyRegisterVerify: vi.fn().mockResolvedValue({ credentialId: "new-key" }),
    });
    vi.spyOn(navigator.credentials, "create").mockResolvedValue({
      id: "new-key",
      rawId: new Uint8Array([1]).buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: new Uint8Array([2]).buffer,
        attestationObject: new Uint8Array([3]).buffer,
        getTransports: () => ["internal"],
      },
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential);
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await flush(el);
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    input(el, "new-password", "a replacement password");
    input(el, "new-pin", "4321");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!.click();
    await flush(el);
    expect(loggedIn).not.toHaveBeenCalled();
    expect(navigator.credentials.create).not.toHaveBeenCalled();
    input(el, "passkey-name", " Work laptop ");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    await flush(el);
    expect(api.passkeyRegisterOptions).toHaveBeenCalledWith({
      currentPassword: "a replacement password",
    });
    expect(api.passkeyRegisterVerify).toHaveBeenCalledWith({
      challengeHandle: "register",
      name: "Work laptop",
      response: expect.objectContaining({ id: "new-key" }),
    });
    expect(loggedIn).toHaveBeenCalledTimes(1);
    expect((el as unknown as { password: string }).password).toBe("");
  });

  it("offers passkey setup after reset only once password and second factor succeed", async () => {
    history.replaceState(null, "", "/manage/account?token=reset&purpose=password_reset");
    const api = stubApi({
      completeAccountAction: vi.fn().mockResolvedValue({ personId: "p1", authenticated: false }),
      login: vi
        .fn()
        .mockRejectedValueOnce({ code: "totp.required" })
        .mockResolvedValue({ personId: "p1" }),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await flush(el);
    input(el, "new-password", "replacement password");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).toBeNull();
    await continueWithEmail(el, "new@example.test");
    input(el, "password", "replacement password");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).toBeNull();
    input(el, "one-time-code", "123456");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit-factor]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).not.toBeNull();
    expect(api.login).toHaveBeenLastCalledWith({
      email: "new@example.test",
      password: "replacement password",
      totp: "123456",
    });
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
    await flush(el);
    expect(loggedIn).toHaveBeenCalledTimes(1);
    expect((el as unknown as { password: string }).password).toBe("");
  });

  it("always heads email entry and opens password without a device prompt", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe(t("login.heading"));
    expect(el.shadowRoot!.querySelectorAll("[data-test=remember-email]")).toHaveLength(1);
    await continueWithEmail(el);
    await flush(el);
    expect(api.passkeyAuthOptions).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("h1")?.textContent).toBe(t("login.password_heading"));
    expect(el.shadowRoot!.querySelector("[data-test=remember-email]")).toBeNull();
    expect(
      el
        .shadowRoot!.querySelector("wt-input[name=password]")
        ?.nextElementSibling?.matches(".field-link:has(a[data-test=reset-by-email])"),
    ).toBe(true);
    expect(
      el.shadowRoot!.querySelector("wt-button[variant=secondary][data-test=passkey-login]"),
    ).not.toBeNull();
    expect(
      el.shadowRoot!.querySelector("wt-button[variant=secondary][data-test=google-login]"),
    ).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=use-invitation-code]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=back]")).toBeNull();
  });

  it("change account clears persistent identity and method across a remount", async () => {
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "saved@example.test", method: "password" }),
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
    await el.updateComplete;
    expect(localStorage.getItem("waitron-login-preference")).toBeNull();
    const { el: refreshed } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi(),
    });
    expect(
      refreshed.shadowRoot!.querySelector("wt-input[name=email]")?.getAttribute("value"),
    ).not.toBe("saved@example.test");
    expect((refreshed as unknown as { email: string }).email).toBe("");
  });

  it("centres the login form in a wider, width-bounded container", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    const screen = el.shadowRoot!.querySelector<HTMLElement>(".screen");

    expect(getComputedStyle(el).display).toBe("block");
    expect(screen).not.toBeNull();
    expect(getComputedStyle(screen!).maxWidth).toBe("480px");
    expect(getComputedStyle(screen!).marginInlineStart).toBe(
      getComputedStyle(screen!).marginInlineEnd,
    );
  });

  it("submits the typed email + password", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    const loggedIn = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("logged-in", (e) => resolve((e as CustomEvent).detail)),
    );
    await openPassword(el);
    (el as unknown as { password: string }).password = "correct horse";
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    expect(await loggedIn).toEqual({
      personId: "p1",
      accountSetup: false,
      loginMethod: "password",
      rememberEmail: false,
    });
    expect(api.login).toHaveBeenCalledWith({
      email: "owner@x.com",
      password: "correct horse",
    });
  });

  it("asks for an authenticator only after the password has verified", async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce({ code: "totp.required" })
      .mockResolvedValueOnce({ personId: "p1" });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ login }),
    });
    await openPassword(el);
    expect(el.shadowRoot!.querySelector("wt-input[name=one-time-code]")).toBeNull();
    (el as unknown as { password: string }).password = "correct horse";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);

    const factor = el.shadowRoot!.querySelector("wt-input[name=one-time-code]");
    expect(factor).not.toBeNull();
    expect((el as unknown as { errorKey: string | null }).errorKey).toBeNull();
    factor!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "123456" } }));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit-factor]")!.click();
    await flush(el);
    expect(login).toHaveBeenNthCalledWith(1, {
      email: "owner@x.com",
      password: "correct horse",
    });
    expect(login).toHaveBeenNthCalledWith(2, {
      email: "owner@x.com",
      password: "correct horse",
      totp: "123456",
    });
  });

  it("explains an empty authenticator submission without repeating the password check", async () => {
    const login = vi.fn().mockRejectedValueOnce({ code: "totp.required" });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ login }),
    });
    await openPassword(el);
    (el as unknown as { password: string }).password = "correct horse";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit-factor]")!.click();
    await el.updateComplete;

    expect(login).toHaveBeenCalledTimes(1);
    const factor = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
      "wt-input[name=one-time-code]",
    )!;
    expect(factor.error).toBe(t("form.factor_required"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });

  it("starts conditional passkey autofill on the first email screen", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    vi.mocked(navigator.credentials.get).mockReturnValueOnce(new Promise(() => undefined));
    const api = stubApi();
    await mountWidget<LoginScreen>("dashboard-login-screen", { api });

    await vi.waitFor(() =>
      expect(navigator.credentials.get).toHaveBeenCalledWith({
        publicKey: {
          challenge: new Uint8Array([1, 2, 3]).buffer,
          allowCredentials: [],
        },
        mediation: "conditional",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(api.passkeyAuthOptions).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending conditional ceremony before submitting a password", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    vi.mocked(navigator.credentials.get).mockReturnValueOnce(new Promise(() => undefined));
    const cancelCeremony = vi
      .spyOn(WebAuthnAbortService, "cancelCeremony")
      .mockImplementation(() => undefined);
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalledTimes(1));
    Object.assign(el as unknown as Record<string, string>, {
      email: "owner@example.com",
      password: "correct horse",
      step: "password",
    });
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);

    expect(cancelCeremony).toHaveBeenCalled();
    expect(api.login).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "correct horse",
    });
  });

  it("opens password alternatives without an error when the explicit passkey prompt is cancelled", async () => {
    vi.mocked(navigator.credentials.get).mockRejectedValueOnce(
      new DOMException("Cancelled", "NotAllowedError"),
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    (el as unknown as { email: string }).email = "owner@x.com";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-input[name=password]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reset-by-email]")).not.toBeNull();
    expect((el as unknown as { errorKey: string | null }).errorKey).toBeNull();
  });

  it("ignores a passkey result that arrives after the login screen is removed", async () => {
    let resolveAuthentication!: (value: PublicKeyCredential) => void;
    vi.mocked(navigator.credentials.get).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAuthentication = resolve;
      }) as never,
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    (el as unknown as { email: string }).email = "owner@x.com";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
    await flush(el);
    el.remove();

    resolveAuthentication(passkeyCredential("late-credential"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loggedIn).not.toHaveBeenCalled();
  });

  it("opens directly on password for an opted-in account", async () => {
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "owner@example.com", method: "password" }),
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-input[name=password]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=login-context]")?.value).toBe(
      "owner@example.com",
    );
    expect(navigator.credentials.get).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("wt-input[name=email]")?.value,
    ).toBe("");
    expect(sessionStorage.getItem("waitron-login-preference")).toBeNull();
  });

  it("focuses the password field for a remembered password account", async () => {
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "owner@example.com", method: "password" }),
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    const field =
      el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("wt-input[name=password]")!;
    expect(field.shadowRoot!.activeElement).toBe(field.shadowRoot!.querySelector("input"));
  });

  it("can forget an opted-in account from the returning login", async () => {
    const saved = JSON.stringify({ email: "owner@example.com", method: "passkey" });
    sessionStorage.setItem("waitron-login-preference", saved);
    localStorage.setItem("waitron-login-preference", saved);
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    expect(el.shadowRoot!.querySelector("[data-test=remember-email]")).toBeNull();
    expect(navigator.credentials.get).not.toHaveBeenCalled();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
    await el.updateComplete;
    expect(sessionStorage.getItem("waitron-login-preference")).toBeNull();
    expect(localStorage.getItem("waitron-login-preference")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-input[name=email]")).not.toBeNull();
  });

  it("keeps the opt-in only for the current attempt until authentication", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    const remember = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=remember-email]")!;
    remember.checked = true;
    remember.dispatchEvent(new Event("change"));
    await continueWithEmail(el);
    expect((el as unknown as { rememberEmail: boolean }).rememberEmail).toBe(true);
    expect(sessionStorage.getItem("waitron-login-preference")).toBeNull();
    expect(localStorage.getItem("waitron-login-preference")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=remember-email]")!.checked,
    ).toBe(false);
  });

  it("finishes password recovery at login without creating a session", async () => {
    const api = stubApi({
      completeAccountAction: vi.fn().mockResolvedValue({ personId: "p1", authenticated: false }),
    });
    history.replaceState(
      null,
      "",
      "/manage/account?token=token-1&purpose=password_reset#email=new%40example.test",
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await flush(el);
    (el as unknown as { password: string }).password = "a replacement password";
    const events: Event[] = [];
    el.addEventListener("logged-in", (event) => events.push(event));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!.click();
    await flush(el);
    expect(events).toHaveLength(0);
    expect(el.shadowRoot!.textContent).toContain(codeMessage("password.reset_complete"));
    expect(
      el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("wt-input[name=email]")!.value,
    ).toBe("new@example.test");
  });

  it("validates an emailed action before showing credential fields", async () => {
    let resolveInspection!: (value: { email: string; purpose: "invitation" }) => void;
    const inspection = new Promise<{ email: string; purpose: "invitation" }>((resolve) => {
      resolveInspection = resolve;
    });
    const api = stubApi({ inspectAccountAction: vi.fn().mockReturnValue(inspection) });
    history.replaceState(
      null,
      "",
      "/manage/account?token=token-1&purpose=invitation#email=untrusted%40example.test",
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });

    expect(el.shadowRoot!.querySelector("wt-input[name=new-password]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=login-context]")).toBeNull();
    resolveInspection({ email: "pending@example.test", purpose: "invitation" });
    await flush(el);

    expect(api.inspectAccountAction).toHaveBeenCalledWith("token-1", "invitation");
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=login-context]")?.value).toBe(
      "pending@example.test",
    );
    expect(el.shadowRoot!.querySelector("wt-input[name=new-password]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector<HTMLInputElement>("[data-autofill-username]")!.value).toBe(
      "pending@example.test",
    );
  });

  it.each(["invitation", "password_reset"])(
    "offers generic recovery for an expired %s link",
    async (purpose) => {
      const api = stubApi({
        inspectAccountAction: vi.fn().mockRejectedValue({ code: "account_action.invalid" }),
      });
      history.replaceState(
        null,
        "",
        `/manage/account?token=expired&purpose=${purpose}#email=pending%40example.test`,
      );
      const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
      await flush(el);

      expect(el.shadowRoot!.querySelector("[data-test=resend-account-link]")).not.toBeNull();
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=resend-account-link]")!.click();
      await flush(el);

      expect(api.requestPasswordReset).toHaveBeenCalledWith("pending@example.test");
      expect(el.shadowRoot!.textContent).toContain(t("account.link_resent"));
      expect(el.shadowRoot!.querySelector("[data-test=resend-account-link]")).not.toBeNull();
    },
  );

  it("cancels account setup and returns to a blank email form", async () => {
    history.replaceState(
      null,
      "",
      "/manage/account?token=token-1&purpose=invitation#email=new%40example.test",
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-account-action]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-input[name=email]")).not.toBeNull();
    expect(new URLSearchParams(location.search).has("token")).toBe(false);
  });

  it("asks for email first, then offers password and passkey for every account", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=submit]")).toBeNull();
    await continueWithEmail(el);
    expect(el.shadowRoot!.querySelectorAll<WtInput>("wt-input:not([readonly])")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=try-another-way]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=submit]")).not.toBeNull();
    expect(api.login).not.toHaveBeenCalled();
  });

  it("identifies the account above the password field", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el, "bea@x.com");

    const context = el.shadowRoot!.querySelector<WtInput>("[data-test=login-context]")!;
    expect(context.label).toBe(t("login.email"));
    expect(context.value).toBe("bea@x.com");
  });

  it("reveals and hides the password without losing its value", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el);
    const field = el.shadowRoot!.querySelector<WtInput>("wt-input:not([readonly])")!;
    field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "secret words" } }));
    await el.updateComplete;

    const toggle = el.shadowRoot!.querySelector<HTMLElement & { ariaLabel: string }>(
      "[data-test=toggle-password]",
    )!;
    expect(toggle.getAttribute("slot")).toBe("end");
    expect(toggle.ariaLabel).toBe(t("login.show_password"));
    expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.type).toBe("password");

    toggle.click();
    await el.updateComplete;
    expect(toggle.ariaLabel).toBe(t("login.hide_password"));
    expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.type).toBe("text");
    expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("secret words");

    toggle.click();
    await el.updateComplete;
    expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.type).toBe("password");
  });

  it("uses password-manager names, autocomplete purposes, and required fields", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    let input = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
    expect({
      name: input.name,
      autocomplete: input.autocomplete,
      required: input.required,
    }).toEqual({
      name: "email",
      autocomplete: "username webauthn",
      required: true,
    });

    await openPassword(el);
    input = el
      .shadowRoot!.querySelector<WtInput>("wt-input:not([readonly])")!
      .shadowRoot!.querySelector("input")!;
    expect({
      name: input.name,
      autocomplete: input.autocomplete,
      required: input.required,
    }).toEqual({
      name: "password",
      autocomplete: "current-password",
      required: true,
    });
  });

  it("explains a missing or malformed email under the field and above the action", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    const field = el.shadowRoot!.querySelector("wt-input") as HTMLElement & { error: string };
    const go = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=continue]",
    )!;
    expect(go.disabled).toBe(false);
    go.click();
    await el.updateComplete;
    expect(field.error).toBe(t("form.email_required"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));

    field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "not-an-email" } }));
    go.click();
    await el.updateComplete;
    expect(field.error).toBe(codeMessage("person.email_invalid"));
    expect(el.shadowRoot!.querySelector("[data-test=submit]")).toBeNull();
  });

  it("makes each step's own way in its one primary button and offers the others as buttons", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    expect(
      el.shadowRoot!.querySelector("wt-button[variant=primary]")?.getAttribute("data-test"),
    ).toBe("continue");
    await continueWithEmail(el);
    expect(
      el.shadowRoot!.querySelector("wt-button[variant=primary]")?.getAttribute("data-test"),
    ).toBe("submit");
    expect(
      [...el.shadowRoot!.querySelectorAll("wt-button[variant=secondary]")].map((b) =>
        b.getAttribute("data-test"),
      ),
    ).toEqual(["passkey-login", "google-login"]);
    await openPasskey(el);
    expect(
      el.shadowRoot!.querySelector("wt-button[variant=primary]")?.getAttribute("data-test"),
    ).toBe("passkey-login");
    expect(
      el.shadowRoot!.querySelector("wt-button[variant=secondary][data-test=use-password]"),
    ).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=use-password]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-input[name=password]")).not.toBeNull();
  });

  it("groups account-setup credentials and lets each secret be revealed", async () => {
    history.replaceState(
      null,
      "",
      "/manage/account?token=token-1&purpose=invitation#email=new%40example.test",
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await el.updateComplete;
    const fields = [...el.shadowRoot!.querySelectorAll<WtInput>("wt-input:not([readonly])")];
    const inputs = fields.map((field) => {
      const input = field.shadowRoot!.querySelector("input")!;
      return { name: input.name, autocomplete: input.autocomplete, required: input.required };
    });
    expect(inputs).toEqual([
      { name: "new-password", autocomplete: "new-password", required: true },
      { name: "new-pin", autocomplete: "off", required: true },
    ]);

    const labels = [
      ["account.show_new_password", "account.hide_new_password"],
      ["account.show_new_pin", "account.hide_new_pin"],
    ] as const;
    for (const [index, field] of fields.entries()) {
      const toggle = field.querySelector<HTMLElement>("wt-button[slot=end]")!;
      expect(toggle.ariaLabel).toBe(t(labels[index]![0]));
      field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: `secret-${index}` } }));
      toggle.click();
      await el.updateComplete;
      expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.type).toBe("text");
      expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe(
        `secret-${index}`,
      );
      expect(toggle.ariaLabel).toBe(t(labels[index]![1]));
      for (const [otherIndex, other] of fields.entries()) {
        if (otherIndex !== index) {
          expect(other.shadowRoot!.querySelector<HTMLInputElement>("input")!.type).toBe("password");
        }
      }
      toggle.click();
      await el.updateComplete;
    }

    const username = el.shadowRoot!.querySelector<HTMLInputElement>("[data-autofill-username]")!;
    expect(username.name).toBe("email");
    expect(username.autocomplete).toBe("username");
    expect(username.value).toBe("new@example.test");
  });

  it("submits account setup with Enter from every field", async () => {
    history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    const submit = el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!;
    const click = vi.spyOn(submit, "click").mockImplementation(() => undefined);
    const fields = [...el.shadowRoot!.querySelectorAll<WtInput>("wt-input:not([readonly])")];
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
      input.focus();
      await userEvent.keyboard("{Enter}");
    }
    expect(click).toHaveBeenCalledTimes(fields.length);
  });

  it("clears login secrets when changing accounts", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el, "new@example.test");
    Object.assign(el as unknown as Record<string, string>, {
      password: "old login password",
      secondFactor: "old recovery code",
      pin: "1234",
    });
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
    await el.updateComplete;

    expect([...el.shadowRoot!.querySelectorAll("wt-input")].map((field) => field.value)).toEqual([
      "",
    ]);
  });

  it("marks a missing PIN without asking for confirmation", async () => {
    history.replaceState(
      null,
      "",
      "/manage/account?token=token-1&purpose=invitation#email=new%40example.test",
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!.click();
    await el.updateComplete;

    expect(
      el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("wt-input[name=new-pin]")!.error,
    ).toBe(t("form.pin_required"));
    expect(el.shadowRoot!.querySelector("wt-input[name=confirm-pin]")).toBeNull();
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });

  it("does not fetch the roster on connect", async () => {
    const api = stubApi();
    await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    expect(api.getStaffRoster).not.toHaveBeenCalled();
  });

  it("shows an error key when login is rejected", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({ code: "password.invalid" }) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await openPassword(el);
    (el as unknown as { password: string }).password = "wrong";
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("password.invalid");
    const message = await bottomOf(el);
    expect(message).toContain(t("login.failed", "es-ES"));
    expect(message).not.toContain("password.invalid");
    expect(
      el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("wt-input[name=password]")!.error,
    ).toBe("");
  });

  it("reads the email first, then the password chosen as another way", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;

    const email = el.shadowRoot!.querySelector("wt-input")!;
    email.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "owner@x.com" } }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await el.updateComplete;
    const password = el.shadowRoot!.querySelector<WtInput>("wt-input:not([readonly])")!;
    password.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "hunter2" } }));
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await new Promise((r) => setTimeout(r));
    expect(api.login).toHaveBeenCalledWith({
      email: "owner@x.com",
      password: "hunter2",
    });
  });

  it.each(["wrong", ""])(
    "clears password errors when cancelling a rejected submission (%j)",
    async (password) => {
      const api = stubApi({ login: vi.fn().mockRejectedValue({ code: "password.invalid" }) });
      const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
      await openPassword(el);
      el.shadowRoot!.querySelector<WtInput>("wt-input:not([readonly])")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: password } }),
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
      await flush(el);
      const errors = () => bottomOf(el);
      expect(await errors()).not.toBe("");

      el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
      await el.updateComplete;
      expect(await errors()).toBe("");
      expect(el.shadowRoot!.querySelector("wt-input")!.name).toBe("email");
      expect(el.shadowRoot!.querySelector("wt-input")!.value).toBe("");
      await openPassword(el);
      expect(await errors()).toBe("");
      expect(el.shadowRoot!.querySelector<WtInput>("wt-input:not([readonly])")!.error).toBe("");
      expect(el.shadowRoot!.querySelector<WtInput>("wt-input:not([readonly])")!.value).toBe("");
    },
  );

  it("falls back to server.internal when the rejection carries no code", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await openPassword(el);
    (el as unknown as { password: string }).password = "wrong";
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("offers the password as an alternative to the preferred passkey, and the reset email from there", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await openPasskey(el, "bea@x.com");

    expect(el.shadowRoot!.querySelector("[data-test=forgot-password]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=use-password]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reset-by-email]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=change-account]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=login-context]")?.value).toBe(
      "bea@x.com",
    );

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=use-password]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reset-by-email]")!.click();
    await flush(el);
    expect(api.requestPasswordReset).toHaveBeenCalledWith("bea@x.com");
    expect(el.shadowRoot!.querySelector("[data-test=reset-sent]")).not.toBeNull();
  });

  it("offers configured Google login without asking Google for an email", async () => {
    const api = stubApi();
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api, navigate });
    await flush(el);
    await openPasskey(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=google-login]")!.click();
    await flush(el);
    expect(api.beginGoogleLogin).toHaveBeenCalledWith();
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.test/login");
  });

  it("shows a separate email confirmation and allows resending only after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await openPassword(el, "bea@x.com");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reset-by-email]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=login-or]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reset-sent]")?.textContent).toContain(
      "bea@x.com",
    );
    const resend = () =>
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        "[data-test=resend-reset]",
      )!;
    expect(resend().disabled).toBe(true);
    expect(resend().textContent).toContain("60");
    resend().click();
    await flush(el);
    expect(api.requestPasswordReset).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(resend().disabled).toBe(true);
    expect(resend().textContent).toContain("1");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
    await el.updateComplete;
    await openPassword(el, "bea@x.com");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reset-by-email]")!.click();
    await flush(el);
    expect(api.requestPasswordReset).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resend().disabled).toBe(false);
    resend().click();
    await flush(el);
    expect(api.requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(resend().textContent).toContain("60");
    expect(resend().disabled).toBe(true);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens a hidden password field from the alternative choices", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPasskey(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=use-password]")!.click();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("[data-test=submit]")).not.toBeNull();
    expect(
      el
        .shadowRoot!.querySelector<WtInput>("wt-input:not([readonly])")!
        .shadowRoot!.querySelector<HTMLInputElement>("input")!.type,
    ).toBe("password");
    const username = el.shadowRoot!.querySelector<HTMLInputElement>("[data-autofill-username]")!;
    expect(username.name).toBe("email");
    expect(username.autocomplete).toBe("username");
    expect(username.value).toBe("owner@x.com");
  });

  it("completes an invitation token with one password and logs in", async () => {
    const api = stubApi();
    history.replaceState(
      null,
      "",
      "/manage/account?token=token-1&purpose=invitation#email=new%40example.test",
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    (el as unknown as { password: string }).password = "a replacement password";
    (el as unknown as { pin: string }).pin = "4321";
    await el.updateComplete;
    const loggedIn = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("logged-in", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
    expect(await loggedIn).toEqual({
      personId: "p1",
      accountSetup: true,
      loginMethod: "password",
      rememberEmail: false,
    });
    expect(api.completeAccountAction).toHaveBeenCalledWith(
      "token-1",
      "invitation",
      "a replacement password",
      "4321",
    );
  });

  it("runs the passkey ceremony and logs in the returned person", async () => {
    const warn = vi.spyOn(console, "warn");
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await continueWithEmail(el);
    const loggedIn = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("logged-in", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
    expect((await loggedIn).personId).toBe("p9");
    // The library warns if optionsJSON is omitted and its deprecated call shape is used.
    expect(warn).not.toHaveBeenCalled();
    expect(navigator.credentials.get).toHaveBeenCalledExactlyOnceWith({
      publicKey: { challenge: new Uint8Array([1, 2, 3]).buffer, allowCredentials: undefined },
      signal: expect.any(AbortSignal),
    });
    expect(api.passkeyAuthVerify).toHaveBeenCalledWith({
      challengeHandle: "h1",
      response: {
        id: "cred-abc",
        rawId: "AQ",
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: "Ag",
          authenticatorData: "Aw",
          signature: "BA",
          userHandle: "BQ",
        },
      },
    });
  });

  it("shows the thrown code as errorKey when a passkey step is rejected (and never rejects)", async () => {
    const api = stubApi({
      passkeyAuthVerify: vi.fn().mockRejectedValue({ code: "passkey.challenge_expired" }),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await continueWithEmail(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "passkey.challenge_expired",
    );
  });

  it("leaves the spacing token between the hint and a refused passkey sign-in's message", async () => {
    const api = stubApi({
      passkeyAuthVerify: vi.fn().mockRejectedValue({ code: "passkey.challenge_expired" }),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await continueWithEmail(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
    await flush(el);
    el.style.setProperty("--wt-space-4", "23px");
    const hint = el.shadowRoot!.querySelector(".alternative-hint")!.getBoundingClientRect();
    const message = (await bottomMessageOf(el))!.getBoundingClientRect();
    expect(message.top - hint.bottom).toBeCloseTo(23, 0);
  });

  it("falls back to passkey.verification_failed when a rejected passkey step carries no code", async () => {
    const api = stubApi({ passkeyAuthOptions: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await continueWithEmail(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "passkey.verification_failed",
    );
  });
  it("offers a passkey when the server says to", async () => {
    const { el } = await signInWithPassword({
      login: vi.fn().mockResolvedValue({ personId: "p1", offerPasskey: true }),
    });
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).not.toBeNull();
  });

  it("signs straight in when the server says not to", async () => {
    const api = stubApi({
      login: vi.fn().mockResolvedValue({ personId: "p1", offerPasskey: false }),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    const events: CustomEvent[] = [];
    el.addEventListener("logged-in", (e) => events.push(e as CustomEvent));
    await flush(el);
    await openPassword(el, "clinton@example.com");
    input(el, "password", "correct horse battery");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toEqual({
      personId: "p1",
      accountSetup: false,
      loginMethod: "password",
      rememberEmail: false,
    });
  });

  it("records the resolution when the offer is skipped, then signs in", async () => {
    const { el, api } = await signInWithPassword({
      login: vi.fn().mockResolvedValue({ personId: "p1", offerPasskey: true }),
    });
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
    await flush(el);
    expect(api.passkeyOfferSeen).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it("records the resolution when a passkey is added from the offer, then signs in", async () => {
    const { el, api } = await signInWithPassword({
      login: vi.fn().mockResolvedValue({ personId: "p1", offerPasskey: true }),
      ...passkeyRegistrationStubs(),
    });
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    await flush(el);
    expect(api.passkeyRegisterVerify).toHaveBeenCalledTimes(1);
    expect(api.passkeyOfferSeen).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it("records the resolution when the offer is skipped after an invitation", async () => {
    const { el, api } = await mountPasskeyOffer();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
    await flush(el);
    expect(api.passkeyOfferSeen).toHaveBeenCalledTimes(1);
  });

  it("still signs in when recording the skip fails", async () => {
    const { el } = await signInWithPassword({
      login: vi.fn().mockResolvedValue({ personId: "p1", offerPasskey: true }),
      passkeyOfferSeen: vi.fn().mockRejectedValue(new Error("network")),
    });
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
    await flush(el);
    expect(events).toHaveLength(1);
    // A session-shaped rejection leaves this screen in front of the person, so it must not stay
    // disabled.
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-test=submit]")!
        .disabled,
    ).toBe(false);
  });

  it("signs in once when the offer is skipped twice before the first skip lands", async () => {
    const { release, passkeyOfferSeen } = pendingOfferSeen();
    const { el, api } = await signInWithPassword({
      login: vi.fn().mockResolvedValue({ personId: "p1", offerPasskey: true }),
      passkeyOfferSeen,
    });
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    const skip = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=skip-passkey]",
    )!;
    skip.click();
    await el.updateComplete;
    const disabledWhileSkipping = skip.disabled;
    skip.click();
    release();
    await flush(el);
    expect(api.passkeyOfferSeen).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(disabledWhileSkipping).toBe(true);
  });

  it("signs in once when a passkey is added while a skip is still in flight", async () => {
    const { release, passkeyOfferSeen } = pendingOfferSeen();
    const { el, api } = await signInWithPassword({
      login: vi.fn().mockResolvedValue({ personId: "p1", offerPasskey: true }),
      passkeyOfferSeen,
      ...passkeyRegistrationStubs(),
    });
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=skip-passkey]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=setup-passkey]")!.click();
    release();
    await flush(el);
    expect(api.passkeyRegisterOptions).not.toHaveBeenCalled();
    expect(api.passkeyOfferSeen).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });
});

it("Enter submits current shadow input values once while login is pending", async () => {
  let resolve!: (value: { personId: string; offerPasskey: boolean }) => void;
  const login = vi.fn(
    () =>
      new Promise<{ personId: string; offerPasskey: boolean }>((done) => {
        resolve = done;
      }),
  );
  const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
    api: stubApi({ login }),
  });
  let input = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
  input.value = "owner@example.com";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  input = el
    .shadowRoot!.querySelector<WtInput>("wt-input:not([readonly])")!
    .shadowRoot!.querySelector("input")!;
  input.value = "secret";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  input.focus();
  await userEvent.keyboard("{Enter}");
  expect(login).toHaveBeenCalledExactlyOnceWith({
    email: "owner@example.com",
    password: "secret",
  });
  resolve({ personId: "p1", offerPasskey: false });
  await flush(el);
});

type WtInput = import("@waitron/ui").WtInput;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const never = () => new Promise<never>(() => undefined);

function field(el: LoginScreen, name: string): WtInput {
  return el.shadowRoot!.querySelector<WtInput>(`wt-input[name=${name}]`)!;
}

/** Presses Enter in a field's native input, the way a keyboard does (the event starts inside the
 * field's own shadow root). */
function pressEnter(el: LoginScreen, name: string): void {
  field(el, name)
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
}

function click(el: LoginScreen, test: string): void {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!.click();
}

async function whileDetached(el: LoginScreen, settle: () => void): Promise<void> {
  const host = el.parentElement!;
  el.remove();
  settle();
  await new Promise((resolve) => setTimeout(resolve, 0));
  host.appendChild(el);
  await flush(el);
}

describe("login-screen: Google configuration", () => {
  it("sends the page itself to Google when no navigator is injected", async () => {
    const api = stubApi({
      beginGoogleLogin: vi.fn().mockResolvedValue({ authorizationUrl: "#google-authorization" }),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await flush(el);
    await openPassword(el);
    click(el, "google-login");
    await flush(el);
    expect(location.hash).toBe("#google-authorization");
  });

  it("opens the password step when a remembered Google sign-in is no longer configured", async () => {
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "owner@example.com", method: "google" }),
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }) }),
    });
    await flush(el);
    expect(field(el, "password")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=google-login]")).toBeNull();
    expect(el.shadowRoot!.querySelector<WtInput>("[data-test=login-context]")!.value).toBe(
      "owner@example.com",
    );
    expect(navigator.credentials.get).not.toHaveBeenCalled();
  });

  it("keeps sign-in usable without Google when its configuration cannot be read", async () => {
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    try {
      const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
        api: stubApi({ getGoogleConfig: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
      });
      await flush(el);
      await continueWithEmail(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(field(el, "password")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=google-login]")).toBeNull();
      expect(await bottomOf(el)).toBe("");
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", unhandled);
    }
  });

  it("ignores a Google configuration that arrives after the screen is removed", async () => {
    const config = deferred<{ configured: boolean; privacyNoticeUrl?: string }>();
    const api = stubApi({
      getGoogleConfig: vi.fn().mockReturnValueOnce(config.promise).mockImplementation(never),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await whileDetached(el, () =>
      config.resolve({ configured: true, privacyNoticeUrl: "https://restaurant.example/privacy" }),
    );
    await continueWithEmail(el);
    expect(el.shadowRoot!.querySelector("[data-test=google-login]")).toBeNull();
    expect(el.shadowRoot!.querySelector("a[target=_blank]")).toBeNull();
  });

  it("starts Google sign-in once when its button is pressed twice", async () => {
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "owner@example.com", method: "google" }),
    );
    const begin = deferred<{ authorizationUrl: string }>();
    const api = stubApi({ beginGoogleLogin: vi.fn().mockReturnValue(begin.promise) });
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api, navigate });
    await flush(el);
    const button = el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=google-login]")!;
    button.click();
    button.click();
    begin.resolve({ authorizationUrl: "https://accounts.google.test/login" });
    await flush(el);
    expect(api.beginGoogleLogin).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("https://accounts.google.test/login");
  });

  it("does not leave for Google when the answer arrives after the screen is removed", async () => {
    const begin = deferred<{ authorizationUrl: string }>();
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ beginGoogleLogin: vi.fn().mockReturnValue(begin.promise) }),
      navigate,
    });
    await flush(el);
    await openPassword(el);
    click(el, "google-login");
    await whileDetached(el, () =>
      begin.resolve({ authorizationUrl: "https://accounts.google.test/login" }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("explains a refused Google start and stays on the screen", async () => {
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ beginGoogleLogin: vi.fn().mockRejectedValue({ code: "google.invalid" }) }),
      navigate,
    });
    await flush(el);
    await openPassword(el);
    click(el, "google-login");
    await flush(el);
    expect(navigate).not.toHaveBeenCalled();
    expect(await bottomOf(el)).toBe(codeMessage("google.invalid"));
    expect(field(el, "password")).not.toBeNull();
  });
});

describe("login-screen: remembering the account", () => {
  it("unticking Remember forgets any sign-in shortcut this browser still holds", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    sessionStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "old@example.com", method: "passkey" }),
    );
    sessionStorage.setItem(
      "waitron-google-login-preference",
      JSON.stringify({ expiresAt: Date.now() + 60_000 }),
    );
    const remember = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=remember-email]")!;
    remember.click();
    expect(remember.checked).toBe(true);
    expect(sessionStorage.length).toBe(2);
    remember.click();
    expect(remember.checked).toBe(false);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });
});

describe("login-screen: emailed account links", () => {
  it("cancels a link that is still being checked", async () => {
    history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ inspectAccountAction: vi.fn(never) }),
    });
    expect(el.shadowRoot!.textContent).toContain(t("account.validating_link"));
    click(el, "cancel-account-action");
    await el.updateComplete;
    expect(field(el, "email")).not.toBeNull();
    expect(new URLSearchParams(location.search).has("token")).toBe(false);
  });

  it("leaves the address alone when it no longer carries the cancelled link", async () => {
    history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    history.replaceState(null, "", "/manage/elsewhere?keep=1");
    click(el, "cancel-account-action");
    await el.updateComplete;
    expect(field(el, "email")).not.toBeNull();
    expect(location.pathname + location.search).toBe("/manage/elsewhere?keep=1");
  });

  async function mountExpiredLink(overrides: Partial<DashboardApi> = {}) {
    history.replaceState(
      null,
      "",
      "/manage/account?token=expired&purpose=invitation#email=pending%40example.test",
    );
    const api = stubApi({
      inspectAccountAction: vi
        .fn()
        .mockRejectedValueOnce({ code: "account_action.invalid" })
        .mockImplementation(never),
      ...overrides,
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await flush(el);
    return { el, api };
  }

  it("sends one new link when Resend is pressed twice before the first request lands", async () => {
    const request = deferred<void>();
    const { el, api } = await mountExpiredLink({
      requestPasswordReset: vi.fn().mockReturnValue(request.promise),
    });
    click(el, "resend-account-link");
    click(el, "resend-account-link");
    request.resolve();
    await flush(el);
    expect(api.requestPasswordReset).toHaveBeenCalledExactlyOnceWith("pending@example.test");
    expect(el.shadowRoot!.textContent).toContain(t("account.link_resent"));
  });

  it("does not report a resent link whose answer arrives after the screen is removed", async () => {
    const request = deferred<void>();
    const { el } = await mountExpiredLink({
      requestPasswordReset: vi.fn().mockReturnValue(request.promise),
    });
    click(el, "resend-account-link");
    await whileDetached(el, () => request.resolve());
    expect(el.shadowRoot!.textContent).toContain(t("account.validating_link"));
    expect(el.shadowRoot!.textContent).not.toContain(t("account.link_resent"));
  });

  it("explains a refused resend", async () => {
    const { el } = await mountExpiredLink({
      requestPasswordReset: vi.fn().mockRejectedValue({ code: "account_action.rate_limited" }),
    });
    click(el, "resend-account-link");
    await flush(el);
    expect(await bottomOf(el)).toBe(codeMessage("account_action.rate_limited"));
    expect(el.shadowRoot!.textContent).not.toContain(t("account.link_resent"));
  });

  async function mountValidatedInvitation(overrides: Partial<DashboardApi> = {}) {
    history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
    const api = stubApi(overrides);
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await flush(el);
    return { el, api };
  }

  it("explains a new password or PIN that is too short without submitting", async () => {
    const { el, api } = await mountValidatedInvitation();
    input(el, "new-password", "short");
    input(el, "new-pin", "12");
    click(el, "complete-account");
    await el.updateComplete;
    expect(api.completeAccountAction).not.toHaveBeenCalled();
    expect(field(el, "new-password").error).toBe(codeMessage("password.too_short"));
    expect(field(el, "new-pin").error).toBe(codeMessage("pin.too_short"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  });

  it("completes an account once when Set password is pressed twice", async () => {
    const completion = deferred<{ personId: string; authenticated: boolean }>();
    const { el, api } = await mountValidatedInvitation({
      completeAccountAction: vi.fn().mockReturnValue(completion.promise),
    });
    input(el, "new-password", "new password");
    input(el, "new-pin", "4321");
    click(el, "complete-account");
    click(el, "complete-account");
    completion.resolve({ personId: "p1", authenticated: true });
    await flush(el);
    expect(api.completeAccountAction).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).not.toBeNull();
  });

  it("ignores a completed account whose answer arrives after the screen is removed", async () => {
    const completion = deferred<{ personId: string; authenticated: boolean }>();
    const { el } = await mountValidatedInvitation({
      completeAccountAction: vi.fn().mockReturnValue(completion.promise),
      inspectAccountAction: vi
        .fn()
        .mockResolvedValueOnce({ email: "new@example.test", purpose: "invitation" })
        .mockImplementation(never),
    });
    input(el, "new-password", "new password");
    input(el, "new-pin", "4321");
    click(el, "complete-account");
    await whileDetached(el, () => completion.resolve({ personId: "p1", authenticated: true }));
    expect(new URLSearchParams(location.search).get("token")).toBe("token-1");
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).toBeNull();
  });

  it.each([
    [
      "beside the new password",
      "password.too_short",
      codeMessage("password.too_short"),
      t("form.fix_fields"),
    ],
    ["only at the bottom", "account_action.invalid", "", codeMessage("account_action.invalid")],
  ])("shows a refused completion %s", async (_where, code, fieldError, bottom) => {
    const { el } = await mountValidatedInvitation({
      completeAccountAction: vi.fn().mockRejectedValue({ code }),
    });
    input(el, "new-password", "new password");
    input(el, "new-pin", "4321");
    click(el, "complete-account");
    await flush(el);
    expect(field(el, "new-password").error).toBe(fieldError);
    expect(await bottomOf(el)).toBe(bottom);
  });
});

describe("login-screen: password and second factor", () => {
  it("sends one sign-in when Log in is pressed twice before the first answer", async () => {
    const answer = deferred<{ personId: string }>();
    const api = stubApi({ login: vi.fn().mockReturnValue(answer.promise) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await openPassword(el);
    input(el, "password", "correct horse");
    click(el, "submit");
    click(el, "submit");
    answer.resolve({ personId: "p1" });
    await flush(el);
    expect(api.login).toHaveBeenCalledTimes(1);
  });

  it("does not sign in when the password answer arrives after the screen is removed", async () => {
    const answer = deferred<{ personId: string }>();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ login: vi.fn().mockReturnValue(answer.promise) }),
    });
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    await openPassword(el);
    input(el, "password", "correct horse");
    click(el, "submit");
    await whileDetached(el, () => answer.resolve({ personId: "p1" }));
    expect(events).toHaveLength(0);
  });

  it("says a refused authenticator code failed the login above the action and keeps the code step", async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce({ code: "totp.required" })
      .mockRejectedValueOnce({ code: "password.invalid" });
    const { el } = await signInWithPassword({ login });
    input(el, "one-time-code", "000000");
    pressEnter(el, "one-time-code");
    await flush(el);
    expect(login).toHaveBeenLastCalledWith({
      email: "clinton@example.com",
      password: "correct horse battery",
      totp: "000000",
    });
    expect(await bottomOf(el)).toBe(t("login.failed"));
    expect(field(el, "one-time-code").error).toBe("");
    expect(el.shadowRoot!.querySelector("[data-test=submit-factor]")).not.toBeNull();
  });

  it("goes back from the code step to the password with the typed code forgotten", async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce({ code: "totp.required" })
      .mockResolvedValueOnce({ personId: "p1" });
    const { el } = await signInWithPassword({ login });
    input(el, "one-time-code", "123456");
    click(el, "back-to-password");
    await el.updateComplete;
    expect(field(el, "one-time-code")).toBeNull();
    click(el, "submit");
    await flush(el);
    expect(login).toHaveBeenLastCalledWith({
      email: "clinton@example.com",
      password: "correct horse battery",
    });
  });

  it("keeps the code step and its code while the code's sign-in is pending", async () => {
    const pending = deferred<{ personId: string }>();
    const login = vi
      .fn()
      .mockRejectedValueOnce({ code: "totp.required" })
      .mockReturnValueOnce(pending.promise);
    const { el } = await signInWithPassword({ login });
    input(el, "one-time-code", "123456");
    click(el, "submit-factor");
    await el.updateComplete;
    const back = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=back-to-password]",
    )!;
    expect(back.disabled).toBe(true);
    back.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe(t("login.factor_heading"));
    expect(field(el, "one-time-code").value).toBe("123456");
    pending.resolve({ personId: "p1" });
    await flush(el);
  });

  it("signs in with a recovery code, then asks for an authenticator code before adding a passkey", async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce({ code: "totp.required" })
      .mockResolvedValueOnce({ personId: "p1", offerPasskey: true });
    const { el, api } = await signInWithPassword({ login, ...passkeyRegistrationStubs() });
    const switchLink = () =>
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=switch-factor]")!;
    expect(field(el, "one-time-code").label).toBe(t("login.authenticator_code"));
    expect(switchLink().textContent).toBe(t("login.use_recovery_code"));

    input(el, "one-time-code", "123456");
    switchLink().click();
    await el.updateComplete;
    expect(field(el, "one-time-code").label).toBe(t("login.recovery_code"));
    expect(field(el, "one-time-code").value).toBe("");
    expect(switchLink().textContent).toBe(t("login.use_authenticator_code"));
    switchLink().click();
    await el.updateComplete;
    expect(field(el, "one-time-code").label).toBe(t("login.authenticator_code"));
    switchLink().click();
    await el.updateComplete;

    input(el, "one-time-code", " ABCD-EFGH ");
    pressEnter(el, "one-time-code");
    await flush(el);
    expect(login).toHaveBeenLastCalledWith({
      email: "clinton@example.com",
      password: "correct horse battery",
      recoveryCode: "ABCD-EFGH",
    });

    // A recovery code is spent by the sign-in, so adding a passkey asks for the authenticator.
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).not.toBeNull();
    expect(field(el, "one-time-code").label).toBe(t("login.authenticator_code"));
    expect(field(el, "one-time-code").value).toBe("");
    input(el, "one-time-code", "654321");
    pressEnter(el, "one-time-code");
    await flush(el);
    expect(api.passkeyRegisterOptions).toHaveBeenCalledWith({
      currentPassword: "correct horse battery",
      totp: "654321",
    });
  });
});

describe("login-screen: password reset by email", () => {
  it("sends a reset from the password step, and one resend when Resend is pressed twice", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const second = deferred<void>();
    const api = stubApi({
      requestPasswordReset: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockReturnValue(second.promise),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await openPassword(el, "bea@x.com");
    click(el, "reset-by-email");
    await flush(el);
    expect(api.requestPasswordReset).toHaveBeenCalledExactlyOnceWith("bea@x.com");
    expect(el.shadowRoot!.querySelector("[data-test=reset-sent]")!.textContent).toContain(
      "bea@x.com",
    );
    await vi.advanceTimersByTimeAsync(60_000);
    click(el, "resend-reset");
    click(el, "resend-reset");
    second.resolve();
    await flush(el);
    expect(api.requestPasswordReset).toHaveBeenCalledTimes(2);
  });

  it("starts no countdown when the reset answer arrives after the screen is removed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const request = deferred<void>();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ requestPasswordReset: vi.fn().mockReturnValue(request.promise) }),
    });
    await openPassword(el);
    click(el, "reset-by-email");
    el.remove();
    request.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("explains a refused reset and stays on the password step", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({
        requestPasswordReset: vi.fn().mockRejectedValue({ code: "account_action.rate_limited" }),
      }),
    });
    await openPassword(el);
    click(el, "reset-by-email");
    await flush(el);
    expect(await bottomOf(el)).toBe(codeMessage("account_action.rate_limited"));
    expect(el.shadowRoot!.querySelector("[data-test=reset-sent]")).toBeNull();
    expect(field(el, "password")).not.toBeNull();
  });
});

describe("login-screen: the passkey offer after sign-in", () => {
  async function offer(overrides: Partial<DashboardApi> = {}) {
    return signInWithPassword({
      login: vi.fn().mockResolvedValue({ personId: "p1", offerPasskey: true }),
      ...passkeyRegistrationStubs(),
      ...overrides,
    });
  }

  it("adds the passkey when Enter is pressed in its name", async () => {
    const { el, api } = await offer();
    input(el, "passkey-name", "Laptop");
    pressEnter(el, "passkey-name");
    await flush(el);
    expect(api.passkeyRegisterOptions).toHaveBeenCalledWith({
      currentPassword: "correct horse battery",
    });
  });

  it("reports a failed passkey ceremony with the passkey message and keeps the offer open", async () => {
    const { el } = await offer();
    vi.mocked(navigator.credentials.create).mockRejectedValue(
      new DOMException("Authenticator failed", "UnknownError"),
    );
    click(el, "setup-passkey");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(codeMessage("passkey.verification_failed")),
    );
    expect(el.shadowRoot!.querySelector("[data-test=setup-passkey]")).not.toBeNull();
  });

  it("does not sign in when the skip is recorded after the screen is removed", async () => {
    const { release, passkeyOfferSeen } = pendingOfferSeen();
    const { el } = await offer({ passkeyOfferSeen });
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    click(el, "skip-passkey");
    el.remove();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(0);
  });

  it("asks the device for no passkey when the registration options arrive after removal", async () => {
    const stubs = passkeyRegistrationStubs() as { passkeyRegisterOptions: () => Promise<unknown> };
    const registerOptions = await stubs.passkeyRegisterOptions();
    const options = deferred<unknown>();
    const { el } = await offer({
      passkeyRegisterOptions: vi.fn().mockReturnValue(options.promise),
    } as Partial<DashboardApi>);
    click(el, "setup-passkey");
    el.remove();
    options.resolve(registerOptions);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigator.credentials.create).not.toHaveBeenCalled();
  });

  it("does not register a passkey the device returns after the screen is removed", async () => {
    const { el, api } = await offer();
    const created = deferred<Credential | null>();
    const create = vi.mocked(navigator.credentials.create);
    const credential = await create.getMockImplementation()!();
    create.mockReturnValue(created.promise);
    click(el, "setup-passkey");
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    el.remove();
    created.resolve(credential);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.passkeyRegisterVerify).not.toHaveBeenCalled();
  });

  it("does not sign in when the registered passkey is confirmed after the screen is removed", async () => {
    const verified = deferred<unknown>();
    const { el, api } = await offer({
      passkeyRegisterVerify: vi.fn().mockReturnValue(verified.promise),
    } as Partial<DashboardApi>);
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    click(el, "setup-passkey");
    await vi.waitFor(() => expect(api.passkeyRegisterVerify).toHaveBeenCalled());
    el.remove();
    verified.resolve({ credentialId: "new-key" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.passkeyOfferSeen).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("shows no error for a ceremony that fails after the screen is removed", async () => {
    const { el } = await offer();
    const created = deferred<Credential | null>();
    const create = vi.mocked(navigator.credentials.create).mockReturnValue(created.promise);
    click(el, "setup-passkey");
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    await whileDetached(el, () =>
      created.reject(new DOMException("Authenticator failed", "UnknownError")),
    );
    expect(await bottomOf(el)).toBe("");
  });
});

describe("login-screen: signing in with a passkey", () => {
  it("asks the device once when the passkey button is pressed twice", async () => {
    const options = deferred<unknown>();
    const api = stubApi({ passkeyAuthOptions: vi.fn().mockReturnValue(options.promise) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await openPasskey(el);
    const button = el.shadowRoot!.querySelector<HTMLElement>("wt-button[data-test=passkey-login]")!;
    button.click();
    button.click();
    options.resolve({ challengeHandle: "h1", options: { challenge: "AQID" } });
    await flush(el);
    expect(api.passkeyAuthOptions).toHaveBeenCalledTimes(1);
  });

  it("ignores another way to sign in while a passkey prompt is pending", async () => {
    const api = stubApi({ passkeyAuthOptions: vi.fn(never) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await openPasskey(el);
    click(el, "passkey-login");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=use-password]")!.click();
    await el.updateComplete;
    expect(field(el, "password")).toBeNull();
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe(t("login.use_passkey_heading"));
  });

  it("asks the device nothing when the passkey options arrive after the screen is removed", async () => {
    const options = deferred<unknown>();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ passkeyAuthOptions: vi.fn().mockReturnValue(options.promise) }),
    });
    await openPasskey(el);
    click(el, "passkey-login");
    el.remove();
    options.resolve({ challengeHandle: "h1", options: { challenge: "AQID" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigator.credentials.get).not.toHaveBeenCalled();
  });

  it("does not sign in when the passkey is confirmed after the screen is removed", async () => {
    const verified = deferred<{ personId: string }>();
    const api = stubApi({ passkeyAuthVerify: vi.fn().mockReturnValue(verified.promise) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    await openPasskey(el);
    click(el, "passkey-login");
    await vi.waitFor(() => expect(api.passkeyAuthVerify).toHaveBeenCalled());
    el.remove();
    verified.resolve({ personId: "p9" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(0);
  });

  it("shows no error for a passkey refusal that arrives after the screen is removed", async () => {
    const verified = deferred<{ personId: string }>();
    const api = stubApi({ passkeyAuthVerify: vi.fn().mockReturnValue(verified.promise) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await openPasskey(el);
    click(el, "passkey-login");
    await vi.waitFor(() => expect(api.passkeyAuthVerify).toHaveBeenCalled());
    await whileDetached(el, () => verified.reject({ code: "connection.failed" }));
    expect(await bottomOf(el)).toBe("");
  });

  it.each(["NotSupportedError", "SecurityError", "UnknownError"])(
    "says the passkey could not be verified when the browser refuses the prompt with %s",
    async (name) => {
      vi.mocked(navigator.credentials.get).mockRejectedValueOnce(new DOMException("Refused", name));
      const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
      await openPasskey(el);
      click(el, "passkey-login");
      await flush(el);
      expect(await bottomOf(el)).toBe(codeMessage("passkey.verification_failed"));
    },
  );

  it("returns to the password without an error when the passkey prompt is aborted", async () => {
    vi.mocked(navigator.credentials.get).mockRejectedValueOnce(
      new DOMException("Aborted", "AbortError"),
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPasskey(el);
    click(el, "passkey-login");
    await flush(el);
    expect(field(el, "password")).not.toBeNull();
    expect(await bottomOf(el)).toBe("");
  });
});

describe("login-screen: passkey autofill on the email step", () => {
  it("signs in with the passkey the browser offers in the email field", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    const events: CustomEvent[] = [];
    el.addEventListener("logged-in", (e) => events.push(e as CustomEvent));
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(api.passkeyAuthVerify).toHaveBeenCalledWith({
      challengeHandle: "h1",
      response: expect.objectContaining({ id: "cred-abc" }),
    });
    expect(events[0]!.detail).toEqual({
      personId: "p9",
      loginMethod: "passkey",
      rememberEmail: false,
    });
    expect(events[0]!.bubbles && events[0]!.composed).toBe(true);
  });

  it("offers no autofill when the browser cannot say whether it supports it", async () => {
    conditionalMediationAvailable.mockRejectedValue(new Error("unavailable"));
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    try {
      const api = stubApi();
      const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
      await flush(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(conditionalMediationAvailable).toHaveBeenCalled();
      expect(api.passkeyAuthOptions).not.toHaveBeenCalled();
      expect(await bottomOf(el)).toBe("");
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", unhandled);
    }
  });

  it("asks the device nothing when the autofill options arrive after the email step is left", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const options = deferred<unknown>();
    const api = stubApi({ passkeyAuthOptions: vi.fn().mockReturnValue(options.promise) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(() => expect(api.passkeyAuthOptions).toHaveBeenCalled());
    await continueWithEmail(el);
    options.resolve({ challengeHandle: "h1", options: { challenge: "AQID" } });
    await flush(el);
    expect(navigator.credentials.get).not.toHaveBeenCalled();
    expect(field(el, "password")).not.toBeNull();
  });

  it("does not confirm an autofilled passkey the browser returns after the screen is removed", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const got = deferred<Credential | null>();
    vi.mocked(navigator.credentials.get).mockReturnValueOnce(got.promise);
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalled());
    el.remove();
    got.resolve(passkeyCredential());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.passkeyAuthVerify).not.toHaveBeenCalled();
  });

  it("does not sign in when an autofilled passkey is confirmed after the screen is removed", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const verified = deferred<{ personId: string }>();
    const api = stubApi({ passkeyAuthVerify: vi.fn().mockReturnValue(verified.promise) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    const events: Event[] = [];
    el.addEventListener("logged-in", (e) => events.push(e));
    await vi.waitFor(() => expect(api.passkeyAuthVerify).toHaveBeenCalled());
    el.remove();
    verified.resolve({ personId: "p9" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(0);
  });

  it("shows no error when the person dismisses the autofill prompt", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    vi.mocked(navigator.credentials.get).mockRejectedValueOnce(
      new DOMException("Dismissed", "NotAllowedError"),
    );
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalled());
    await flush(el);
    expect(await bottomOf(el)).toBe("");
    expect(field(el, "email")).not.toBeNull();
  });

  it.each([
    [
      "NotSupportedError",
      "Resident credentials or empty 'allowCredentials' lists are not supported",
    ],
    ["SecurityError", "The operation is insecure."],
    ["UnknownError", "The authenticator failed."],
  ])(
    "shows no error on first load when the browser refuses autofill with %s",
    async (name, msg) => {
      conditionalMediationAvailable.mockResolvedValue(true);
      vi.mocked(navigator.credentials.get).mockRejectedValueOnce(new DOMException(msg, name));
      const api = stubApi();
      const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
      await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalled());
      await flush(el);
      expect(await bottomOf(el)).toBe("");
      expect(field(el, "email")).not.toBeNull();
    },
  );

  it("still shows the server's refusal of an autofilled passkey", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const api = stubApi({
      passkeyAuthVerify: vi.fn().mockRejectedValue({ code: "passkey.verification_failed" }),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(() => expect(api.passkeyAuthVerify).toHaveBeenCalled());
    await flush(el);
    expect(await bottomOf(el)).toBe(codeMessage("passkey.verification_failed"));
  });

  it("says the passkey could not be verified when the server's answer to an autofilled passkey cannot be read", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    let readFailed = false;
    const real = new DashboardApi("", async (path) =>
      String(path).endsWith("verify")
        ? new Response(
            new ReadableStream({
              pull(controller) {
                readFailed = true;
                controller.error(new TypeError("network connection lost while reading response"));
              },
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ challengeHandle: "h1", options: { challenge: "AQID" } })),
    );
    const api = stubApi({
      passkeyAuthOptions: real.passkeyAuthOptions.bind(real),
      passkeyAuthVerify: real.passkeyAuthVerify.bind(real),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    await vi.waitFor(() => expect(readFailed).toBe(true));
    await flush(el);
    expect(loggedIn).not.toHaveBeenCalled();
    expect(await bottomOf(el)).toBe(codeMessage("passkey.verification_failed"));
  });

  it.each([
    ["an HTML page", "<!doctype html><title>Sign in to the Wi-Fi</title>", 200],
    ["JSON null", "null", 200],
    ["an empty 200", "", 200],
    ["a 204 with no body", null, 204],
  ])(
    "shows no error on first load when the passkey options answer is %s",
    async (_what, body, status) => {
      conditionalMediationAvailable.mockResolvedValue(true);
      const fetchOptions = vi.fn(
        async () => new Response(body, { status, headers: { "content-type": "text/html" } }),
      );
      const real = new DashboardApi("", fetchOptions);
      const api = stubApi({ passkeyAuthOptions: real.passkeyAuthOptions.bind(real) });
      const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
      await vi.waitFor(() => expect(fetchOptions).toHaveBeenCalled());
      await flush(el);
      await flush(el);
      expect(navigator.credentials.get).not.toHaveBeenCalled();
      expect(await bottomOf(el)).toBe("");
      expect(field(el, "email")).not.toBeNull();
    },
  );

  it("says the passkey could not be verified when a press gets passkey options that are not JSON", async () => {
    const real = new DashboardApi(
      "",
      async () =>
        new Response("<!doctype html><title>Sign in to the Wi-Fi</title>", { status: 200 }),
    );
    const api = stubApi({ passkeyAuthOptions: real.passkeyAuthOptions.bind(real) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await continueWithEmail(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(codeMessage("passkey.verification_failed")),
    );
  });

  it("still shows the server's refusal of the passkey options on first load", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const real = new DashboardApi(
      "",
      async () =>
        new Response(JSON.stringify({ error: { code: "server.internal" } }), { status: 503 }),
    );
    const api = stubApi({ passkeyAuthOptions: real.passkeyAuthOptions.bind(real) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(codeMessage("server.internal")));
  });

  it("still shows an error on first load when the passkey options body fails while being read", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const real = new DashboardApi(
      "",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("network error"));
            },
          }),
          { status: 200 },
        ),
    );
    const api = stubApi({ passkeyAuthOptions: real.passkeyAuthOptions.bind(real) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(codeMessage("passkey.verification_failed")),
    );
  });

  it("still says the options request failed when the server cannot be reached on first load", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const real = new DashboardApi("", async () => {
      throw new TypeError("Failed to fetch");
    });
    const api = stubApi({ passkeyAuthOptions: real.passkeyAuthOptions.bind(real) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(codeMessage("connection.failed")));
  });

  it("shows no error for an autofill failure that arrives after the screen is removed", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const verified = deferred<{ personId: string }>();
    const api = stubApi({
      passkeyAuthVerify: vi.fn().mockReturnValue(verified.promise),
      passkeyAuthOptions: vi
        .fn()
        .mockResolvedValueOnce({ challengeHandle: "h1", options: { challenge: "AQID" } })
        .mockImplementation(never),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(() => expect(api.passkeyAuthVerify).toHaveBeenCalled());
    await whileDetached(el, () => verified.reject({ code: "connection.failed" }));
    expect(await bottomOf(el)).toBe("");
  });
});

describe("login-screen: errors at the bottom of the form, not above it", () => {
  type Form = {
    name: string;
    open: () => Promise<LoginScreen>;
    field: string;
    action: string;
    bad: string;
    good: string;
    message: string;
  };
  const forms: Form[] = [
    {
      name: "email",
      open: async () =>
        (await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() })).el,
      field: "email",
      action: "continue",
      bad: "",
      good: "owner@x.com",
      message: t("form.email_required"),
    },
    {
      name: "password",
      open: async () => {
        const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
          api: stubApi(),
        });
        await openPassword(el);
        return el;
      },
      field: "password",
      action: "submit",
      bad: "",
      good: "correct horse",
      message: t("form.password_required"),
    },
    {
      name: "authenticator code",
      open: async () =>
        (
          await signInWithPassword({
            login: vi
              .fn()
              .mockRejectedValueOnce({ code: "totp.required" })
              .mockImplementation(never),
          })
        ).el,
      field: "one-time-code",
      action: "submit-factor",
      bad: "",
      good: "123456",
      message: t("form.factor_required"),
    },
    {
      name: "passkey offer",
      open: async () => (await mountPasskeyOffer({ passkeyRegisterOptions: vi.fn(never) })).el,
      field: "passkey-name",
      action: "setup-passkey",
      bad: "x".repeat(81),
      good: "Laptop",
      message: t("profile.passkey_name_too_long"),
    },
    {
      name: "account setup",
      open: async () => {
        history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
        const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
          api: stubApi({ completeAccountAction: vi.fn(never) }),
        });
        await flush(el);
        input(el, "new-pin", "4321");
        return el;
      },
      field: "new-password",
      action: "complete-account",
      bad: "short",
      good: "new password",
      message: codeMessage("password.too_short"),
    },
  ];
  const action = (el: LoginScreen, test: string) =>
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-test=${test}]`)!;
  const nativeDisabled = async (el: LoginScreen, test: string): Promise<boolean> => {
    const button = action(el, test) as ReturnType<typeof action> & {
      updateComplete: Promise<unknown>;
    };
    await button.updateComplete;
    return button.shadowRoot!.querySelector("button")!.disabled;
  };

  it.each(forms)(
    "$name: says nothing until submitted, then marks the field, focuses it and waits for it",
    async (form) => {
      const el = await form.open();
      input(el, form.field, form.bad);
      await el.updateComplete;
      expect(field(el, form.field).error).toBe("");
      expect(await bottomOf(el)).toBe("");
      expect(action(el, form.action).disabled).toBe(false);

      click(el, form.action);
      await flush(el);
      expect(field(el, form.field).error).toBe(form.message);
      expect(await bottomOf(el)).toBe(t("form.fix_fields"));
      expect(action(el, form.action).disabled).toBe(true);
      expect(field(el, form.field).value).toBe(form.bad);
      await vi.waitFor(() =>
        expect(field(el, form.field).shadowRoot!.activeElement).toBe(
          field(el, form.field).shadowRoot!.querySelector("input"),
        ),
      );

      input(el, form.field, form.good);
      await el.updateComplete;
      expect(field(el, form.field).error).toBe("");
      expect(await bottomOf(el)).toBe("");
      expect(action(el, form.action).disabled).toBe(false);

      input(el, form.field, form.bad);
      await el.updateComplete;
      expect(field(el, form.field).error).toBe(form.message);
      expect(await bottomOf(el)).toBe(t("form.fix_fields"));
      expect(action(el, form.action).disabled).toBe(true);
    },
  );

  const refusals = [
    {
      name: "a short new password",
      open: async () => {
        history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
        const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
          api: stubApi({
            completeAccountAction: vi.fn().mockRejectedValue({ code: "password.too_short" }),
          }),
        });
        await flush(el);
        input(el, "new-password", "new password");
        input(el, "new-pin", "4321");
        click(el, "complete-account");
        await flush(el);
        return el;
      },
      field: "new-password",
      action: "complete-account",
      code: "password.too_short",
    },
    {
      name: "a short new PIN",
      open: async () => {
        history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
        const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
          api: stubApi({
            completeAccountAction: vi
              .fn()
              .mockRejectedValue({ code: "pin.too_short", params: { min: 4 } }),
          }),
        });
        await flush(el);
        input(el, "new-password", "new password");
        input(el, "new-pin", "4321");
        click(el, "complete-account");
        await flush(el);
        return el;
      },
      field: "new-pin",
      action: "complete-account",
      code: "pin.too_short",
    },
    {
      name: "a refused passkey name",
      open: async () => {
        const { el } = await mountPasskeyOffer({
          passkeyRegisterOptions: vi
            .fn()
            .mockRejectedValue({ code: "profile.invalid", params: { field: "passkeyName" } }),
        });
        input(el, "passkey-name", "Work laptop");
        click(el, "setup-passkey");
        await flush(el);
        return el;
      },
      field: "passkey-name",
      action: "setup-passkey",
      code: "profile.invalid",
    },
  ];

  it.each(refusals)(
    "$name: shows the refusal under its field, focuses it, and leaves the action working until that field changes",
    async (refusal) => {
      const el = await refusal.open();
      expect(field(el, refusal.field).error).toBe(codeMessage(refusal.code));
      expect(await bottomOf(el)).toBe(t("form.fix_fields"));
      expect(await nativeDisabled(el, refusal.action)).toBe(false);
      await vi.waitFor(() =>
        expect(field(el, refusal.field).shadowRoot!.activeElement).toBe(
          field(el, refusal.field).shadowRoot!.querySelector("input"),
        ),
      );

      input(el, refusal.field, "another value");
      await el.updateComplete;
      expect(field(el, refusal.field).error).toBe("");
      expect(await bottomOf(el)).toBe("");
      expect(action(el, refusal.action).disabled).toBe(false);
    },
  );

  it("shows a refused authenticator code during the passkey offer under the code field, waiting for a code in the field it reveals", async () => {
    const { el } = await mountPasskeyOffer({
      passkeyRegisterOptions: vi.fn().mockRejectedValue({ code: "totp.invalid" }),
    });
    click(el, "setup-passkey");
    await flush(el);
    expect(field(el, "one-time-code").error).toBe(codeMessage("totp.invalid"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await nativeDisabled(el, "setup-passkey")).toBe(true);
    input(el, "one-time-code", "654321");
    await el.updateComplete;
    expect(field(el, "one-time-code").error).toBe("");
    expect(await nativeDisabled(el, "setup-passkey")).toBe(false);
  });

  it("keeps the action waiting on a field emptied while a request was out, even when the refusal names it", async () => {
    const answer = deferred<{ personId: string; authenticated: boolean }>();
    history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ completeAccountAction: vi.fn().mockReturnValue(answer.promise) }),
    });
    await flush(el);
    input(el, "new-password", "new password");
    input(el, "new-pin", "4321");
    click(el, "complete-account");
    await el.updateComplete;
    input(el, "new-password", "");
    await el.updateComplete;
    answer.reject({ code: "password.too_short" });
    await flush(el);
    expect(field(el, "new-password").error).toBe(codeMessage("password.too_short"));
    expect(await nativeDisabled(el, "complete-account")).toBe(true);

    input(el, "new-password", "another password");
    await el.updateComplete;
    expect(field(el, "new-password").error).toBe("");
    expect(await nativeDisabled(el, "complete-account")).toBe(false);
  });

  it.each([
    ["the password step", "submit", undefined],
    ["the authenticator code step", "submit-factor", "123456"],
  ])(
    "on %s, a refusal naming no field leaves the action working and goes on the next submission",
    async (_where, test, code) => {
      const answer = deferred<{ personId: string }>();
      const login = vi.fn();
      if (code !== undefined) login.mockRejectedValueOnce({ code: "totp.required" });
      login.mockRejectedValueOnce({ code: "server.internal" }).mockReturnValue(answer.promise);
      const { el } = await signInWithPassword({ login });
      if (code !== undefined) {
        input(el, "one-time-code", code);
        click(el, test);
        await flush(el);
      }
      expect(await bottomOf(el)).toBe(codeMessage("server.internal"));
      expect(action(el, test).disabled).toBe(false);
      expect([...el.shadowRoot!.querySelectorAll("wt-input")].map((f) => f.error)).toEqual([
        "",
        "",
      ]);

      click(el, test);
      await el.updateComplete;
      expect(await bottomOf(el)).toBe("");
      answer.resolve({ personId: "p1" });
      await flush(el);
    },
  );

  it("leaves Set password working after a refusal that names no field", async () => {
    history.replaceState(null, "", "/manage/account?token=token-1&purpose=invitation");
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({
        completeAccountAction: vi.fn().mockRejectedValue({ code: "account_action.invalid" }),
      }),
    });
    await flush(el);
    input(el, "new-password", "new password");
    input(el, "new-pin", "4321");
    click(el, "complete-account");
    await flush(el);
    expect(await bottomOf(el)).toBe(codeMessage("account_action.invalid"));
    expect(action(el, "complete-account").disabled).toBe(false);
  });

  it("keeps a passkey-offer refusal naming a field the offer does not show in the bottom message", async () => {
    const { el } = await mountPasskeyOffer({
      passkeyRegisterOptions: vi
        .fn()
        .mockRejectedValue({ code: "profile.invalid", params: { field: "displayName" } }),
    });
    click(el, "setup-passkey");
    await flush(el);
    expect(field(el, "passkey-name").error).toBe("");
    expect(await bottomOf(el)).toBe(codeMessage("profile.invalid"));
    expect(await nativeDisabled(el, "setup-passkey")).toBe(false);
  });

  it("leaves Add passkey working after a refusal that names no field", async () => {
    const { el } = await mountPasskeyOffer({
      passkeyRegisterOptions: vi.fn().mockRejectedValue({ code: "passkey.verification_failed" }),
    });
    click(el, "setup-passkey");
    await flush(el);
    expect(await bottomOf(el)).toBe(codeMessage("passkey.verification_failed"));
    expect(action(el, "setup-passkey").disabled).toBe(false);
  });

  it("shows a refusal and the generic sentence together when a field breaks after it", async () => {
    const { el } = await signInWithPassword({
      login: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    input(el, "password", "");
    await el.updateComplete;
    expect(field(el, "password").error).toBe(t("form.password_required"));
    expect(await bottomOf(el)).toBe(`${codeMessage("server.internal")} ${t("form.fix_fields")}`);
    expect(action(el, "submit").disabled).toBe(true);
  });

  it("starts the code step again when going back to the password and on", async () => {
    const { el } = await signInWithPassword({
      login: vi
        .fn()
        .mockRejectedValueOnce({ code: "totp.required" })
        .mockRejectedValueOnce({ code: "password.invalid" })
        .mockRejectedValueOnce({ code: "totp.required" })
        .mockImplementation(never),
    });
    input(el, "one-time-code", "000000");
    click(el, "submit-factor");
    await flush(el);
    expect(await bottomOf(el)).toBe(t("login.failed"));
    click(el, "back-to-password");
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("");
    click(el, "submit");
    await flush(el);
    expect(field(el, "one-time-code").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(action(el, "submit-factor").disabled).toBe(false);
  });
});

describe("login-screen: a refused sign-in says only that the login failed", () => {
  // Owner rule (C95): a login refusal must not say whether the account exists, so it names no
  // field; a message under the password or code field would say the earlier details were right.
  const marked = (el: LoginScreen, name: string) =>
    field(el, name).shadowRoot!.querySelector("input")!.getAttribute("aria-invalid") === "true";
  const actionOf = (el: LoginScreen, test: string) =>
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-test=${test}]`)!;

  it("on the password step, says the login failed above the action and marks no field", async () => {
    const { el } = await signInWithPassword({
      login: vi.fn().mockRejectedValue({ code: "password.invalid" }),
    });
    expect(await bottomOf(el)).toBe(t("login.failed"));
    expect(field(el, "password").error).toBe("");
    expect(marked(el, "password")).toBe(false);
    expect(field(el, "password").value).toBe("correct horse battery");
    expect(actionOf(el, "submit").disabled).toBe(false);
    await vi.waitFor(() =>
      expect(field(el, "password").shadowRoot!.activeElement).toBe(
        field(el, "password").shadowRoot!.querySelector("input"),
      ),
    );
  });

  it("on the code step, says the login failed above the action, marks no field, and empties the code with the cursor in it", async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce({ code: "totp.required" })
      .mockRejectedValueOnce({ code: "password.invalid" })
      .mockImplementation(never);
    const { el } = await signInWithPassword({ login });
    input(el, "one-time-code", "000000");
    click(el, "submit-factor");
    await flush(el);
    expect(await bottomOf(el)).toBe(t("login.failed"));
    expect(field(el, "one-time-code").error).toBe("");
    expect(marked(el, "one-time-code")).toBe(false);
    expect(field(el, "one-time-code").value).toBe("");
    expect(actionOf(el, "submit-factor").disabled).toBe(false);
    await vi.waitFor(() =>
      expect(field(el, "one-time-code").shadowRoot!.activeElement).toBe(
        field(el, "one-time-code").shadowRoot!.querySelector("input"),
      ),
    );

    input(el, "one-time-code", "123456");
    click(el, "submit-factor");
    await el.updateComplete;
    expect(login).toHaveBeenLastCalledWith({
      email: "clinton@example.com",
      password: "correct horse battery",
      totp: "123456",
    });
    expect(await bottomOf(el)).toBe("");
  });

  it("leaves the refusal behind when a reset link is asked for while the last one's minute runs", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ login: vi.fn().mockRejectedValue({ code: "password.invalid" }) }),
    });
    await flush(el);
    await openPassword(el, "bea@x.com");
    click(el, "reset-by-email");
    await flush(el);
    click(el, "change-account");
    await el.updateComplete;
    await openPassword(el, "bea@x.com");
    input(el, "password", "wrong horse");
    click(el, "submit");
    await flush(el);
    expect(await bottomOf(el)).toBe(t("login.failed"));

    click(el, "reset-by-email");
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=reset-sent]")).not.toBeNull();
    expect(await bottomOf(el)).toBe("");
  });

  it("keeps a signed-in password re-check's own wording when adding a passkey after sign-in", async () => {
    const { el } = await mountPasskeyOffer({
      passkeyRegisterOptions: vi.fn().mockRejectedValue({ code: "password.invalid" }),
    });
    click(el, "setup-passkey");
    await flush(el);
    expect(await bottomOf(el)).toBe(codeMessage("password.invalid"));
  });
});

describe("login-screen: the sign-in card", () => {
  let restoreLocale: ReturnType<typeof currentLocale>;
  let restoreViewport: [number, number];
  beforeEach(() => {
    restoreLocale = currentLocale();
    restoreViewport = [window.innerWidth, window.innerHeight];
  });
  afterEach(async () => {
    setLocale(restoreLocale);
    await page.viewport(...restoreViewport);
  });

  const withoutGoogle = () =>
    stubApi({ getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }) });

  /** A token's resolved value for one CSS property, read off a probe inside the screen. */
  function tokenValue(el: LoginScreen, property: string, value: string): string {
    const probe = document.createElement("div");
    probe.style.setProperty(property, value);
    el.shadowRoot!.appendChild(probe);
    const resolved = getComputedStyle(probe).getPropertyValue(property);
    probe.remove();
    return resolved;
  }

  function card(el: LoginScreen): HTMLElement {
    return el.shadowRoot!.querySelector<HTMLElement>(".screen")!;
  }

  /** The card's content box: inside its border and padding. */
  function contentBox(el: LoginScreen) {
    const screen = card(el);
    const box = screen.getBoundingClientRect();
    const style = getComputedStyle(screen);
    return {
      left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
    };
  }

  /** The step's ways in and the "or" between them, in order, by `data-test`. */
  function methodControls(el: LoginScreen): HTMLElement[] {
    return [
      ...el.shadowRoot!.querySelectorAll<HTMLElement>(
        ".screen wt-button[variant=primary], .screen wt-button[variant=secondary], [data-test=login-or]",
      ),
    ].filter((control) => !control.matches("wt-form-actions *"));
  }

  const order = (el: LoginScreen) => methodControls(el).map((control) => control.dataset.test);

  async function openFactor() {
    const login = vi.fn().mockRejectedValueOnce({ code: "totp.required" });
    const { el } = await signInWithPassword({ login });
    return el;
  }

  async function openAccountAction() {
    history.replaceState(null, "", "/manage/account?token=setup&purpose=invitation");
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    return el;
  }

  async function openResetSent() {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    await openPassword(el, "bea@x.com");
    click(el, "reset-by-email");
    await flush(el);
    return el;
  }

  async function mountOn(open?: (el: LoginScreen) => Promise<void>, api = stubApi()) {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await flush(el);
    if (open) await open(el);
    await flush(el);
    return el;
  }

  const steps: ReadonlyArray<readonly [string, () => Promise<LoginScreen>]> = [
    ["email", () => mountOn()],
    ["password", () => mountOn(openPassword)],
    ["passkey", () => mountOn(openPasskey)],
    ["Google", () => mountOn(openGoogle)],
    ["code", openFactor],
    ["Check your email", openResetSent],
    ["passkey offer", async () => (await mountPasskeyOffer()).el],
    ["account setup", openAccountAction],
  ];

  it.each(steps)(
    "draws the %s step as a card with the Waitron logo first, above the heading",
    async (_step, open) => {
      const el = await open();
      const screen = card(el);
      const style = getComputedStyle(screen);
      expect(style.borderTopWidth).toBe("1px");
      expect(style.borderTopStyle).toBe("solid");
      expect(style.borderTopColor).toBe(tokenValue(el, "color", "var(--wt-color-border)"));
      expect(style.backgroundColor).toBe(
        tokenValue(el, "background-color", "var(--wt-color-surface-raised)"),
      );
      expect(style.borderTopLeftRadius).toBe(
        tokenValue(el, "border-top-left-radius", "var(--wt-radius-lg)"),
      );
      const logo = screen.querySelector<HTMLElement>("[data-test=login-logo]");
      expect(logo).not.toBeNull();
      expect(screen.firstElementChild).toBe(logo);
      expect(logo!.querySelector("svg")).not.toBeNull();
      // The banner above already names Waitron, so the card's logo is decoration.
      expect(logo!.getAttribute("aria-hidden")).toBe("true");
      const heading = screen.querySelector("h1")!;
      expect(
        logo!.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it.each(["light", "dark"] as const)(
    "paints the logo's waiter in the primary colour and its word in the text colour (%s theme)",
    async (theme) => {
      const { el } = await mountWidget<LoginScreen>(
        "dashboard-login-screen",
        { api: stubApi() },
        theme,
      );
      const svg = el.shadowRoot!.querySelector("[data-test=login-logo] svg")!;
      // Found by the brand file's own ink, not by position, so a reordered file fails here.
      const waiter = svg.querySelector(':scope > g[fill="#1f6feb"]')!;
      const word = svg.querySelector(':scope > g[fill="#16181d"]')!;
      expect(getComputedStyle(waiter).fill).toBe(
        tokenValue(el, "color", "var(--wt-color-primary)"),
      );
      expect(getComputedStyle(word).fill).toBe(tokenValue(el, "color", "var(--wt-color-text)"));
    },
  );

  const methodPages = [
    ["email", undefined, ["continue", "login-or", "google-login"]],
    ["password", openPassword, ["submit", "login-or", "passkey-login", "google-login"]],
    ["passkey", openPasskey, ["passkey-login", "login-or", "use-password", "google-login"]],
    ["Google", openGoogle, ["google-login", "login-or", "use-password", "passkey-login"]],
  ] as const;
  const viewports = [
    ["en-GB", 1280, 900],
    ["es-ES", 1280, 900],
    ["en-GB", 390, 844],
    ["es-ES", 390, 844],
  ] as const;
  const pagesAtViewports = methodPages.flatMap(([step, open, expected]) =>
    viewports.map(
      ([locale, width, height]) => [step, locale, width, height, open, expected] as const,
    ),
  );

  it.each(pagesAtViewports)(
    "the %s page shows its one primary button, then or, then the other ways in, each the card's width (%s, %i px)",
    async (_step, locale, width, height, open, expected) => {
      setLocale(locale);
      await page.viewport(width, height);
      const el = await mountOn(open);
      expect(order(el)).toEqual(expected);
      expect(el.shadowRoot!.querySelectorAll("wt-button[variant=primary]")).toHaveLength(1);
      expect(el.shadowRoot!.querySelector("[data-test=login-or]")!.textContent!.trim()).toBe(
        t("login.or"),
      );
      const content = contentBox(el);
      for (const control of methodControls(el)) {
        const box = control.getBoundingClientRect();
        expect(Math.abs(box.left - content.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.right - content.right)).toBeLessThanOrEqual(1);
      }
      const screen = card(el).getBoundingClientRect();
      for (const node of card(el).querySelectorAll("*")) {
        const box = node.getBoundingClientRect();
        if (box.width === 0) continue;
        expect(box.left).toBeGreaterThanOrEqual(screen.left - 0.5);
        expect(box.right).toBeLessThanOrEqual(screen.right + 0.5);
      }
    },
  );

  it.each([
    ["email", undefined, ["continue"]],
    ["password", openPassword, ["submit", "login-or", "passkey-login"]],
    ["passkey", openPasskey, ["passkey-login", "login-or", "use-password"]],
  ] as const)(
    "without Google set up, the %s page offers only the ways in it has",
    async (_step, open, expected) => {
      const el = await mountOn(open, withoutGoogle());
      expect(order(el)).toEqual(expected);
    },
  );

  it.each([
    ["password", openPassword, "submit"],
    ["passkey", openPasskey, "passkey-login"],
    ["Google", openGoogle, "google-login"],
  ] as const)(
    "each other way in on the %s page has an icon hidden from assistive technology, and is named by its label",
    async (_step, open, primary) => {
      const el = await mountOn(open);
      const others = methodControls(el).filter(
        (control) => control.matches("wt-button") && control.dataset.test !== primary,
      );
      expect(others.length).toBeGreaterThan(0);
      const iconSize = tokenValue(el, "width", "var(--wt-font-size-lg)");
      for (const other of others) {
        const icons = other.querySelectorAll("svg, img");
        expect(icons).toHaveLength(1);
        const icon = icons[0]!;
        if (icon instanceof HTMLImageElement) expect(icon.getAttribute("alt")).toBe("");
        else expect(icon.getAttribute("aria-hidden")).toBe("true");
        expect(getComputedStyle(icon).width).toBe(iconSize);
        const label = other.textContent!.trim();
        expect(label).not.toBe("");
        expect(
          await page.getByRole("button", { name: label, exact: true }).elements(),
        ).toHaveLength(1);
      }
      if (others.some((other) => other.dataset.test === "google-login"))
        expect(
          el
            .shadowRoot!.querySelector<HTMLImageElement>("[data-test=google-login] img")!
            .getAttribute("src"),
        ).toBe(new URL("../assets/google-g.svg", import.meta.url).href);
    },
  );

  it.each([1280, 390])(
    "puts I've forgotten my password under the password field, at the card's right, above Log in (%ipx)",
    async (width) => {
      await page.viewport(width, 900);
      const el = await mountOn(openPassword);
      const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=reset-by-email]")!;
      expect(link).not.toBeNull();
      expect(link.textContent!.trim()).toBe(t("login.reset_by_email"));
      const box = link.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(field(el, "password").getBoundingClientRect().bottom);
      expect(box.bottom).toBeLessThanOrEqual(
        el.shadowRoot!.querySelector("[data-test=submit]")!.getBoundingClientRect().top,
      );
      expect(Math.abs(box.right - contentBox(el).right)).toBeLessThanOrEqual(1);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    },
  );

  it.each([
    ["email", undefined],
    ["passkey", openPasskey],
    ["Google", openGoogle],
  ] as const)("does not offer I've forgotten my password on the %s page", async (_step, open) => {
    const el = await mountOn(open);
    expect(el.shadowRoot!.querySelector("[data-test=reset-by-email]")).toBeNull();
  });

  it.each([1280, 390])(
    "puts a refusal's message on its own line above the primary button, from the card's left (%ipx)",
    async (width) => {
      await page.viewport(width, 900);
      const api = stubApi({
        passkeyAuthVerify: vi.fn().mockRejectedValue({ code: "passkey.challenge_expired" }),
      });
      const el = await mountOn(openPasskey, api);
      click(el, "passkey-login");
      await flush(el);
      const message = (await bottomMessageOf(el))!;
      expect(message.textContent!.trim()).toBe(codeMessage("passkey.challenge_expired"));
      const box = message.getBoundingClientRect();
      const primary = el.shadowRoot!.querySelector("wt-button[data-test=passkey-login]")!;
      expect(message.nextElementSibling).toBe(primary);
      const button = primary.getBoundingClientRect();
      expect(box.bottom).toBeLessThanOrEqual(button.top);
      expect(Math.abs(box.left - contentBox(el).left)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.right - contentBox(el).right)).toBeLessThanOrEqual(1);
      expect(getComputedStyle(message).textAlign).toBe("start");
    },
  );

  it.each([1280, 390])(
    "on the code step, puts the code switch under the field at the right, Back at the bottom left and Log in at the bottom right (%ipx)",
    async (width) => {
      await page.viewport(width, 900);
      const el = await openFactor();
      const content = contentBox(el);
      const heading = el.shadowRoot!.querySelector("h1")!;
      const chosen = el.shadowRoot!.querySelector("[data-test=login-context]")!;
      expect(
        heading.compareDocumentPosition(chosen) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const link = el.shadowRoot!.querySelector<HTMLElement>("a[data-test=switch-factor]")!;
      const linkBox = link.getBoundingClientRect();
      const back = el.shadowRoot!.querySelector("[data-test=back-to-password]")!;
      const submit = el.shadowRoot!.querySelector("[data-test=submit-factor]")!;
      expect(back.getAttribute("slot")).toBe("cancel");
      expect(linkBox.top).toBeGreaterThanOrEqual(
        field(el, "one-time-code").getBoundingClientRect().bottom,
      );
      expect(linkBox.bottom).toBeLessThanOrEqual(back.getBoundingClientRect().top);
      expect(Math.abs(linkBox.right - content.right)).toBeLessThanOrEqual(1);
      expect(linkBox.height).toBeGreaterThanOrEqual(44);
      expect(linkBox.width).toBeGreaterThanOrEqual(44);
      expect(Math.abs(back.getBoundingClientRect().left - content.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(submit.getBoundingClientRect().right - content.right)).toBeLessThanOrEqual(1);
      expect(el.shadowRoot!.querySelector("ul")).toBeNull();
    },
  );
});

describe("login-screen: Google on the first page", () => {
  it("starts Google with no email typed, asking nothing about the address", async () => {
    const api = stubApi();
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api, navigate });
    await flush(el);
    click(el, "google-login");
    await flush(el);
    expect(api.beginGoogleLogin).toHaveBeenCalledExactlyOnceWith();
    expect(navigate).toHaveBeenCalledExactlyOnceWith("https://accounts.google.test/login");
    expect(field(el, "email").error).toBe("");
  });

  it("shows the same choices whatever email is typed", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await flush(el);
    const controls = () =>
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test]")].map((c) => c.dataset.test);
    const empty = controls();
    expect(empty).toContain("google-login");
    for (const email of ["owner@example.com", "nobody@nowhere.test", "not-an-email"]) {
      input(el, "email", email);
      await el.updateComplete;
      expect(controls()).toEqual(empty);
    }
  });

  it("still starts Google after Continue was pressed with no email", async () => {
    const api = stubApi();
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api, navigate });
    await flush(el);
    click(el, "continue");
    await el.updateComplete;
    const button = (test: string) =>
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(`[data-test=${test}]`)!;
    expect(field(el, "email").error).toBe(t("form.email_required"));
    expect(button("continue").disabled).toBe(true);
    expect(button("google-login").disabled).toBe(false);
    click(el, "google-login");
    await flush(el);
    expect(api.beginGoogleLogin).toHaveBeenCalledExactlyOnceWith();
    expect(navigate).toHaveBeenCalledExactlyOnceWith("https://accounts.google.test/login");
  });

  it("holds Continue while Google is starting", async () => {
    const begin = deferred<{ authorizationUrl: string }>();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi({ beginGoogleLogin: vi.fn().mockReturnValue(begin.promise) }),
      navigate: vi.fn(),
    });
    await flush(el);
    input(el, "email", "owner@example.com");
    click(el, "google-login");
    await el.updateComplete;
    const go = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=continue]",
    )!;
    expect(go.disabled).toBe(true);
    begin.resolve({ authorizationUrl: "https://accounts.google.test/login" });
    await flush(el);
  });

  it("does not sign in with an autofilled passkey the browser returns after Google was chosen", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const got = deferred<Credential | null>();
    vi.mocked(navigator.credentials.get).mockReturnValueOnce(got.promise);
    const api = stubApi();
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api, navigate });
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalledTimes(1));
    const { signal } = vi.mocked(navigator.credentials.get).mock.calls[0]![0]!;
    await flush(el);
    click(el, "google-login");
    await flush(el);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("https://accounts.google.test/login");
    expect(signal!.aborted).toBe(true);
    got.resolve(passkeyCredential());
    await flush(el);
    expect(api.passkeyAuthVerify).not.toHaveBeenCalled();
    expect(loggedIn).not.toHaveBeenCalled();
  });

  it("does not sign in when an autofilled passkey is confirmed after Google was chosen", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const verified = deferred<{ personId: string }>();
    const api = stubApi({ passkeyAuthVerify: vi.fn().mockReturnValue(verified.promise) });
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api, navigate });
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    await vi.waitFor(() => expect(api.passkeyAuthVerify).toHaveBeenCalled());
    await flush(el);
    click(el, "google-login");
    await flush(el);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("https://accounts.google.test/login");
    verified.resolve({ personId: "p9" });
    await flush(el);
    expect(loggedIn).not.toHaveBeenCalled();
  });

  it("ignores Google while the passkey page's own prompt is pending", async () => {
    const got = deferred<Credential | null>();
    vi.mocked(navigator.credentials.get).mockReturnValueOnce(got.promise);
    const api = stubApi();
    const navigate = vi.fn();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api, navigate });
    const loggedIn = vi.fn();
    el.addEventListener("logged-in", loggedIn);
    await flush(el);
    await openPasskey(el);
    click(el, "passkey-login");
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalledTimes(1));
    await el.updateComplete;
    click(el, "google-login");
    await flush(el);
    expect(api.beginGoogleLogin).not.toHaveBeenCalled();
    got.resolve(passkeyCredential());
    await vi.waitFor(() => expect(loggedIn).toHaveBeenCalledTimes(1));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("offers passkey autofill again, never a passkey prompt, when Google cannot be started", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    vi.mocked(navigator.credentials.get).mockImplementation(never);
    const api = stubApi({
      beginGoogleLogin: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalledTimes(1));
    await flush(el);
    click(el, "google-login");
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalledTimes(2));
    for (const [request] of vi.mocked(navigator.credentials.get).mock.calls)
      expect(request).toEqual(expect.objectContaining({ mediation: "conditional" }));
    expect(await bottomOf(el)).toBe(codeMessage("connection.failed"));
    expect(field(el, "email")).not.toBeNull();
  });

  it("with Remember ticked, carries the consent to Google without an email", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi(),
      navigate: vi.fn(),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=remember-email]")!.click();
    click(el, "google-login");
    await flush(el);
    expect(JSON.parse(sessionStorage.getItem("waitron-google-login-preference")!)).toEqual({
      expiresAt: expect.any(Number),
    });
  });

  it("with Remember unticked, carries no consent and forgets the saved shortcut", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: stubApi(),
      navigate: vi.fn(),
    });
    await flush(el);
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "old@example.com", method: "passkey" }),
    );
    sessionStorage.setItem(
      "waitron-google-login-preference",
      JSON.stringify({ expiresAt: Date.now() + 60_000 }),
    );
    click(el, "google-login");
    await flush(el);
    expect(sessionStorage.getItem("waitron-google-login-preference")).toBeNull();
    expect(localStorage.getItem("waitron-login-preference")).toBeNull();
  });
});

describe("login-screen: a passkey Waitron no longer holds", () => {
  const OPTIONS = { challengeHandle: "h1", options: { challenge: "AQID", rpId: "localhost" } };
  function browserWithUnknownSignal(unknown?: ReturnType<typeof vi.fn>) {
    vi.stubGlobal(
      "PublicKeyCredential",
      unknown === undefined
        ? class {
            static isConditionalMediationAvailable = conditionalMediationAvailable;
          }
        : class {
            static isConditionalMediationAvailable = conditionalMediationAvailable;
            static signalUnknownCredential = unknown;
          },
    );
  }
  const refusing = (code: string) =>
    stubApi({
      passkeyAuthOptions: vi.fn().mockResolvedValue(OPTIONS),
      passkeyAuthVerify: vi.fn().mockRejectedValue({ code }),
    });

  it("asks the browser to forget the passkey it offered and says so", async () => {
    const unknown = vi.fn().mockResolvedValue(undefined);
    browserWithUnknownSignal(unknown);
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: refusing("passkey.not_registered"),
    });
    await openPasskey(el);
    click(el, "passkey-login");
    await vi.waitFor(() => expect(unknown).toHaveBeenCalled());
    await flush(el);
    expect(unknown).toHaveBeenCalledExactlyOnceWith({
      rpId: "localhost",
      credentialId: "cred-abc",
    });
    expect(await bottomOf(el)).toBe(t("login.passkey_forgotten"));
  });

  it("says only that the passkey is no longer registered when the browser cannot be asked", async () => {
    browserWithUnknownSignal();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: refusing("passkey.not_registered"),
    });
    await openPasskey(el);
    click(el, "passkey-login");
    await flush(el);
    await flush(el);
    expect(await bottomOf(el)).toBe(t("login.passkey_unknown"));
  });

  it("says only that the passkey is no longer registered when the browser refuses to be asked", async () => {
    browserWithUnknownSignal(vi.fn().mockRejectedValue(new TypeError("not base64url")));
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: refusing("passkey.not_registered"),
    });
    await openPasskey(el);
    click(el, "passkey-login");
    await flush(el);
    await flush(el);
    expect(await bottomOf(el)).toBe(t("login.passkey_unknown"));
  });

  it("asks the browser to forget a passkey offered in the email field too", async () => {
    conditionalMediationAvailable.mockResolvedValue(true);
    const unknown = vi.fn().mockResolvedValue(undefined);
    browserWithUnknownSignal(unknown);
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
      api: refusing("passkey.not_registered"),
    });
    await vi.waitFor(() => expect(unknown).toHaveBeenCalled());
    await flush(el);
    expect(unknown).toHaveBeenCalledExactlyOnceWith({
      rpId: "localhost",
      credentialId: "cred-abc",
    });
    expect(await bottomOf(el)).toBe(t("login.passkey_forgotten"));
  });

  it.each(["passkey.verification_failed", "passkey.challenge_expired"])(
    "asks the browser nothing on %s",
    async (code) => {
      const unknown = vi.fn().mockResolvedValue(undefined);
      browserWithUnknownSignal(unknown);
      const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", {
        api: refusing(code),
      });
      await openPasskey(el);
      click(el, "passkey-login");
      await flush(el);
      await flush(el);
      expect(await bottomOf(el)).toBe(codeMessage(code));
      expect(unknown).not.toHaveBeenCalled();
    },
  );
});

describe("login-screen: the chosen email is a read-only field", () => {
  function chosenEmail(el: LoginScreen): WtInput {
    return el.shadowRoot!.querySelector<WtInput>("wt-input[data-test=login-context]")!;
  }

  function nativeInput(fieldEl: WtInput): HTMLInputElement {
    return fieldEl.shadowRoot!.querySelector("input")!;
  }

  /** Where a single-line field's text starts: its control's left edge plus the inset before it. */
  function textStart(fieldEl: WtInput): number {
    const control = nativeInput(fieldEl);
    const style = getComputedStyle(control);
    return (
      control.getBoundingClientRect().left +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.paddingLeft)
    );
  }

  it("shows the address as the value of a read-only field labelled Email", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el, "bea@x.com");
    const chosen = chosenEmail(el);
    expect(chosen).not.toBeNull();
    await chosen.updateComplete;
    expect(chosen.readonly).toBe(true);
    expect(chosen.shadowRoot!.querySelector("label")!.textContent!.trim()).toBe(t("login.email"));
    expect(nativeInput(chosen).readOnly).toBe(true);
    expect(nativeInput(chosen).value).toBe("bea@x.com");
  });

  it("starts the address's text where the password field's text starts", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el, "bea@x.com");
    const chosen = chosenEmail(el);
    expect(chosen).not.toBeNull();
    await chosen.updateComplete;
    const password = field(el, "password");
    expect(Math.abs(textStart(chosen) - textStart(password))).toBeLessThanOrEqual(1);
    expect(chosen.getBoundingClientRect().width).toBe(password.getBoundingClientRect().width);
  });

  it("puts Use another account inside the field at its trailing end, and it returns to the email step", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el, "bea@x.com");
    const chosen = chosenEmail(el);
    expect(chosen).not.toBeNull();
    await flush(el);
    await chosen.updateComplete;
    const pencil = el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!;
    expect(pencil.parentElement).toBe(chosen);
    expect(pencil.slot).toBe("end");
    const box = chosen.shadowRoot!.querySelector(".field")!.getBoundingClientRect();
    const pencilBox = pencil.getBoundingClientRect();
    expect(pencilBox.right).toBeLessThanOrEqual(box.right);
    expect(pencilBox.left).toBeGreaterThan(box.left + box.width / 2);
    expect(pencilBox.top).toBeGreaterThanOrEqual(box.top);
    expect(pencilBox.bottom).toBeLessThanOrEqual(box.bottom);
    pencil.click();
    await el.updateComplete;
    expect(field(el, "email")).not.toBeNull();
    expect(chosenEmail(el)).toBeNull();
  });

  it("draws the Use another account icon at the size of the password field's reveal icon", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el, "bea@x.com");
    await flush(el);
    const pencil = el.shadowRoot!.querySelector<SVGElement>("[data-test=change-account] svg")!;
    const reveal = field(el, "password").querySelector<SVGElement>(".password-toggle svg")!;
    expect(pencil).not.toBeNull();
    expect(reveal).not.toBeNull();
    const pencilBox = pencil.getBoundingClientRect();
    const revealBox = reveal.getBoundingClientRect();
    expect(revealBox.width).toBeGreaterThan(0);
    expect(pencilBox.width).toBe(revealBox.width);
    expect(pencilBox.height).toBe(revealBox.height);
  });

  it("keeps one field named email, the hidden username for password managers", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el, "bea@x.com");
    const chosen = chosenEmail(el);
    expect(chosen).not.toBeNull();
    await chosen.updateComplete;
    expect(nativeInput(chosen).name).toBe("chosen-email");
    expect(nativeInput(chosen).autocomplete).toBe("off");
    const named = el.shadowRoot!.querySelectorAll("[name=email]");
    expect(named).toHaveLength(1);
    expect(named[0]!.hasAttribute("data-autofill-username")).toBe(true);
  });

  it.each(["invitation", "password_reset"])(
    "shows the %s page's address in the same read-only field, with no way to change it",
    async (purpose) => {
      history.replaceState(null, "", `/manage/account?token=token-1&purpose=${purpose}`);
      const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
      await flush(el);
      const chosen = chosenEmail(el);
      expect(chosen).not.toBeNull();
      await chosen.updateComplete;
      expect(nativeInput(chosen).readOnly).toBe(true);
      expect(nativeInput(chosen).value).toBe("new@example.test");
      expect(el.shadowRoot!.querySelector("[data-test=change-account]")).toBeNull();
      expect(
        Math.abs(textStart(chosen) - textStart(field(el, "new-password"))),
      ).toBeLessThanOrEqual(1);
    },
  );
});
