import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, OwnProfile } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { FreshSignIn } from "./fresh-sign-in.js";
import "./fresh-sign-in.js";

// Keep the real WebAuthn library; stub only the hardware boundary.
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

const PASSKEY = { id: "pk1", name: null, createdAt: "", lastUsedAt: null, provider: null };

function profile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    displayName: "Marta",
    firstNames: "Marta",
    lastNames: "López",
    telephone: null,
    email: "marta@example.test",
    pendingEmail: null,
    locale: null,
    hasPassword: true,
    hasTotp: false,
    hasGoogle: false,
    passkeys: [],
    ...overrides,
  };
}

function stubApi(own: OwnProfile) {
  return {
    getProfile: vi.fn().mockResolvedValue(own),
    recoveryPackPasskeyOptions: vi
      .fn()
      .mockResolvedValue({ challengeHandle: "h1", options: { challenge: "AQID" } }),
  };
}

async function mount(own: OwnProfile, api = stubApi(own)) {
  const { el } = await mountWidget<FreshSignIn>("dashboard-fresh-sign-in", {
    api: api as unknown as DashboardApi,
  });
  await vi.waitFor(() => expect(el.ways).not.toBeNull());
  await el.updateComplete;
  return { el, api, root: el.shadowRoot! };
}

function field(root: ShadowRoot, name: string) {
  return root.querySelector<HTMLElementTagNameMap["wt-input"]>(`wt-input[name=${name}]`);
}

function type(root: ShadowRoot, name: string, value: string): void {
  field(root, name)!.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}

beforeEach(() => {
  vi.spyOn(navigator.credentials, "get").mockResolvedValue(passkeyCredential());
});
afterEach(cleanupWidgets);
afterEach(() => vi.restoreAllMocks());
afterEach(() => setLocale("en-GB"));

describe("the code field", () => {
  it("is absent for a person with no authenticator", async () => {
    const { root } = await mount(profile({ hasTotp: false }));
    expect(field(root, "totp")).toBeNull();
  });

  it("is present and required for a person with an authenticator", async () => {
    const { root } = await mount(profile({ hasTotp: true }));
    const code = field(root, "totp")!;
    expect(code.required).toBe(true);
    expect(code.autocomplete).toBe("one-time-code");
    expect(code.label).toBe(t("fresh_sign_in.code"));
    expect(code.placeholder).toBe(t("fresh_sign_in.code_hint"));
  });
});

describe("the sign-in body", () => {
  it("carries the password and no code when the code field is not shown", async () => {
    const { el, root } = await mount(profile());
    type(root, "current-password", "hunter2-hunter2");
    expect(await el.signIn()).toEqual({ method: "password", password: "hunter2-hunter2" });
  });

  it("sends a 6-digit entry as totp", async () => {
    const { el, root } = await mount(profile({ hasTotp: true }));
    type(root, "current-password", "hunter2-hunter2");
    type(root, "totp", " 123456 ");
    expect(await el.signIn()).toEqual({
      method: "password",
      password: "hunter2-hunter2",
      totp: "123456",
    });
  });

  it("sends anything else as recoveryCode", async () => {
    const { el, root } = await mount(profile({ hasTotp: true }));
    type(root, "current-password", "hunter2-hunter2");
    type(root, "totp", "ab12-cd34");
    expect(await el.signIn()).toEqual({
      method: "password",
      password: "hunter2-hunter2",
      recoveryCode: "ab12-cd34",
    });
  });

  it("refuses to sign in with an empty required field, saying so under each", async () => {
    const { el, root } = await mount(profile({ hasTotp: true }));
    expect(await el.signIn()).toBeNull();
    await el.updateComplete;
    expect(field(root, "current-password")!.error).toBe(t("form.password_required"));
    expect(field(root, "totp")!.error).toBe(t("fresh_sign_in.code_required"));
    type(root, "current-password", "x");
    await el.updateComplete;
    expect(field(root, "current-password")!.error).toBe("");
    expect(field(root, "totp")!.error).toBe(t("fresh_sign_in.code_required"));
  });

  it("draws the password field for the current password, with a reveal button", async () => {
    const { el, root } = await mount(profile());
    const password = field(root, "current-password")!;
    expect(password.required).toBe(true);
    expect(password.autocomplete).toBe("current-password");
    expect(password.type).toBe("password");
    const reveal = password.querySelector<HTMLElement>('wt-button[slot="end"]')!;
    expect(reveal.getAttribute("aria-label")).toBe(t("login.show_password"));
    reveal.click();
    await el.updateComplete;
    expect(password.type).toBe("text");
    expect(reveal.getAttribute("aria-label")).toBe(t("login.hide_password"));
  });

  it("forgets the password and the code when cleared", async () => {
    const { el, root } = await mount(profile({ hasTotp: true }));
    type(root, "current-password", "hunter2-hunter2");
    type(root, "totp", "123456");
    await el.updateComplete;
    el.clear();
    await el.updateComplete;
    expect(field(root, "current-password")!.value).toBe("");
    expect(field(root, "totp")!.value).toBe("");
    expect(await el.signIn()).toBeNull();
  });
});

