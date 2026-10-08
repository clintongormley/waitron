import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
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
let signalAll: MockInstance<typeof PublicKeyCredential.signalAllAcceptedCredentials>;
let signalDetails: MockInstance<typeof PublicKeyCredential.signalCurrentUserDetails>;
// The browser's own methods, replaced so no real password manager is told anything.
beforeEach(() => {
  signalAll = vi
    .spyOn(PublicKeyCredential, "signalAllAcceptedCredentials")
    .mockResolvedValue(undefined);
  signalDetails = vi
    .spyOn(PublicKeyCredential, "signalCurrentUserDetails")
    .mockResolvedValue(undefined);
});
afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());

const registrationOptions = {
  challenge: "AQID",
  rp: { name: "Waitron", id: "localhost" },
  user: { id: "BAUG", name: "alex@example.com", displayName: "Alex" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};
const PASSKEY_SIGNALS = {
  rpId: "localhost",
  userId: "BAUG",
  credentialIds: ["credential", "new-credential"],
  name: "alex@example.com",
  displayName: "Alex",
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
      passkeys: [
        {
          id: "credential",
          name: null,
          createdAt: "2026-09-09T12:00:00Z",
          lastUsedAt: null,
          provider: null,
        },
      ],
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
    passkeySignals: vi.fn().mockResolvedValue(PASSKEY_SIGNALS),
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
// The Edit button lives in dashboard-app.ts, so the tests call the entry point it uses.
async function editDetails(el: ProfileScreen) {
  el.editDetails();
  await flush(el);
}
/** The modal's one message about a failed submission; "" when there is none. */
async function bottomOf(el: ProfileScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
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
    // The details card stays visible behind the modal, so the open modal is what shows the edit form
    // opened.
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

  it("shows Add passkey beside the Security tab and not inside its panel", async () => {
    const { el } = await mount();
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    expect(el.shadowRoot!.querySelector('[data-test="add-passkey"]')!.checkVisibility()).toBe(
      false,
    );
    tabs.shadowRoot!.querySelector<HTMLElement>('[role="tab"][data-key="security"]')!.click();
    await flush(el);
    expect(tabs.querySelector('[slot="actions"] [data-test="add-passkey"]')).not.toBeNull();
    expect(tabs.querySelector('[slot="security"] [data-test="add-passkey"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="add-passkey"]')!.checkVisibility()).toBe(true);
  });

  it("shows why the initial load failed, not just a bare Reload button", async () => {
    const { el } = await mount({
      getProfile: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    expect(el.shadowRoot!.querySelector("wt-button")).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain(codeMessage("server.internal"));
  });
  it("opens Edit in a modal over the details card, not in place of it", async () => {
    const { el } = await mount();
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    expect(modal.open).toBe(false);
    await editDetails(el);
    expect(modal.open).toBe(true);
    expect(el.shadowRoot!.textContent).toContain("alex@example.com");
    expect(el.shadowRoot!.querySelector("wt-tabs")).not.toBeNull();
    await click(el, "cancel");
    expect(modal.open).toBe(false);
  });
  it("a stale close from the previous modal never reopens or reverts a newer one", async () => {
    // The late "close" is dispatched by hand, so the race does not depend on timing.
    const { el } = await mount();
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await editDetails(el);
    // Both clicks land before Lit renders either transition, so Cancel's own "close" has not fired.
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
  it("writes a passkey's date in the dashboard's language, not the browser's", async () => {
    const createdAt = "2026-09-29T12:00:00Z";
    expect(new Date(createdAt).toLocaleDateString()).not.toBe(
      new Date(createdAt).toLocaleDateString("es-ES"),
    );
    const before = currentLocale();
    setLocale("es-ES");
    try {
      const profile = await apiStub().getProfile();
      const { el } = await mount({
        getProfile: vi.fn().mockResolvedValue({
          ...profile,
          passkeys: [{ ...profile.passkeys[0], createdAt }],
        }),
      });
      expect(el.shadowRoot!.querySelector(".passkey-text")!.textContent).toContain(
        new Date(createdAt).toLocaleDateString("es-ES"),
      );
    } finally {
      setLocale(before);
    }
  });
  describe("each passkey's provider and last use", () => {
    const used = {
      id: "used",
      name: "Phone",
      createdAt: "2026-09-09T12:00:00Z",
      lastUsedAt: "2026-09-28T08:30:00Z",
      provider: "Google Password Manager",
    };
    const neverUsed = {
      id: "never",
      name: "Spare key",
      createdAt: "2026-09-10T12:00:00Z",
      lastUsedAt: null,
      provider: null,
    };
    async function rows(passkeys: unknown[]): Promise<string[]> {
      const profile = await apiStub().getProfile();
      const { el } = await mount({
        getProfile: vi.fn().mockResolvedValue({ ...profile, passkeys }),
      });
      return [...el.shadowRoot!.querySelectorAll(".passkey-item")].map((row) => row.textContent!);
    }

    it.each([
      ["en-GB", "Last used 28/09/2026, 08:30"],
      ["es-ES", "Último uso: 28/9/2026, 08:30"],
    ])("says when a passkey last signed in, or that it never has (%s)", async (locale, text) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const [first, second] = await rows([used, neverUsed]);
        expect(first).toContain(text);
        expect(first).not.toContain(t("profile.passkey_never_used"));
        expect(second).toContain(t("profile.passkey_never_used"));
      } finally {
        setLocale(before);
      }
    });

    it.each([
      ["en-GB", "Last used 30/09/2026, 09:05", "Last used 30/09/2026, 17:40"],
      ["es-ES", "Último uso: 30/9/2026, 09:05", "Último uso: 30/9/2026, 17:40"],
    ])(
      "tells apart two passkeys from one password manager used on the same day (%s)",
      async (locale, morning, evening) => {
        const before = currentLocale();
        setLocale(locale);
        try {
          const sameDay = {
            createdAt: "2026-09-30T08:00:00Z",
            provider: "Google Password Manager",
          };
          const [first, second] = await rows([
            { ...sameDay, id: "replaced", name: null, lastUsedAt: "2026-09-30T09:05:00Z" },
            { ...sameDay, id: "current", name: null, lastUsedAt: "2026-09-30T17:40:00Z" },
          ]);
          expect(first).toContain(`Google Password Manager · ${morning}`);
          expect(second).toContain(`Google Password Manager · ${evening}`);
          expect(first).not.toContain(evening);
          expect(second).not.toContain(morning);
        } finally {
          setLocale(before);
        }
      },
    );

    it.each([
      ["en-GB", "Last used 30/09/2026, 17:40"],
      ["es-ES", "Último uso: 30/9/2026, 17:40"],
    ])("keeps the last-use phrase on one line at phone width (%s)", async (locale, phrase) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const profile = await apiStub().getProfile();
        const { el, host } = await mount({
          getProfile: vi.fn().mockResolvedValue({
            ...profile,
            passkeys: [{ ...used, lastUsedAt: "2026-09-30T17:40:00Z" }],
          }),
        });
        host.style.width = "390px";
        const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
        tabs.shadowRoot!.querySelector<HTMLElement>("[role=tab][data-key=security]")!.click();
        await flush(el);
        const meta = el.shadowRoot!.querySelector(".passkey-item .field-meta")!;
        const range = document.createRange();
        const walker = document.createTreeWalker(meta, NodeFilter.SHOW_TEXT);
        let found = false;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent!.indexOf(phrase);
          if (at === -1) continue;
          range.setStart(node, at);
          range.setEnd(node, at + phrase.length);
          found = true;
        }
        expect(found).toBe(true);
        expect(new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size).toBe(
          1,
        );
        expect(meta.getBoundingClientRect().height).toBeGreaterThan(
          range.getBoundingClientRect().height,
        );
      } finally {
        setLocale(before);
      }
    });

    it("names the password manager that holds a passkey, and none it does not know", async () => {
      const [first, second] = await rows([used, neverUsed]);
      expect(first).toContain("Google Password Manager");
      expect(second).not.toContain("Google Password Manager");
    });

    it("names the password manager once when the passkey is already named after it", async () => {
      const [row] = await rows([{ ...used, name: "Google Password Manager" }]);
      expect(row!.split("Google Password Manager")).toHaveLength(2);
    });
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
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
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
    await chooseOption(el.shadowRoot!.querySelector("wt-combobox[name=locale]")!, "es-ES");
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
  it("picks the interface language from a required dropdown showing the saved one", async () => {
    const { el, api } = await mount();
    await editDetails(el);
    const language = el.shadowRoot!.querySelector("wt-combobox[name=locale]") as HTMLElement & {
      options: { value: string; label: string }[];
      value: string;
      label: string;
      required: boolean;
    };
    expect(language.label).toBe(t("profile.language"));
    expect(language.required).toBe(true);
    expect(language.options.map((o) => o.value)).toEqual(["en-GB", "es-ES"]);
    expect(language.value).toBe("en-GB");
    await chooseOption(language, "es-ES");
    await click(el, "save");
    expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ locale: "es-ES" }));
  });
  it("holds the language field to the same width as the inputs above it in the edit modal on a wide window", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(1280, 800);
    try {
      const { el } = await mount();
      await editDetails(el);
      const probe = document.createElement("div");
      probe.style.width = "var(--wt-form-max-width)";
      el.shadowRoot!.appendChild(probe);
      const form = probe.getBoundingClientRect().width;
      const body = el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector(".body")!;
      expect(body.clientWidth).toBeGreaterThan(form);
      for (const selector of ["wt-input[name=firstNames]", "wt-combobox[name=locale]"]) {
        const width = el.shadowRoot!.querySelector(selector)!.getBoundingClientRect().width;
        expect(width, selector).toBeCloseTo(form, 0);
      }
    } finally {
      await page.viewport(width, height);
    }
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
    // The library warns if optionsJSON is omitted and its deprecated call shape is used.
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
  it("tells the browser's password manager which passkeys are accepted after adding one and after removing one", async () => {
    const { el, api } = await mount();
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    await flush(el);
    expect(api.passkeySignals).toHaveBeenCalledOnce();
    expect(signalAll).toHaveBeenCalledExactlyOnceWith({
      rpId: "localhost",
      userId: "BAUG",
      allAcceptedCredentialIds: ["credential", "new-credential"],
    });
    expect(signalDetails).toHaveBeenCalledExactlyOnceWith({
      rpId: "localhost",
      userId: "BAUG",
      name: "alex@example.com",
      displayName: "Alex",
    });
    await click(el, "remove-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    await flush(el);
    expect(api.passkeySignals).toHaveBeenCalledTimes(2);
    expect(signalAll).toHaveBeenCalledTimes(2);
  });
  it("tells the password manager nothing when adding a passkey fails or another setting changes", async () => {
    const { el, api } = await mount({
      passkeyRegisterVerify: vi.fn().mockRejectedValue({ code: "passkey.challenge_expired" }),
    });
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    await click(el, "cancel");
    await click(el, "change-pin");
    input(el, "currentPassword", "current");
    input(el, "pin", "4321");
    input(el, "confirmPin", "4321");
    await click(el, "save");
    await flush(el);
    expect(api.changePin).toHaveBeenCalledOnce();
    expect(api.passkeySignals).not.toHaveBeenCalled();
    expect(signalAll).not.toHaveBeenCalled();
    expect(signalDetails).not.toHaveBeenCalled();
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

  it("labels the field 'Display name' and requires it under its own message", async () => {
    const { el } = await mount();
    const label = el.shadowRoot!.querySelector(".field-label")!;
    expect(label.textContent).toBe(t("person.display_name"));
    await editDetails(el);
    const displayName = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
      "wt-input[name=displayName]",
    )!;
    expect(displayName.label).toBe(t("person.display_name"));
    input(el, "displayName", "");
    await click(el, "save");
    expect(displayName.error).toBe(t("form.display_name_required"));
  });

  it("regenerates the display name from first and last names until it is customised", async () => {
    const { el } = await mount({
      getProfile: vi.fn().mockResolvedValue({
        displayName: "Ada Lovelace",
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
      }),
    });
    await editDetails(el);
    const displayName = () =>
      el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("wt-input[name=displayName]")!
        .value;
    // A first-name change while the display name still equals the generated one regenerates it.
    input(el, "firstNames", "Grace");
    await flush(el);
    expect(displayName()).toBe("Grace Lovelace");
    // Customising the display name pins it: a later last-name change leaves it alone.
    input(el, "displayName", "Nick");
    await flush(el);
    input(el, "lastNames", "Hopper");
    await flush(el);
    expect(displayName()).toBe("Nick");
    // Clearing it makes the next name change regenerate again.
    input(el, "displayName", "");
    await flush(el);
    input(el, "lastNames", "Byron");
    await flush(el);
    expect(displayName()).toBe("Grace Byron");
  });

  it("blocks a malformed telephone client-side and marks the field without calling the API", async () => {
    const { el, api } = await mount();
    await editDetails(el);
    input(el, "telephone", "12345"); // only five digits — too short to be valid
    await click(el, "save");
    expect(api.saveProfile).not.toHaveBeenCalled();
    expect(
      el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>("wt-input[name=telephone]")!
        .error,
    ).toBe(codeMessage("person.telephone_invalid"));
  });

  it("shows the already-registered message when the device holds a passkey, without verifying", async () => {
    const { el, api } = await mount();
    vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
      new DOMException("already registered", "InvalidStateError"),
    );
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(api.passkeyRegisterVerify).not.toHaveBeenCalled();
    expect(await bottomOf(el)).toBe(codeMessage("passkey.already_registered"));
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  });

  it("puts the already-registered message at the end of the Add passkey dialog's body, below its last field, not in the footer", async () => {
    const { el } = await mount();
    vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
      new DOMException("already registered", "InvalidStateError"),
    );
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const footer = modal.shadowRoot!.querySelector<HTMLElement>(".footer")!;
    const message = body.querySelector<HTMLElement>(":scope > [data-error]");
    expect(message?.textContent).toBe(codeMessage("passkey.already_registered"));
    expect(message!.getAttribute("role")).toBe("alert");
    expect(body.lastElementChild).toBe(message);
    const fields = [...modal.querySelectorAll("wt-input")];
    const lastField = fields.at(-1)!.getBoundingClientRect();
    const box = message!.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(lastField.bottom);
    expect(box.bottom).toBeLessThanOrEqual(footer.getBoundingClientRect().top);
    expect(
      modal.querySelector("wt-form-actions")!.shadowRoot!.querySelector("[data-error]"),
    ).toBeNull();
  });

  it("shows a passkey-specific message, not the generic banner, for any other ceremony failure", async () => {
    const { el, api } = await mount();
    // The library wraps this in a WebAuthnError whose `.code` must not reach codeOf, or the generic
    // banner shows instead.
    vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
      new DOMException("authenticator failed", "UnknownError"),
    );
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(api.passkeyRegisterVerify).not.toHaveBeenCalled();
    const bottom = await bottomOf(el);
    expect(bottom).toContain(codeMessage("passkey.verification_failed"));
    expect(bottom).not.toContain(codeMessage("__unmapped__"));
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  });

  it("stays quiet and keeps the modal open when the passkey prompt is cancelled", async () => {
    const { el } = await mount();
    vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
      new DOMException("cancelled", "NotAllowedError"),
    );
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(await bottomOf(el)).toBe("");
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  });

  it("still surfaces a specific server verify failure for a passkey", async () => {
    const { el } = await mount({
      passkeyRegisterVerify: vi.fn().mockRejectedValue({ code: "passkey.challenge_expired" }),
    });
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(await bottomOf(el)).toBe(codeMessage("passkey.challenge_expired"));
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

it("clears a failed refresh's message from the open form once the server answers again", async () => {
  const liveData = new LiveData();
  const api = Object.assign(apiStub(), { liveData });
  const { el } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect((el as unknown as { profile: unknown }).profile).not.toBeNull());
  await editDetails(el);
  const value = await api.getProfile();
  api.getProfile.mockRejectedValue({ code: "connection.failed" });
  liveData.refresh();
  await vi.waitFor(async () => expect(await bottomOf(el)).toBe(codeMessage("connection.failed")));
  api.getProfile.mockResolvedValue({ ...value, displayName: "Back again" });
  liveData.refresh();
  await vi.waitFor(() =>
    expect((el as unknown as { profile: { displayName: string } }).profile.displayName).toBe(
      "Back again",
    ),
  );
  expect(await bottomOf(el)).toBe("");
});

it("fills in the language list of a screen opened while the server could not be reached, once it answers again", async () => {
  const liveData = new LiveData();
  const down = { code: "connection.failed" };
  const stub = apiStub();
  const api = Object.assign(
    apiStub({
      getProfile: vi.fn().mockRejectedValueOnce(down).mockImplementation(stub.getProfile),
      getLocales: vi.fn().mockRejectedValueOnce(down).mockImplementation(stub.getLocales),
    }),
    { liveData },
  );
  const { el } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBe(
      codeMessage("connection.failed"),
    ),
  );
  liveData.refresh();
  const language = () =>
    [...el.shadowRoot!.querySelectorAll(".row")]
      .find((row) => row.querySelector(".field-label")!.textContent === t("profile.language"))
      ?.querySelector(".field-value")!
      .textContent!.trim();
  await vi.waitFor(() => expect(language()).toBe("English"));
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

describe("your profile — validation, refusals and the remaining actions", () => {
  async function baseProfile(overrides: Record<string, unknown> = {}) {
    return { ...(await apiStub().getProfile()), ...overrides };
  }
  function field(el: ProfileScreen, name: string) {
    return el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(`wt-input[name=${name}]`)!;
  }
  async function pressEnter(el: ProfileScreen, name: string) {
    const input = field(el, name);
    await input.updateComplete;
    input.shadowRoot!.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  }

  it("navigates the page itself to Google when no navigate hook is given", async () => {
    const api = apiStub({
      beginGoogleLink: vi.fn().mockResolvedValue({ authorizationUrl: "#google-link-probe" }),
    });
    const { el } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
      api: api as unknown as DashboardApi,
    });
    await flush(el);
    await click(el, "setup-google");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(location.hash).toBe("#google-link-probe");
  });

  it("ignores an Edit request before the profile has loaded, and loads again on Reload", async () => {
    const profile = await baseProfile();
    const { el, api } = await mount({
      getProfile: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValue(profile),
    });
    el.editDetails();
    await flush(el);
    expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("wt-button")!.click();
    await flush(el);
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.textContent).toContain("alex@example.com");
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
  });

  it("does not take the language list when it arrives after the screen was removed", async () => {
    let answer!: (value: unknown) => void;
    const { el } = await mount({
      getLocales: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        }),
      ),
    });
    el.remove();
    answer({ locales: [{ code: "en-GB", label: "English" }], venueDefault: "en-GB" });
    await flush(el);
    expect((el as unknown as { locales: unknown[] }).locales).toEqual([]);
  });

  it("shows placeholders for a missing surname and email, the venue's language, and opens them for completion", async () => {
    const profile = await baseProfile({ lastNames: null, email: null, locale: null });
    const { el } = await mount({
      getProfile: vi.fn().mockResolvedValue(profile),
      getLocales: vi.fn().mockResolvedValue({
        locales: [
          { code: "en-GB", label: "English" },
          { code: "es-ES", label: "Español" },
        ],
        venueDefault: "es-ES",
      }),
    });
    const values = [...el.shadowRoot!.querySelectorAll(".row")].map((row) => [
      row.querySelector(".field-label")!.textContent,
      row.querySelector(".field-value")!.textContent!.trim(),
    ]);
    expect(values).toContainEqual([t("person.last_names"), "—"]);
    expect(values).toContainEqual([t("login.email"), "—"]);
    expect(values).toContainEqual([t("profile.language"), "Español"]);
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
    expect(field(el, "lastNames").value).toBe("");
    expect(field(el, "lastNames").error).toBe(t("form.last_names_required"));
    expect(field(el, "email").value).toBe("");
    expect(field(el, "email").error).toBe(t("form.email_required"));
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { value: string }>("wt-combobox[name=locale]")!
        .value,
    ).toBe("es-ES");
  });

  it("sends a cleared telephone as null", async () => {
    const { el, api } = await mount();
    await editDetails(el);
    input(el, "telephone", "   ");
    await click(el, "save");
    expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ telephone: null }));
  });

  it("saves on Enter in a field, once, even when Save is clicked straight after", async () => {
    let finish!: () => void;
    const { el, api } = await mount({
      changePin: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      ),
    });
    await click(el, "change-pin");
    input(el, "currentPassword", "current");
    input(el, "pin", "4321");
    input(el, "confirmPin", "4321");
    await flush(el);
    await pressEnter(el, "confirmPin");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    finish();
    await flush(el);
    expect(api.changePin).toHaveBeenCalledExactlyOnceWith({
      currentPassword: "current",
      pin: "4321",
    });
  });

  it("hides a revealed password again on a second press", async () => {
    const { el } = await mount();
    await click(el, "change-password");
    const current = field(el, "currentPassword");
    const reveal = current.querySelector<HTMLElement>("[slot=end]")!;
    reveal.click();
    await flush(el);
    expect(current.shadowRoot!.querySelector("input")!.type).toBe("text");
    reveal.click();
    await flush(el);
    expect(current.shadowRoot!.querySelector("input")!.type).toBe("password");
    expect(current.querySelector("[slot=end]")!.getAttribute("aria-label")).toBe(
      t("login.show_password"),
    );
  });

  it("asks for the authenticator code as well when the account has one", async () => {
    const { el, api } = await mount({
      getProfile: vi.fn().mockResolvedValue(await baseProfile({ hasTotp: true })),
    });
    await click(el, "change-pin");
    input(el, "currentPassword", "current");
    input(el, "pin", "4321");
    input(el, "confirmPin", "4321");
    await click(el, "save");
    expect(api.changePin).not.toHaveBeenCalled();
    expect(field(el, "totp").error).toBe(t("profile.code_required"));
  });

  it("names each missing or short new-password field", async () => {
    const { el, api } = await mount();
    await click(el, "change-password");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(field(el, "password").error).toBe(t("form.password_required"));
    expect(field(el, "confirmPassword").error).toBe(t("form.confirm_password_required"));
    input(el, "password", "short");
    input(el, "confirmPassword", "short");
    await click(el, "save");
    expect(field(el, "password").error).toBe(codeMessage("password.too_short"));
    expect(field(el, "confirmPassword").error).toBe("");
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("names each missing, short or mismatched PIN field", async () => {
    const { el, api } = await mount();
    await click(el, "change-pin");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(field(el, "pin").error).toBe(t("form.pin_required"));
    expect(field(el, "confirmPin").error).toBe(t("form.pin_required"));
    input(el, "pin", "12");
    input(el, "confirmPin", "13");
    await click(el, "save");
    expect(field(el, "pin").error).toBe(codeMessage("pin.too_short"));
    expect(field(el, "confirmPin").error).toBe(t("account.pin_mismatch"));
    expect(api.changePin).not.toHaveBeenCalled();
  });

  it.each([
    ["en-GB", "Enter the code from your email"],
    ["es-ES", "Introduce el código de tu correo"],
  ])(
    "marks the emailed code as required when it is cleared after a refused attempt (%s)",
    async (locale, text) => {
      const before = currentLocale();
      setLocale(locale);
      try {
        const { el, api } = await mount({
          getProfile: vi
            .fn()
            .mockResolvedValue(await baseProfile({ pendingEmail: "new@example.com" })),
          confirmProfileEmail: vi.fn().mockRejectedValue({ code: "account_action.invalid" }),
        });
        await click(el, "confirm-email");
        input(el, "setupCode", "000000");
        await click(el, "save");
        input(el, "setupCode", "");
        await flush(el);
        expect(api.confirmProfileEmail).toHaveBeenCalledOnce();
        expect(field(el, "setupCode").error).toBe(text);
      } finally {
        setLocale(before);
      }
    },
  );

  it("marks the authenticator's code as required when it is cleared after a refused attempt", async () => {
    const { el, api } = await mount({
      finishTotp: vi.fn().mockRejectedValue({ code: "totp.invalid" }),
    });
    await click(el, "setup-authenticator");
    input(el, "currentPassword", "current");
    await click(el, "save");
    input(el, "setupCode", "000000");
    await click(el, "save");
    input(el, "setupCode", "");
    await flush(el);
    expect(api.finishTotp).toHaveBeenCalledOnce();
    expect(field(el, "setupCode").error).toBe(t("profile.code_required"));
  });

  it("replaces the recovery codes after current credentials and offers them as a download", async () => {
    const { el, api } = await mount({
      getProfile: vi.fn().mockResolvedValue(await baseProfile({ hasTotp: true })),
    });
    await click(el, "recovery-codes");
    expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe(
      t("profile.replace_recovery_codes"),
    );
    input(el, "currentPassword", "current");
    input(el, "totp", "123456");
    await click(el, "save");
    expect(api.regenerateRecoveryCodes).toHaveBeenCalledExactlyOnceWith({
      currentPassword: "current",
      totp: "123456",
    });
    expect(el.shadowRoot!.querySelector("[data-test=recovery-code-list]")!.textContent).toBe(
      "NEW-CODE",
    );

    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:recovery-codes";
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const links: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      links.push(this);
    });
    await click(el, "download-recovery-codes");
    expect(await blobs[0]!.text()).toBe("NEW-CODE\n");
    expect(blobs[0]!.type).toBe("text/plain");
    expect(links.map((link) => [link.getAttribute("href"), link.download])).toEqual([
      ["blob:recovery-codes", "waitron-recovery-codes.txt"],
    ]);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:recovery-codes");
  });

  it("does not report an update when the screen was removed while saving", async () => {
    let finish!: (value: unknown) => void;
    const { el } = await mount({
      saveProfile: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      ),
    });
    const updates: Event[] = [];
    el.addEventListener("profile-updated", (event) => updates.push(event));
    await editDetails(el);
    input(el, "displayName", "Alex R");
    await click(el, "save");
    el.remove();
    finish({ emailVerificationSent: false });
    await flush(el);
    await flush(el);
    expect(updates).toEqual([]);
    expect((el as unknown as { saved: boolean }).saved).toBe(false);
  });

  it.each([
    ["an authenticator code", "totp.invalid", "totp"],
    ["an email address", "person.email_taken", "email"],
    ["an email format", "person.email_invalid", "email"],
    ["a new password", "password.too_short", "password"],
    ["a new PIN", "pin.too_short", "pin"],
  ])("puts a server refusal of %s beside its field", async (_what, code, fieldName) => {
    const reject = vi.fn().mockRejectedValue({ code });
    const { el } = await mount({
      getProfile: vi.fn().mockResolvedValue(await baseProfile({ hasTotp: fieldName === "totp" })),
      disableTotp: reject,
      saveProfile: reject,
      changePassword: reject,
      changePin: reject,
    });
    if (fieldName === "totp") {
      await click(el, "disable-authenticator");
      input(el, "totp", "000000");
    } else if (fieldName === "email") {
      await editDetails(el);
      input(el, "email", "taken@example.com");
      await flush(el);
    } else if (fieldName === "password") {
      await click(el, "change-password");
      input(el, "password", "long enough password");
      input(el, "confirmPassword", "long enough password");
    } else {
      await click(el, "change-pin");
      input(el, "pin", "4321");
      input(el, "confirmPin", "4321");
    }
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(reject).toHaveBeenCalledTimes(1);
    expect(field(el, fieldName).error).toBe(codeMessage(code));
    expect(field(el, "currentPassword").error).toBe("");
  });

  it("puts a taken display name beside its field, the generic sentence above Save, and clears the field when it is edited", async () => {
    const saveProfile = vi.fn().mockRejectedValue({ code: "person.display_name_taken" });
    const { el } = await mount({ saveProfile });
    await editDetails(el);
    input(el, "displayName", "Alex R");
    await flush(el);
    await click(el, "save");
    expect(saveProfile).toHaveBeenCalledTimes(1);
    const message = codeMessage("person.display_name_taken");
    expect(field(el, "displayName").error).toBe(message);
    expect(field(el, "email").error).toBe("");
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));

    input(el, "displayName", "Alex Rivera");
    await flush(el);
    expect(field(el, "displayName").error).toBe("");
  });

  it("announces the Security tab when it is chosen, and ignores a change event from inside a panel", async () => {
    const { el } = await mount();
    const announced: unknown[] = [];
    el.addEventListener("profile-tab-change", (event) =>
      announced.push((event as CustomEvent).detail),
    );
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    el.shadowRoot!.querySelector("[slot=details]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "security" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(announced).toEqual([]);
    expect(tabs.value).toBe("details");
    tabs.shadowRoot!.querySelector<HTMLElement>("[role=tab][data-key=security]")!.click();
    await flush(el);
    expect(announced).toEqual([{ tab: "security", ready: true }]);
    expect(tabs.value).toBe("security");
  });

  it("offers no passkey removal on an account without a password", async () => {
    const { el } = await mount({
      getProfile: vi.fn().mockResolvedValue(await baseProfile({ hasPassword: false })),
    });
    expect(el.shadowRoot!.querySelector(".passkey-item")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=remove-passkey]")).toBeNull();
  });

  it("stays open when a close event bubbles up from inside the modal", async () => {
    const { el } = await mount();
    await editDetails(el);
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    el.shadowRoot!.querySelector("wt-form-actions")!.dispatchEvent(
      new CustomEvent("wt-close", { bubbles: true, composed: true }),
    );
    await flush(el);
    expect(modal.open).toBe(true);
    expect(field(el, "displayName")).not.toBeNull();
  });
});

