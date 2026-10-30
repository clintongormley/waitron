import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
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

  it("sends six digits typed with spaces as totp, without the spaces", async () => {
    const { el, root } = await mount(profile({ hasTotp: true }));
    type(root, "current-password", "hunter2-hunter2");
    type(root, "totp", "123 456");
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

describe("what the holding form reads", () => {
  it("says whether anything is typed, and announces each edit", async () => {
    const { el, root } = await mount(profile({ hasTotp: true }));
    const edits = vi.fn();
    el.addEventListener("sign-in-change", edits);
    expect(el.typed).toBe(false);
    type(root, "totp", "1");
    expect(el.typed).toBe(true);
    expect(edits).toHaveBeenCalledOnce();
    type(root, "totp", "");
    expect(el.typed).toBe(false);
    type(root, "current-password", "x");
    expect(el.typed).toBe(true);
    expect(edits).toHaveBeenCalledTimes(3);
    el.clear();
    expect(el.typed).toBe(false);
  });

  it("is invalid only after a press found an empty required field, until it is filled", async () => {
    const { el, root } = await mount(profile({ hasTotp: true }));
    expect(el.invalid).toBe(false);
    expect(await el.signIn()).toBeNull();
    expect(el.invalid).toBe(true);
    type(root, "current-password", "x");
    expect(el.invalid).toBe(true);
    type(root, "totp", "123456");
    expect(el.invalid).toBe(false);
    el.clear();
    expect(el.invalid).toBe(false);
  });

  it("gives an emptied field its sentence back after a press", async () => {
    const { el, root } = await mount(profile());
    type(root, "current-password", "x");
    expect(await el.signIn()).not.toBeNull();
    type(root, "current-password", "");
    await el.updateComplete;
    expect(field(root, "current-password")!.error).toBe(t("form.password_required"));
    expect(el.invalid).toBe(true);
  });

  it("does not count a refusal under a field as the form's own check", async () => {
    const { el, root } = await mount(profile());
    type(root, "current-password", "x");
    await el.signIn();
    el.refuse({ code: "password.invalid", status: 401 });
    expect(el.marked).toBe(true);
    expect(el.invalid).toBe(false);
    type(root, "current-password", "y");
    expect(el.marked).toBe(false);
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

  /** A prompt that never answers on its own, and is refused as a browser refuses one when aborted. */
  function promptHeldOpen(): { signal: () => AbortSignal | undefined } {
    let seen: AbortSignal | undefined;
    vi.mocked(navigator.credentials.get).mockImplementationOnce(
      (options) =>
        new Promise((_resolve, reject) => {
          seen = options?.signal ?? undefined;
          seen?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    return { signal: () => seen };
  }

  it.each([
    ["cleared", (el: FreshSignIn) => el.clear()],
    ["removed", (el: FreshSignIn) => el.remove()],
  ])("closes an open passkey prompt when %s, and its sign-in gives nothing", async (_l, close) => {
    const { el } = await mount(profile({ passkeys: [PASSKEY] }));
    const prompt = promptHeldOpen();
    const pending = el.signIn("passkey");
    await vi.waitFor(() => expect(prompt.signal()).toBeDefined());
    close(el);
    expect(prompt.signal()!.aborted).toBe(true);
    expect(await pending).toBeNull();
  });

  it.each([
    ["cleared", (el: FreshSignIn) => el.clear()],
    ["removed", (el: FreshSignIn) => el.remove()],
  ])("drops the answer of a prompt that answers after it was %s", async (_l, close) => {
    const { el } = await mount(profile({ passkeys: [PASSKEY] }));
    let answer: (credential: PublicKeyCredential) => void = () => undefined;
    vi.mocked(navigator.credentials.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const pending = el.signIn("passkey");
    await vi.waitFor(() => expect(navigator.credentials.get).toHaveBeenCalled());
    close(el);
    answer(passkeyCredential());
    expect(await pending).toBeNull();
  });

  it("leaves the page's other passkey prompts alone when it has none open", async () => {
    const cancel = vi.spyOn(WebAuthnAbortService, "cancelCeremony");
    const { el } = await mount(profile({ passkeys: [PASSKEY] }));
    await el.signIn("passkey");
    const prompt = promptHeldOpen();
    const pending = el.signIn("passkey");
    await vi.waitFor(() => expect(prompt.signal()).toBeDefined());
    el.clear();
    await pending;
    cancel.mockClear();
    el.clear();
    el.remove();
    expect(cancel).not.toHaveBeenCalled();
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

  it.each(["totp.invalid", "totp.required"])(
    "reads the profile again on %s when no code field is shown, and asks for the code under it",
    async (code) => {
      const api = stubApi(profile({ hasTotp: false }));
      const { el, root } = await mount(profile({ hasTotp: false }), api);
      api.getProfile.mockResolvedValue(profile({ hasTotp: true }));
      expect(el.refuse({ code, status: 401 })).toBe("");
      await vi.waitFor(() => expect(field(root, "totp")).not.toBeNull());
      await el.updateComplete;
      expect(api.getProfile).toHaveBeenCalledTimes(2);
      expect(field(root, "totp")!.error).toBe(codeMessage("totp.required"));
      type(root, "current-password", "hunter2-hunter2");
      type(root, "totp", "123456");
      expect(await el.signIn()).toEqual({
        method: "password",
        password: "hunter2-hunter2",
        totp: "123456",
      });
    },
  );

  it("says the code is no longer needed when the second read shows no authenticator either", async () => {
    const api = stubApi(profile({ hasTotp: false }));
    const { el, root } = await mount(profile({ hasTotp: false }), api);
    expect(el.refuse({ code: "totp.invalid", status: 401 })).toBe("");
    await vi.waitFor(() => expect(api.getProfile).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(root.querySelector("[data-error]")?.textContent?.trim()).toBe(
        t("fresh_sign_in.code_no_longer_needed"),
      ),
    );
    expect(field(root, "totp")).toBeNull();
    type(root, "current-password", "hunter2-hunter2");
    await el.updateComplete;
    expect(root.querySelector("[data-error]")).toBeNull();
  });

  it("never sends the password way for a person with no password", async () => {
    const { el, root, api } = await mount(profile({ hasPassword: false, passkeys: [PASSKEY] }));
    expect(field(root, "current-password")).toBeNull();
    expect(await el.signIn("password")).toBeNull();
    expect(api.recoveryPackPasskeyOptions).not.toHaveBeenCalled();
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
    "fresh_sign_in.code_no_longer_needed",
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