describe("the ways in", () => {
  it("offers the passkey instead of the password to a person who has a password", async () => {
    const { el, root } = await mount(profile({ passkeys: [PASSKEY] }));
    expect(field(root, "current-password")).not.toBeNull();
    const button = root.querySelector<HTMLElement>("[data-test=use-passkey]")!;
    expect(button.textContent!.trim()).toBe(t("fresh_sign_in.use_passkey_instead"));
    expect(el.ways).toEqual({ password: true, passkey: true });
  });

  it("offers the passkey alone to a person with no password", async () => {
    const { el, root } = await mount(profile({ hasPassword: false, passkeys: [PASSKEY] }));
    expect(field(root, "current-password")).toBeNull();
    const button = root.querySelector<HTMLElement>("[data-test=use-passkey]")!;
    expect(button.textContent!.trim()).toBe(t("fresh_sign_in.use_passkey"));
    expect(el.ways).toEqual({ password: false, passkey: true });
  });

  it("tells a person with neither a password nor a passkey how to get a password, and offers nothing to press", async () => {
    const { el, root, api } = await mount(profile({ hasPassword: false, passkeys: [] }));
    expect(root.querySelectorAll("wt-input, wt-button")).toHaveLength(0);
    const words = root.querySelector("[data-test=no-way-in]")!.textContent!;
    expect(words).toContain(t("fresh_sign_in.no_way_in"));
    expect(words).toContain(t("profile.password_recovery"));
    expect(el.ways).toEqual({ password: false, passkey: false });
    expect(await el.signIn()).toBeNull();
    expect(await el.signIn("passkey")).toBeNull();
    expect(api.recoveryPackPasskeyOptions).not.toHaveBeenCalled();
  });

  it("announces its ways in once the profile is read", async () => {
    const own = profile({ hasPassword: false, passkeys: [PASSKEY] });
    const host = document.createElement("div");
    document.body.append(host);
    const seen = vi.fn();
    host.addEventListener("sign-in-ways", (event) => seen((event as CustomEvent).detail));
    const el = document.createElement("dashboard-fresh-sign-in") as FreshSignIn;
    el.api = stubApi(own) as unknown as DashboardApi;
    host.append(el);
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith({ password: false, passkey: true }));
    host.remove();
  });

  it("asks the screen to sign in with the passkey when its button is pressed", async () => {
    const { el, root } = await mount(profile({ passkeys: [PASSKEY] }));
    const chosen = vi.fn();
    el.addEventListener("sign-in-passkey", chosen);
    root.querySelector<HTMLElement>("[data-test=use-passkey]")!.click();
    expect(chosen).toHaveBeenCalledOnce();
  });

  it("says why when the profile cannot be read, and reads it again on request", async () => {
    const own = profile();
    const api = stubApi(own);
    api.getProfile.mockRejectedValueOnce({ code: "connection.failed" });
    const { el } = await mountWidget<FreshSignIn>("dashboard-fresh-sign-in", {
      api: api as unknown as DashboardApi,
    });
    const root = el.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector("[data-test=profile-failed]")).not.toBeNull());
    expect(root.querySelector("[data-test=profile-failed]")!.textContent).toContain(
      t("fresh_sign_in.profile_failed"),
    );
    expect(el.ways).toBeNull();
    root.querySelector<HTMLElement>("[data-test=profile-retry]")!.click();
    await vi.waitFor(() => expect(el.ways).toEqual({ password: true, passkey: false }));
  });
});

describe("a passkey run", () => {
  it("sends the challenge handle and the signed response, without asking for the password", async () => {
    const { el, api } = await mount(profile({ passkeys: [PASSKEY] }));
    const body = await el.signIn("passkey");
    expect(api.recoveryPackPasskeyOptions).toHaveBeenCalledOnce();
    expect(body).toEqual({
      method: "passkey",
      challengeHandle: "h1",
      response: expect.objectContaining({ id: "cred-abc", type: "public-key" }),
    });
    expect(navigator.credentials.get).toHaveBeenCalledOnce();
  });

  it("sends the code with the passkey when the person has an authenticator", async () => {
    const { el, root } = await mount(
      profile({ hasPassword: false, hasTotp: true, passkeys: [PASSKEY] }),
    );
    expect(await el.signIn()).toBeNull();
    expect(navigator.credentials.get).not.toHaveBeenCalled();
    type(root, "totp", "654321");
    expect(await el.signIn()).toEqual({
      method: "passkey",
      challengeHandle: "h1",
      response: expect.objectContaining({ id: "cred-abc" }),
      totp: "654321",
    });
  });

  it("stops quietly when the person cancels the passkey prompt", async () => {
    const { el } = await mount(profile({ passkeys: [PASSKEY] }));
    vi.mocked(navigator.credentials.get).mockRejectedValueOnce(
      new DOMException("cancelled", "NotAllowedError"),
    );
    expect(await el.signIn("passkey")).toBeNull();
  });
});

