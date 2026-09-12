import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
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
      passkeys: [{ id: "credential", name: null, createdAt: "2026-09-09T12:00:00Z" }],
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
// The Edit action for "Your details" lives in dashboard-app.ts's modal footer, not in this screen
// (see editDetails() on ProfileScreen) — standalone here, tests call the same public entry point
// that button uses.
async function editDetails(el: ProfileScreen) {
  el.editDetails();
  await flush(el);
}
function input(el: ProfileScreen, name: string, value: string) {
  el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
    `wt-input[name=${name}]`,
  )!.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}

describe("your profile", () => {
  it("opens incomplete details with missing required fields marked, then saves them", async () => {
    const profile = await apiStub().getProfile();
    const { el, api } = await mount({
      getProfile: vi.fn().mockResolvedValue({ ...profile, firstNames: null, lastNames: " " }),
    });
    // The details card stays visible behind the modal — see "opens Edit in a modal over the
    // details card, not in place of it" below — so what actually proves the edit form opened
    // automatically is the modal itself being open with the incomplete fields shown.
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
    for (const [name, key] of [
      ["firstNames", "form.first_names_required"],
      ["lastNames", "form.last_names_required"],
    ] as const) {
      const field = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
        `wt-input[name=${name}]`,
      )!;
      expect(field.error).toBe(t(key));
      expect(field.required).toBe(true);
    }
    expect(
      el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("wt-input[name=displayName]")!
        .error,
    ).toBe("");
    input(el, "firstNames", "Alex");
    input(el, "lastNames", "Rivera");
    await click(el, "save");
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ firstNames: "Alex", lastNames: "Rivera" }),
    );
    // Back to view — the details card (its Edit action lives in dashboard-app.ts's modal footer
    // now, see editDetails()) rather than left stuck open after a successful save.
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
  });

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
  it("opens Edit in a modal over the details card, not in place of it", async () => {
    const { el } = await mount();
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    expect(modal.open).toBe(false);
    await editDetails(el);
    expect(modal.open).toBe(true);
    // The card is still there behind the modal — this is the whole point of the modal pattern:
    // editing overlays the page rather than replacing it.
    expect(el.shadowRoot!.textContent).toContain("alex@example.com");
    expect(el.shadowRoot!.querySelector("wt-tabs")).not.toBeNull();
    await click(el, "cancel");
    expect(modal.open).toBe(false);
  });
  it("a stale close from the previous modal never reopens or reverts a newer one", async () => {
    // The native <dialog> underlying wt-modal fires its "close" event asynchronously relative to
    // the property change that triggers it. If that event from an EARLIER close (Cancel, or a
    // successful Save) arrives after a NEWER edit has already opened, it must not stomp the newer
    // one back to view. Reproduced only under real timing load — this simulates the race
    // deterministically by dispatching the delayed event by hand, rather than depending on luck.
    const { el } = await mount();
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await editDetails(el);
    // Cancel, then immediately open a different edit — both BEFORE Lit has rendered either
    // transition, so the real "close" event this Cancel will eventually cause has not fired yet
    // (its flag is still armed) by the time "remove" is already the current mode.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-passkey]")!.click();
    await flush(el);
    expect(modal.open).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-input[name=currentPassword]")).not.toBeNull();
    // The delayed "close" this Cancel caused, arriving only now — it must not undo "remove".
    modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await flush(el);
    expect(modal.open).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-input[name=currentPassword]")).not.toBeNull();
  });
  it("hides the change-password action for an account with no password", async () => {
    const { el, host } = await mount({
      getProfile: vi.fn().mockResolvedValue({
        displayName: "Alex",
        firstNames: "Alex",
        lastNames: "Rivera",
        telephone: null,
        email: "alex@example.com",
        pendingEmail: null,
        locale: "en-GB",
        hasPassword: false,
        hasTotp: false,
        hasGoogle: false,
        passkeys: [],
      }),
    });
    expect(el.shadowRoot!.querySelector('[data-test="change-password"]')).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("profile.password_recovery"));
    expect(el.shadowRoot!.textContent).toContain(t("login.password"));
    await expectNoA11yViolations(host);
  });
  it("shows a passkey's name and keeps a numbered fallback for unnamed keys", async () => {
    const { el, api } = await mount();
    expect(el.shadowRoot!.textContent).toContain("Passkey 1");
    const profile = await api.getProfile();
    Object.assign(el, {
      profile: { ...profile, passkeys: [{ ...profile.passkeys[0], name: "Work laptop" }] },
    });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain("Work laptop");
    expect(
      el.shadowRoot!.querySelector("[data-test=remove-passkey]")!.getAttribute("aria-label"),
    ).toBe(t("profile.remove_passkey_name").replace("{name}", "Work laptop"));
  });
  it("explains an overlong passkey name before starting registration", async () => {
    const { el, api } = await mount();
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    input(el, "passkeyName", "x".repeat(81));
    await click(el, "save");
    expect(api.passkeyRegisterOptions).not.toHaveBeenCalled();
    expect(
      el.shadowRoot!.querySelector("wt-input[name=passkeyName]")!.getAttribute("error"),
    ).toContain("80");
    expect(el.shadowRoot!.querySelector("wt-form-error-summary")!.errors).toEqual([
      t("profile.passkey_name_too_long"),
    ]);
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
    await editDetails(el);
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
    await editDetails(el);
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
    await editDetails(el);
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
    input(el, "passkeyName", "  Work laptop  ");
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
      name: "Work laptop",
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
    const qr = el.shadowRoot!.querySelector<HTMLImageElement>("[data-test=authenticator-qr]")!;
    expect(qr.src).toMatch(/^data:image\/png;base64,/);
    expect(qr.alt).toBe(t("profile.authenticator_qr_alt"));
    const fallback = el.shadowRoot!.querySelector<HTMLDetailsElement>(
      "[data-test=authenticator-key-fallback]",
    )!;
    expect(fallback.open).toBe(false);
    expect(fallback.textContent).toContain("SECRET");
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

it("refreshes displayed profile data after an external change", async () => {
  const liveData = new LiveData();
  const api = Object.assign(apiStub(), { liveData });
  const { el } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect((el as unknown as { profile: unknown }).profile).not.toBeNull());
  const value = await api.getProfile();
  api.getProfile.mockResolvedValue({ ...value, displayName: "Elsewhere" });
  liveData.invalidate([{ type: "persons", id: "person" }]);
  await vi.waitFor(() =>
    expect((el as unknown as { profile: { displayName: string } }).profile.displayName).toBe(
      "Elsewhere",
    ),
  );
});
