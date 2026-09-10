import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import type { ProfileScreen } from "./profile-screen.js";
import "./profile-screen.js";

// Stub the hardware boundary so the real library can be imported in any order.
beforeEach(() => {
  vi.spyOn(navigator.credentials, "create").mockResolvedValue({
    id: "new-credential",
    rawId: new Uint8Array([1]).buffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: new Uint8Array([2]).buffer,
      attestationObject: new Uint8Array([3]).buffer,
      getTransports: () => ["internal"],
    },
    getClientExtensionResults: () => ({}),
    toJSON: vi.fn(),
  } as PublicKeyCredential);
});
afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const registrationOptions = {
  challenge: "AQID",
  rp: { name: "Waitron", id: "localhost" },
  user: { id: "BAUG", name: "alex@example.com", displayName: "Alex" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};
function apiStub(overrides: Record<string, unknown> = {}) {
  return {
    getProfile: vi.fn().mockResolvedValue({
      displayName: "Alex",
      firstNames: "Alex",
      lastNames: "Rivera",
      telephone: "+34 600 000 000",
      email: "alex@example.com",
      pendingEmail: null,
      locale: "en-GB",
      hasPassword: true,
      hasTotp: false,
      hasGoogle: false,
      passkeys: [{ id: "credential", createdAt: "2026-09-09T12:00:00Z" }],
    }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "en-GB", label: "English" },
        { code: "es-ES", label: "Español" },
      ],
      venueDefault: "en-GB",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({
      configured: true,
      privacyNoticeUrl: "https://restaurant.example/privacy",
    }),
    beginGoogleLink: vi.fn().mockResolvedValue({
      authorizationUrl: "https://accounts.google.test/link",
    }),
    saveProfile: vi.fn().mockResolvedValue({ emailVerificationSent: false }),
    confirmProfileEmail: vi.fn().mockResolvedValue({ email: "new@example.com" }),
    changePassword: vi.fn().mockResolvedValue(undefined),
    changePin: vi.fn().mockResolvedValue(undefined),
    beginTotp: vi.fn().mockResolvedValue({
      enrollmentId: "11111111-1111-4111-8111-111111111111",
      secret: "SECRET",
      uri: "otpauth://totp/Waitron:test",
      expiresAt: "2026-09-09T12:10:00Z",
    }),
    finishTotp: vi
      .fn()
      .mockResolvedValue({ codes: Array.from({ length: 10 }, (_, i) => `CODE-${i}`) }),
    regenerateRecoveryCodes: vi.fn().mockResolvedValue({ codes: ["NEW-CODE"] }),
    removePasskey: vi.fn().mockResolvedValue(undefined),
    passkeyRegisterOptions: vi
      .fn()
      .mockResolvedValue({ challengeHandle: "handle", options: registrationOptions }),
    passkeyRegisterVerify: vi.fn().mockResolvedValue({ credentialId: "new-credential" }),
    disableTotp: vi.fn().mockResolvedValue(undefined),
    unlinkGoogle: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
async function flush(el: ProfileScreen) {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
async function mount(overrides: Record<string, unknown> = {}) {
  const api = apiStub(overrides);
  const { el, host } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
    api: api as unknown as DashboardApi,
    navigate: vi.fn(),
  });
  await flush(el);
  return { el, host, api };
}
async function click(el: ProfileScreen, action: string) {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
  await flush(el);
}
function input(el: ProfileScreen, name: string, value: string) {
  el.shadowRoot!.querySelector(`wt-input[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}

describe("your profile", () => {
  it("renders your details and passkeys accessibly", async () => {
    const { el, host } = await mount();
    expect(el.shadowRoot!.textContent).toContain("alex@example.com");
    expect(el.shadowRoot!.querySelector('[data-test="add-passkey"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="close-profile"]')).toBeNull();
    expect(
      el.shadowRoot!.querySelector<HTMLAnchorElement>('[data-test="privacy-notice"]')!.href,
    ).toBe("https://restaurant.example/privacy");
    await expectNoA11yViolations(host);
  });
  it("starts Google linking when the installation is configured", async () => {
    const { el, api } = await mount();
    await click(el, "setup-google");
    input(el, "currentPassword", "correct horse");
    await click(el, "save");
    expect(api.beginGoogleLink).toHaveBeenCalledWith({ currentPassword: "correct horse" });
    expect(el.navigate as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      "https://accounts.google.test/link",
    );
  });
  it("validates details and lets you cancel edits without saving", async () => {
    const { el, api } = await mount();
    await click(el, "edit-details");
    input(el, "displayName", "");
    input(el, "email", "bad");
    await click(el, "save");
    expect(api.saveProfile).not.toHaveBeenCalled();
    expect(
      el.shadowRoot!.querySelector("wt-input[name=displayName]")!.getAttribute("error"),
    ).toBeTruthy();
    expect(
      el.shadowRoot!.querySelector("wt-input[name=email]")!.getAttribute("error"),
    ).toBeTruthy();
    await click(el, "cancel");
    expect(el.shadowRoot!.textContent).toContain("alex@example.com");
    await click(el, "edit-details");
    input(el, "displayName", "Alex Updated");
    const language = el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=locale]")!;
    language.value = "es-ES";
    language.dispatchEvent(new Event("change", { bubbles: true }));
    await click(el, "save");
    expect(api.saveProfile).toHaveBeenCalledWith({
      displayName: "Alex Updated",
      firstNames: "Alex",
      lastNames: "Rivera",
      telephone: "+34 600 000 000",
      email: "alex@example.com",
      locale: "es-ES",
    });
  });
  it("requires current credentials for an email change and gives each password field a reveal control", async () => {
    const { el, api, host } = await mount();
    await click(el, "edit-details");
    input(el, "email", "new@example.com");
    await flush(el);
    await click(el, "save");
    expect(api.saveProfile).not.toHaveBeenCalled();
    input(el, "currentPassword", "current");
    const field = el.shadowRoot!.querySelector("wt-input[name=currentPassword]")!;
    expect(field.shadowRoot!.querySelector("input")!.autocomplete).toBe("current-password");
    field.querySelector<HTMLElement>("[slot=end]")!.click();
    await flush(el);
    expect(field.shadowRoot!.querySelector("input")!.type).toBe("text");
    await expectNoA11yViolations(host);
    await click(el, "save");
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com", currentPassword: "current" }),
    );
  });
  it("shows a pending replacement address and confirms its emailed code", async () => {
    const { el, api } = await mount({
      getProfile: vi.fn().mockResolvedValue({
        displayName: "Alex",
        firstNames: "Alex",
        lastNames: "Rivera",
        telephone: null,
        email: "alex@example.com",
        pendingEmail: "new@example.com",
        locale: "en-GB",
        hasPassword: true,
        hasTotp: false,
        hasGoogle: false,
        passkeys: [],
      }),
    });
    expect(el.shadowRoot!.textContent).toContain("new@example.com");
    await click(el, "confirm-email");
    input(el, "setupCode", "123456");
    await click(el, "save");
    expect(api.confirmProfileEmail).toHaveBeenCalledWith("123456");
  });
  it("validates matching new passwords and reports a rejected current password beside its input", async () => {
    const { el, api } = await mount();
    await click(el, "change-password");
    input(el, "currentPassword", "current");
    input(el, "password", "replacement password");
    input(el, "confirmPassword", "different");
    await click(el, "save");
    expect(api.changePassword).not.toHaveBeenCalled();
    input(el, "confirmPassword", "replacement password");
    api.changePassword.mockRejectedValueOnce({ code: "password.invalid" });
    await click(el, "save");
    expect(
      el.shadowRoot!.querySelector("wt-input[name=currentPassword]")!.getAttribute("error"),
    ).toBeTruthy();
    await click(el, "save");
    expect(api.changePassword).toHaveBeenCalledWith({
      currentPassword: "current",
      password: "replacement password",
    });
  });
  it("changes the PIN after confirming the current login", async () => {
    const { el, api } = await mount();
    await click(el, "change-pin");
    input(el, "currentPassword", "current");
    input(el, "pin", "4321");
    input(el, "confirmPin", "4321");
    await click(el, "save");
    expect(api.changePin).toHaveBeenCalledWith({ currentPassword: "current", pin: "4321" });
  });
  it("adds a passkey for this session and confirms removal with current credentials", async () => {
    const warn = vi.spyOn(console, "warn");
    const { el, api } = await mount();
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(api.passkeyRegisterOptions).toHaveBeenCalledWith({ currentPassword: "current" });
    // Preserve the optionsJSON contract: the deprecated call shape emits a warning.
    expect(warn).not.toHaveBeenCalled();
    expect(navigator.credentials.create).toHaveBeenCalledExactlyOnceWith({
      publicKey: {
        ...registrationOptions,
        challenge: new Uint8Array([1, 2, 3]).buffer,
        user: { ...registrationOptions.user, id: new Uint8Array([4, 5, 6]).buffer },
        excludeCredentials: undefined,
      },
      signal: expect.any(AbortSignal),
    });
    expect(api.passkeyRegisterVerify).toHaveBeenCalledWith({
      challengeHandle: "handle",
      response: {
        id: "new-credential",
        rawId: "AQ",
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: "Ag",
          attestationObject: "Aw",
          transports: ["internal"],
          publicKeyAlgorithm: undefined,
          publicKey: undefined,
          authenticatorData: undefined,
        },
      },
    });
    await click(el, "remove-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(api.removePasskey).toHaveBeenCalledWith("credential", { currentPassword: "current" });
  });
  it("sets up an authenticator and shows recovery codes once", async () => {
    const { el, api } = await mount();
    await click(el, "setup-authenticator");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(api.beginTotp).toHaveBeenCalledWith({ currentPassword: "current" });
    expect(el.shadowRoot!.textContent).toContain("SECRET");
    input(el, "setupCode", "123456");
    await click(el, "save");
    expect(api.finishTotp).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "123456");
    expect(el.shadowRoot!.querySelector("[data-test=recovery-code-list]")?.textContent).toContain(
      "CODE-0",
    );
  });

  it("disables an authenticator and unlinks Google only after current credentials", async () => {
    const api = apiStub({
      getProfile: vi.fn().mockResolvedValue({
        displayName: "Alex",
        firstNames: "Alex",
        lastNames: "Rivera",
        telephone: null,
        email: "alex@example.com",
        locale: "en-GB",
        hasPassword: true,
        hasTotp: true,
        hasGoogle: true,
        passkeys: [],
      }),
    });
    const { el } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
      api: api as unknown as DashboardApi,
      navigate: vi.fn(),
    });
    await flush(el);
    await click(el, "disable-authenticator");
    input(el, "currentPassword", "current");
    input(el, "totp", "123456");
    await click(el, "save");
    expect(api.disableTotp).toHaveBeenCalledWith({ currentPassword: "current", totp: "123456" });

    await click(el, "unlink-google");
    input(el, "currentPassword", "current");
    input(el, "totp", "123456");
    await click(el, "save");
    expect(api.unlinkGoogle).toHaveBeenCalledWith({ currentPassword: "current", totp: "123456" });
  });
});