describe("refusals", () => {
  it("puts password.invalid under the password field", async () => {
    const { el, root } = await mount(profile({ hasTotp: true }));
    expect(el.refuse({ code: "password.invalid", status: 401 })).toBe("");
    await el.updateComplete;
    expect(field(root, "current-password")!.error).toBe(codeMessage("password.invalid"));
    expect(field(root, "totp")!.error).toBe("");
  });

  it("puts totp.invalid under the code field", async () => {
    const { el, root } = await mount(profile({ hasTotp: true }));
    expect(el.refuse({ code: "totp.invalid", status: 401 })).toBe("");
    await el.updateComplete;
    expect(field(root, "totp")!.error).toBe(codeMessage("totp.invalid"));
    expect(field(root, "current-password")!.error).toBe("");
  });

  it("hands password.throttled back for the bottom message", async () => {
    const { el, root } = await mount(profile());
    expect(el.refuse({ code: "password.throttled", status: 429 })).toBe(
      codeMessage("password.throttled"),
    );
    await el.updateComplete;
    expect(field(root, "current-password")!.error).toBe("");
  });

  it("hands a failed passkey prompt back for the bottom message", async () => {
    const { el } = await mount(profile({ passkeys: [PASSKEY] }));
    vi.mocked(navigator.credentials.get).mockRejectedValueOnce(new Error("authenticator broke"));
    const error = await el.signIn("passkey").catch((thrown: unknown) => thrown);
    expect(el.refuse(error)).toBe(codeMessage("passkey.verification_failed"));
  });

  it("hands a passkey the server refuses back for the bottom message", async () => {
    const { el } = await mount(profile({ passkeys: [PASSKEY] }));
    expect(el.refuse({ code: "passkey.verification_failed", status: 401 })).toBe(
      codeMessage("passkey.verification_failed"),
    );
    expect(el.refuse({ code: "passkey.challenge_expired", status: 401 })).toBe(
      codeMessage("passkey.challenge_expired"),
    );
  });

  it("tells a person with no passkey how to add one on their profile", async () => {
    const own = profile();
    const api = stubApi(own);
    api.recoveryPackPasskeyOptions.mockRejectedValueOnce({
      code: "passkey.not_registered",
      status: 409,
    });
    const { el } = await mount(own, api);
    const error = await el.signIn("passkey").catch((thrown: unknown) => thrown);
    expect(el.refuse(error)).toBe(t("fresh_sign_in.passkey_not_registered"));
    expect(navigator.credentials.get).not.toHaveBeenCalled();
  });

  it("never points a person with no password at adding a passkey", async () => {
    const { el } = await mount(profile({ hasPassword: false, passkeys: [PASSKEY] }));
    const words = el.refuse({ code: "passkey.not_registered", status: 409 });
    expect(words).toBe(`${t("fresh_sign_in.no_way_in")} ${t("profile.password_recovery")}`);
  });

  it("hands a code refusal back for the bottom message when the code field is not shown", async () => {
    const { el } = await mount(profile({ hasTotp: false }));
    expect(el.refuse({ code: "totp.required", status: 401 })).toBe(codeMessage("totp.required"));
  });

  it("clears a field's refusal when that field is edited", async () => {
    const { el, root } = await mount(profile());
    el.refuse({ code: "password.invalid", status: 401 });
    await el.updateComplete;
    type(root, "current-password", "again");
    await el.updateComplete;
    expect(field(root, "current-password")!.error).toBe("");
  });
});

describe("the words", () => {
  const KEYS = [
    "fresh_sign_in.code",
    "fresh_sign_in.code_hint",
    "fresh_sign_in.code_required",
    "fresh_sign_in.use_passkey",
    "fresh_sign_in.use_passkey_instead",
    "fresh_sign_in.no_way_in",
    "fresh_sign_in.passkey_not_registered",
    "fresh_sign_in.profile_failed",
    "fresh_sign_in.password",
  ] as const;

  it("has its own English and Spanish for every sentence", () => {
    for (const key of KEYS) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
      expect(es[key]).not.toBe(en[key]);
    }
  });

  it.each([
    ["en-GB", en],
    ["es-ES", es],
  ] as const)("draws its labels in %s", async (locale, words) => {
    setLocale(locale);
    const { root } = await mount(profile({ hasTotp: true, passkeys: [PASSKEY] }));
    expect(field(root, "current-password")!.label).toBe(words["fresh_sign_in.password"]);
    expect(field(root, "totp")!.label).toBe(words["fresh_sign_in.code"]);
    expect(field(root, "totp")!.placeholder).toBe(words["fresh_sign_in.code_hint"]);
    expect(root.querySelector("[data-test=use-passkey]")!.textContent!.trim()).toBe(
      words["fresh_sign_in.use_passkey_instead"],
    );
  });

  it("draws the no-way-in sentences in Spanish", async () => {
    setLocale("es-ES");
    const { root } = await mount(profile({ hasPassword: false, passkeys: [] }));
    const words = root.querySelector("[data-test=no-way-in]")!.textContent!;
    expect(words).toContain(es["fresh_sign_in.no_way_in"]);
    expect(words).toContain(es["profile.password_recovery"]);
  });
});