describe("your profile — errors at the bottom of the form, not above it", () => {
  function field(el: ProfileScreen, name: string) {
    return el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(`wt-input[name=${name}]`)!;
  }
  const save = (el: ProfileScreen) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
  const focused = (el: ProfileScreen, name: string) =>
    field(el, name).shadowRoot!.activeElement ===
    field(el, name).shadowRoot!.querySelector("input");
  const nativeSaveDisabled = async (el: ProfileScreen): Promise<boolean> => {
    const button = save(el) as ReturnType<typeof save> & { updateComplete: Promise<unknown> };
    await button.updateComplete;
    return button.shadowRoot!.querySelector("button")!.disabled;
  };

  it("says nothing until Save, then marks each field, focuses the first and waits for them", async () => {
    const { el, api } = await mount();
    await click(el, "change-pin");
    expect(field(el, "currentPassword").error).toBe("");
    expect(field(el, "pin").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect([save(el).variant, save(el).disabled]).toEqual(["secondary", true]);

    input(el, "pin", "12");
    await click(el, "save");
    expect(api.changePin).not.toHaveBeenCalled();
    expect(field(el, "currentPassword").error).toBe(t("form.password_required"));
    expect(field(el, "pin").error).toBe(codeMessage("pin.too_short"));
    expect(field(el, "pin").value).toBe("12");
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(save(el).disabled).toBe(true);
    await vi.waitFor(() => expect(focused(el, "currentPassword")).toBe(true));

    input(el, "currentPassword", "current");
    input(el, "pin", "4321");
    input(el, "confirmPin", "4321");
    await flush(el);
    expect(field(el, "pin").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(save(el).disabled).toBe(false);

    input(el, "confirmPin", "4322");
    await flush(el);
    expect(field(el, "confirmPin").error).toBe(t("account.pin_mismatch"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(save(el).disabled).toBe(true);
  });

  it("focuses the field a refusal names and leaves Save working until that field changes", async () => {
    const changePassword = vi.fn().mockRejectedValue({ code: "password.invalid" });
    const { el } = await mount({ changePassword });
    await click(el, "change-password");
    input(el, "currentPassword", "wrong");
    input(el, "password", "replacement password");
    input(el, "confirmPassword", "replacement password");
    await click(el, "save");
    expect(changePassword).toHaveBeenCalledTimes(1);
    expect(field(el, "currentPassword").error).toBe(codeMessage("password.invalid"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await nativeSaveDisabled(el)).toBe(false);
    await vi.waitFor(() => expect(focused(el, "currentPassword")).toBe(true));

    input(el, "currentPassword", "current");
    await flush(el);
    expect(field(el, "currentPassword").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(save(el).disabled).toBe(false);
  });

  it.each([
    ["person.email_taken", undefined, "email"],
    ["person.telephone_invalid", undefined, "telephone"],
    ["profile.invalid", "lastNames", "lastNames"],
  ])(
    "puts a refused %s on your details under its field, leaving Save working",
    async (code, paramsField, name) => {
      const saveProfile = vi
        .fn()
        .mockRejectedValue({ code, params: paramsField ? { field: paramsField } : {} });
      const { el } = await mount({ saveProfile });
      await editDetails(el);
      input(el, "email", "new@example.com");
      await flush(el);
      input(el, "currentPassword", "current");
      await click(el, "save");
      expect(saveProfile).toHaveBeenCalledTimes(1);
      expect(field(el, name).error).toBe(codeMessage(code));
      expect(await bottomOf(el)).toBe(t("form.fix_fields"));
      expect(await nativeSaveDisabled(el)).toBe(false);
      await vi.waitFor(() => expect(focused(el, name)).toBe(true));
    },
  );

  it("keeps a refusal whose params name a field the form does not show in the bottom message", async () => {
    const saveProfile = vi
      .fn()
      .mockRejectedValue({ code: "profile.invalid", params: { field: "passkeyName" } });
    const { el } = await mount({ saveProfile });
    await editDetails(el);
    input(el, "displayName", "Alex R");
    await click(el, "save");
    expect(await bottomOf(el)).toBe(codeMessage("profile.invalid"));
    expect(await nativeSaveDisabled(el)).toBe(false);
  });

  it("puts a refused passkey name under its field, leaving Save working", async () => {
    const { el } = await mount({
      passkeyRegisterVerify: vi
        .fn()
        .mockRejectedValue({ code: "profile.invalid", params: { field: "passkeyName" } }),
    });
    await click(el, "add-passkey");
    input(el, "passkeyName", "Work laptop");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(field(el, "passkeyName").error).toBe(codeMessage("profile.invalid"));
    expect(field(el, "currentPassword").error).toBe("");
    expect(await nativeSaveDisabled(el)).toBe(false);
  });

  it("puts a refused authenticator code under the new authenticator's code field, leaving Save working", async () => {
    const { el } = await mount({
      finishTotp: vi.fn().mockRejectedValue({ code: "totp.invalid" }),
    });
    await click(el, "setup-authenticator");
    input(el, "currentPassword", "current");
    await click(el, "save");
    input(el, "setupCode", "000000");
    await click(el, "save");
    expect(field(el, "setupCode").error).toBe(codeMessage("totp.invalid"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await nativeSaveDisabled(el)).toBe(false);

    input(el, "setupCode", "123456");
    await flush(el);
    expect(field(el, "setupCode").error).toBe("");
    expect(await bottomOf(el)).toBe("");
  });

  it("keeps Save waiting on a field emptied while a request was out, even when the refusal names it", async () => {
    let reject!: (error: unknown) => void;
    const changePassword = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { el } = await mount({ changePassword });
    await click(el, "change-password");
    input(el, "currentPassword", "wrong");
    input(el, "password", "replacement password");
    input(el, "confirmPassword", "replacement password");
    await click(el, "save");
    input(el, "currentPassword", "");
    await flush(el);
    reject({ code: "password.invalid" });
    await flush(el);
    expect(field(el, "currentPassword").error).toBe(codeMessage("password.invalid"));
    expect(await nativeSaveDisabled(el)).toBe(true);

    input(el, "currentPassword", "current");
    await flush(el);
    expect(field(el, "currentPassword").error).toBe("");
    expect(await nativeSaveDisabled(el)).toBe(false);
  });

  it("puts a refused emailed code under the code field until that field changes, leaving Save working", async () => {
    const profile = await apiStub().getProfile();
    const { el } = await mount({
      getProfile: vi.fn().mockResolvedValue({ ...profile, pendingEmail: "new@example.com" }),
      confirmProfileEmail: vi.fn().mockRejectedValue({ code: "account_action.invalid" }),
    });
    await click(el, "confirm-email");
    input(el, "setupCode", "123456");
    await click(el, "save");
    // The code's own sentence speaks of a link; under a code field the screen says code.
    expect(field(el, "setupCode").error).toBe(
      "Este código no es correcto o ya no es válido. Revísalo o vuelve a cambiar tu correo para recibir uno nuevo.",
    );
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await nativeSaveDisabled(el)).toBe(false);
    await vi.waitFor(() => expect(focused(el, "setupCode")).toBe(true));

    input(el, "setupCode", "654321");
    await flush(el);
    expect(field(el, "setupCode").error).toBe("");
    expect(await bottomOf(el)).toBe("");
  });

  it("puts a refused language under the language dropdown until that dropdown changes, leaving Save working", async () => {
    const { el, host } = await mount({
      saveProfile: vi.fn().mockRejectedValue({ code: "locale.unsupported" }),
    });
    await editDetails(el);
    input(el, "telephone", "+34 600 000 001");
    await click(el, "save");
    const language = el.shadowRoot!.querySelector<HTMLElement>("wt-combobox[name=locale]")!;
    const control = language.shadowRoot!.querySelector(".trigger")!;
    expect(control.getAttribute("aria-invalid")).toBe("true");
    const described = language.shadowRoot!.getElementById(
      control.getAttribute("aria-describedby")!,
    )!;
    expect(described.textContent!.trim()).toBe("Ese idioma no está disponible. Elige otro.");
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await nativeSaveDisabled(el)).toBe(false);
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(language));
    await expectNoA11yViolations(host);

    await chooseOption(language, "es-ES");
    await flush(el);
    expect(control.getAttribute("aria-invalid")).toBe("false");
    expect(control.hasAttribute("aria-describedby")).toBe(false);
    expect(described.isConnected).toBe(false);
    expect(await bottomOf(el)).toBe("");
  });

  it("still waits on a required field an incomplete profile opens with", async () => {
    const profile = await apiStub().getProfile();
    const { el } = await mount({
      getProfile: vi.fn().mockResolvedValue({ ...profile, firstNames: null }),
    });
    expect(field(el, "firstNames").error).toBe(t("form.first_names_required"));
    expect(await nativeSaveDisabled(el)).toBe(true);
  });

  it("re-checks a refused field once it changes", async () => {
    const { el } = await mount({
      saveProfile: vi.fn().mockRejectedValue({ code: "person.display_name_taken" }),
    });
    await editDetails(el);
    input(el, "displayName", "Alex R");
    await click(el, "save");
    expect(field(el, "displayName").error).toBe(codeMessage("person.display_name_taken"));
    input(el, "displayName", "");
    await flush(el);
    expect(field(el, "displayName").error).toBe(t("form.display_name_required"));
    expect(save(el).disabled).toBe(true);
  });

  it("leaves Save working after a refusal that names no field, and drops it on the next Save", async () => {
    let finish!: () => void;
    const changePin = vi
      .fn()
      .mockRejectedValueOnce({ code: "server.internal" })
      .mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const { el } = await mount({ changePin });
    await click(el, "change-pin");
    input(el, "currentPassword", "current");
    input(el, "pin", "4321");
    input(el, "confirmPin", "4321");
    await click(el, "save");
    expect(await bottomOf(el)).toBe(codeMessage("server.internal"));
    expect(save(el).disabled).toBe(false);
    for (const name of ["currentPassword", "pin", "confirmPin"])
      expect(field(el, name).error).toBe("");

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("");
    finish();
    await flush(el);
  });

  it("shows a refusal and the generic sentence together when a field breaks after it", async () => {
    const { el } = await mount({
      changePin: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    await click(el, "change-pin");
    input(el, "currentPassword", "current");
    input(el, "pin", "4321");
    input(el, "confirmPin", "4321");
    await click(el, "save");
    input(el, "pin", "");
    await flush(el);
    expect(field(el, "pin").error).toBe(t("form.pin_required"));
    expect(await bottomOf(el)).toBe(`${codeMessage("server.internal")} ${t("form.fix_fields")}`);
    expect(save(el).disabled).toBe(true);
  });

  it("starts again when the form is reopened", async () => {
    const { el } = await mount();
    await click(el, "change-pin");
    input(el, "pin", "12");
    await click(el, "save");
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    await click(el, "cancel");
    await click(el, "change-pin");
    expect(field(el, "currentPassword").error).toBe("");
    expect(field(el, "pin").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect([save(el).variant, save(el).disabled]).toEqual(["secondary", true]);
  });

  it("asks nothing of the authenticator code until the code step's own Save", async () => {
    const { el } = await mount();
    await click(el, "setup-authenticator");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(field(el, "setupCode").error).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect([save(el).variant, save(el).disabled]).toEqual(["secondary", true]);
  });
});

describe("your profile — the signed-in email is named as the username beside the current-password field", () => {
  function expectSavedUsernameBeside(el: ProfileScreen, email: string) {
    const root = el.shadowRoot!;
    const username = root.querySelector<HTMLInputElement>("input[autocomplete=username]");
    expect(username, "a username field beside the current password").not.toBeNull();
    expect(username!.value).toBe(email);
    expect(username!.type).toBe("email");
    expect(username!.readOnly).toBe(true);
    expect(username!.tabIndex).toBe(-1);
    expect(username!.getAttribute("aria-hidden")).toBe("true");
    const password = root.querySelector<HTMLElement>("wt-input[name=currentPassword]")!;
    expect(password.shadowRoot!.querySelector("input")!.autocomplete).toBe("current-password");
    expect(username!.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    const box = username!.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
  }

  it("on every step that asks for the current password", async () => {
    const { el } = await mount();
    for (const action of [
      "change-password",
      "change-pin",
      "add-passkey",
      "remove-passkey",
      "setup-authenticator",
      "setup-google",
    ]) {
      await click(el, action);
      expectSavedUsernameBeside(el, "alex@example.com");
      await click(el, "cancel");
    }
    await editDetails(el);
    input(el, "email", "new@example.com");
    await flush(el);
    expectSavedUsernameBeside(el, "alex@example.com");
  });

  it("on the steps an authenticator and a linked Google account add", async () => {
    const profile = { ...(await apiStub().getProfile()), hasTotp: true, hasGoogle: true };
    const { el } = await mount({ getProfile: vi.fn().mockResolvedValue(profile) });
    for (const action of ["recovery-codes", "disable-authenticator", "unlink-google"]) {
      await click(el, action);
      expectSavedUsernameBeside(el, "alex@example.com");
      await click(el, "cancel");
    }
  });

  it("names no username for an account with no email, and none on a step that asks no password", async () => {
    const { el } = await mount();
    await editDetails(el);
    expect(el.shadowRoot!.querySelector("input[autocomplete=username]")).toBeNull();
    await click(el, "cancel");
    const profile = { ...(await apiStub().getProfile()), email: null };
    const { el: noEmail } = await mount({ getProfile: vi.fn().mockResolvedValue(profile) });
    expect(noEmail.shadowRoot!.querySelector("wt-input[name=currentPassword]")).not.toBeNull();
    expect(noEmail.shadowRoot!.querySelector("input[autocomplete=username]")).toBeNull();
  });
});

describe("your profile — a save's message across an outage", () => {
  async function mountLive() {
    const liveData = new LiveData();
    const api = Object.assign(apiStub(), { liveData });
    const { el } = await mountWidget<ProfileScreen>("dashboard-profile-screen", {
      api: api as unknown as DashboardApi,
    });
    await vi.waitFor(() => expect((el as unknown as { profile: unknown }).profile).not.toBeNull());
    const value = await api.getProfile();
    return { el, api, liveData, value };
  }
  const displayName = (el: ProfileScreen) =>
    (el as unknown as { profile: { displayName: string } }).profile.displayName;

  it("keeps a save's connection failure when the reads recover", async () => {
    const { el, api, liveData, value } = await mountLive();
    await click(el, "change-pin");
    input(el, "currentPassword", "current");
    input(el, "pin", "4321");
    input(el, "confirmPin", "4321");
    api.getProfile.mockRejectedValue({ code: "connection.failed" });
    liveData.refresh();
    await vi.waitFor(async () => expect(await bottomOf(el)).toBe(codeMessage("connection.failed")));
    api.changePin.mockRejectedValueOnce({ code: "connection.failed" });
    await click(el, "save");
    expect(api.changePin).toHaveBeenCalledTimes(1);
    const before = api.getProfile.mock.calls.length;
    liveData.refresh();
    await vi.waitFor(() => expect(api.getProfile.mock.calls.length).toBeGreaterThan(before));
    await flush(el);
    api.getProfile.mockResolvedValue({ ...value, displayName: "Back again" });
    liveData.refresh();
    await vi.waitFor(() => expect(displayName(el)).toBe("Back again"));
    expect(await bottomOf(el)).toBe(codeMessage("connection.failed"));
  });

  it("keeps a passkey's refusal when a later read fails and recovers", async () => {
    const { el, api, liveData, value } = await mountLive();
    vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
      new DOMException("already registered", "InvalidStateError"),
    );
    await click(el, "add-passkey");
    input(el, "currentPassword", "current");
    await click(el, "save");
    expect(await bottomOf(el)).toBe(codeMessage("passkey.already_registered"));
    api.getProfile.mockRejectedValue({ code: "connection.failed" });
    const before = api.getProfile.mock.calls.length;
    liveData.refresh();
    await vi.waitFor(() => expect(api.getProfile.mock.calls.length).toBeGreaterThan(before));
    await flush(el);
    expect(await bottomOf(el)).toBe(codeMessage("passkey.already_registered"));
    api.getProfile.mockResolvedValue({ ...value, displayName: "Back again" });
    liveData.refresh();
    await vi.waitFor(() => expect(displayName(el)).toBe("Back again"));
    expect(await bottomOf(el)).toBe(codeMessage("passkey.already_registered"));
  });
});
