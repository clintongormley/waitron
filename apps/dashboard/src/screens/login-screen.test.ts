import { userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
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
    // Retained on the stub so the "does not fetch the roster on connect" test can prove the screen
    // never calls it — the screen itself no longer has a roster picker.
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
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
    // The language chooser reads this only when opened; the screen just passes it through.
    getLocales: vi
      .fn()
      .mockResolvedValue({ locales: [{ code: "en-GB", label: "English" }], venueDefault: "es-ES" }),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Lets a pending `login` promise settle and the element re-render. */
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

function input(el: LoginScreen, name: string, value: string): void {
  el.shadowRoot!.querySelector(`wt-input[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}

async function mountPasskeyOffer(overrides: Partial<DashboardApi> = {}) {
  history.replaceState(null, "", "/manage/account?token=setup&purpose=invitation");
  const api = stubApi(overrides);
  const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
  await flush(el);
  input(el, "new-password", "new password");
  input(el, "new-pin", "4321");
  input(el, "confirm-pin", "4321");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!.click();
  await flush(el);
  return { el, api };
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
    expect(
      el
        .shadowRoot!.querySelector("wt-form-error-summary")
        ?.shadowRoot?.querySelector("[role=alert]"),
    ).toBeNull();
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
    expect(el.shadowRoot!.querySelector("ul li a[data-test=use-password]")).not.toBeNull();
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
    expect(
      el.shadowRoot!.querySelector("wt-form-error-summary")?.shadowRoot?.textContent,
    ).toContain(t("profile.passkey_name_too_long"));
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
    expect(loggedIn).toHaveBeenCalledTimes(1);
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
    input(el, "confirm-pin", "4321");
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
        ?.nextElementSibling?.matches("a[data-test=reset-by-email]"),
    ).toBe(true);
    expect(el.shadowRoot!.querySelector("ul li a[data-test=passkey-login]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("ul li a[data-test=google-login]")).not.toBeNull();
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
    expect(
      el.shadowRoot!.querySelector("wt-form-error-summary")!.shadowRoot!.textContent,
    ).toContain(t("form.factor_required"));
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
    expect(el.shadowRoot!.querySelector("[data-test=login-context]")?.textContent).toContain(
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
    expect(el.shadowRoot!.querySelector("dashboard-language-chooser")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=login-context]")).toBeNull();
    resolveInspection({ email: "pending@example.test", purpose: "invitation" });
    await flush(el);

    expect(api.inspectAccountAction).toHaveBeenCalledWith("token-1", "invitation");
    expect(el.shadowRoot!.querySelector("[data-test=login-context] strong")?.textContent).toBe(
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
    expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=try-another-way]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=submit]")).not.toBeNull();
    expect(api.login).not.toHaveBeenCalled();
  });

  it("identifies the account above the password field", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el, "bea@x.com");

    expect(el.shadowRoot!.querySelector("[data-test=login-context]")?.textContent?.trim()).toBe(
      `${t("login.email")}bea@x.com`,
    );
  });

  it("reveals and hides the password without losing its value", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el);
    const field = el.shadowRoot!.querySelector("wt-input")!;
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
    input = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
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

  it("explains a missing or malformed email under the field and in the form summary", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    const field = el.shadowRoot!.querySelector("wt-input") as HTMLElement & { error: string };
    const go = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      "[data-test=continue]",
    )!;
    expect(go.disabled).toBe(false);
    go.click();
    await el.updateComplete;
    expect(field.error).toBe(t("form.email_required"));
    expect(
      el
        .shadowRoot!.querySelector("wt-form-error-summary")!
        .shadowRoot!.querySelector("[data-heading]")?.textContent,
    ).toBe(t("form.error_heading"));

    field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "not-an-email" } }));
    go.click();
    await el.updateComplete;
    expect(field.error).toBe(codeMessage("person.email_invalid"));
    expect(el.shadowRoot!.querySelector("[data-test=submit]")).toBeNull();
  });

  it("keeps primary actions at the right and alternatives as visible links", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    expect(
      el
        .shadowRoot!.querySelector("wt-form-actions wt-button:not([slot])")
        ?.getAttribute("data-test"),
    ).toBe("continue");
    await continueWithEmail(el);
    expect(
      el
        .shadowRoot!.querySelector("wt-form-actions wt-button:not([slot])")
        ?.getAttribute("data-test"),
    ).toBe("submit");
    expect(el.shadowRoot!.querySelector('wt-form-actions [slot="cancel"]')).toBeNull();
    await openPasskey(el);
    expect(
      el
        .shadowRoot!.querySelector("wt-form-actions wt-button:not([slot])")
        ?.getAttribute("data-test"),
    ).toBe("passkey-login");
    expect(el.shadowRoot!.querySelector("ul li a[data-test=use-password]")).not.toBeNull();
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
    const fields = [...el.shadowRoot!.querySelectorAll("wt-input")];
    const inputs = fields.map((field) => {
      const input = field.shadowRoot!.querySelector("input")!;
      return { name: input.name, autocomplete: input.autocomplete, required: input.required };
    });
    expect(inputs).toEqual([
      { name: "new-password", autocomplete: "new-password", required: true },
      { name: "new-pin", autocomplete: "off", required: true },
      { name: "confirm-pin", autocomplete: "off", required: true },
    ]);

    const labels = [
      ["account.show_new_password", "account.hide_new_password"],
      ["account.show_new_pin", "account.hide_new_pin"],
      ["account.show_confirm_pin", "account.hide_confirm_pin"],
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
    const fields = [...el.shadowRoot!.querySelectorAll("wt-input")];
    expect(fields).toHaveLength(3);
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
      confirmPin: "1234",
    });
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
    await el.updateComplete;

    expect([...el.shadowRoot!.querySelectorAll("wt-input")].map((field) => field.value)).toEqual([
      "",
    ]);
  });

  it("distinguishes a missing PIN confirmation in the fields and summary", async () => {
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
    expect(
      el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("wt-input[name=confirm-pin]")!
        .error,
    ).toBe(t("form.confirm_pin_required"));
    const summary = el
      .shadowRoot!.querySelector("wt-form-error-summary")!
      .shadowRoot!.querySelector<HTMLElement>("[role=alert]")!.textContent;
    expect(summary).toContain(t("form.pin_required"));
    expect(summary).toContain(t("form.confirm_pin_required"));
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
    // The banner renders LOCALISED copy, never the raw wire code (the state above stays the raw code).
    const banner = el
      .shadowRoot!.querySelector("wt-form-error-summary")!
      .shadowRoot!.querySelector("[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("password.invalid", "es-ES"));
    expect(banner).not.toContain("password.invalid");
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
    const password = el.shadowRoot!.querySelector("wt-input")!;
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
      el.shadowRoot!.querySelector("wt-input")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: password } }),
      );
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
      await flush(el);
      const errors = () =>
        el
          .shadowRoot!.querySelector("wt-form-error-summary")!
          .shadowRoot!.querySelector('[role="alert"]');
      expect(errors()).not.toBeNull();

      el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-account]")!.click();
      await el.updateComplete;
      expect(errors()).toBeNull();
      expect(el.shadowRoot!.querySelector("wt-input")!.name).toBe("email");
      expect(el.shadowRoot!.querySelector("wt-input")!.value).toBe("");
      await openPassword(el);
      expect(errors()).toBeNull();
      expect(el.shadowRoot!.querySelector("wt-input")!.error).toBe("");
      expect(el.shadowRoot!.querySelector("wt-input")!.value).toBe("");
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

  it("offers password and reset email as alternatives to the preferred passkey", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await openPasskey(el, "bea@x.com");

    expect(el.shadowRoot!.querySelector("[data-test=forgot-password]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=use-password]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reset-by-email]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=change-account]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=login-context]")?.textContent).toContain(
      "bea@x.com",
    );

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
    await openPasskey(el, "bea@x.com");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reset-by-email]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=use-password]")).toBeNull();
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
    await openPasskey(el, "bea@x.com");
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
        .shadowRoot!.querySelector("wt-input")!
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
    (el as unknown as { confirmPin: string }).confirmPin = "4321";
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

  // Per-user-language-preference: the login screen renders the transient language chooser, and the
  // chooser's composed `locale-selected` must ESCAPE the login screen's shadow boundary so the app shell
  // (dashboard-app) hears it and switches the locale. The screen itself neither persists nor switches.
  it("renders the language chooser and lets its locale-selected event bubble out", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await flush(el);
    const chooser = el.shadowRoot!.querySelector("dashboard-language-chooser");
    expect(chooser).toBeTruthy();

    const heard = new Promise<{ code: string }>((resolve) =>
      el.addEventListener("locale-selected", (e) => resolve((e as CustomEvent).detail)),
    );
    chooser!.dispatchEvent(
      new CustomEvent("locale-selected", {
        detail: { code: "en-GB" },
        bubbles: true,
        composed: true,
      }),
    );
    expect((await heard).code).toBe("en-GB");
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

  // A rejected ceremony step becomes the error banner, never an unhandled rejection (pristine
  // output pins that). Covers the `.code` arm of the catch with a distinct, non-fallback code.
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

  // Covers the `?? "passkey.verification_failed"` fallback arm: a rejection carrying no code.
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
});

it("Enter submits current shadow input values once while login is pending", async () => {
  let resolve!: (value: { personId: string }) => void;
  const login = vi.fn(
    () =>
      new Promise<{ personId: string }>((done) => {
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
  input = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
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
  resolve({ personId: "p1" });
  await flush(el);
});
