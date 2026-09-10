import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuthentication } from "@simplewebauthn/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import { LoginScreen } from "./login-screen.js";

// The real `startAuthentication` drives `navigator.credentials.get`, which needs a physical
// authenticator and cannot run headless. Mock the whole module: `startAuthentication` resolves the
// assertion the verify step echoes back, so the screen's chain runs end to end under test.
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn().mockResolvedValue({ id: "cred-abc" }),
  startRegistration: vi.fn().mockResolvedValue({ id: "cred-abc" }),
}));

afterEach(cleanupWidgets);
// Shared across tests (the module mock is file-scoped), so clear its call log between them.
afterEach(() => vi.mocked(startAuthentication).mockClear());
afterEach(() => vi.useRealTimers());

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    // Retained on the stub so the "does not fetch the roster on connect" test can prove the screen
    // never calls it — the screen itself no longer has a roster picker.
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    requestPasswordReset: vi.fn().mockResolvedValue(undefined),
    completeAccountAction: vi.fn().mockResolvedValue({ personId: "p1", authenticated: true }),
    passkeyAuthOptions: vi
      .fn()
      .mockResolvedValue({ challengeHandle: "h1", options: { challenge: "abc" } }),
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

async function openOtherWays(el: LoginScreen, email = "owner@x.com"): Promise<void> {
  await continueWithEmail(el, email);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=try-another-way]")!.click();
  await el.updateComplete;
}

async function openPassword(el: LoginScreen, email = "owner@x.com"): Promise<void> {
  await openOtherWays(el, email);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=use-password]")!.click();
  await el.updateComplete;
}

describe("login-screen", () => {
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
    expect(await loggedIn).toEqual({ personId: "p1", accountSetup: false });
    expect(api.login).toHaveBeenCalledWith({
      email: "owner@x.com",
      password: "correct horse",
    });
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
    (el as unknown as { password: string }).password = "a replacement password";
    (el as unknown as { confirmPassword: string }).confirmPassword = "a replacement password";
    const events: Event[] = [];
    el.addEventListener("logged-in", (event) => events.push(event));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!.click();
    await flush(el);
    expect(events).toHaveLength(0);
    expect(el.shadowRoot!.textContent).toContain(codeMessage("password.reset_complete"));
    expect(el.shadowRoot!.querySelector("wt-input[name=email]")).not.toBeNull();
  });

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

  it("asks for email first, then offers passkey before password for every account", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=submit]")).toBeNull();
    await continueWithEmail(el);
    expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(0);
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=try-another-way]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=submit]")).toBeNull();
    expect(api.login).not.toHaveBeenCalled();
  });

  it("identifies the account above the password field", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    await openPassword(el, "bea@x.com");

    expect(el.shadowRoot!.querySelector("[data-test=login-context]")?.textContent?.trim()).toBe(
      `${t("login.logging_in_as")} bea@x.com`,
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
      autocomplete: "username",
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

  it("places the step's primary action at the right and Cancel at the left", async () => {
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api: stubApi() });
    let actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    expect(actions.querySelector("wt-button:not([slot])")?.getAttribute("data-test")).toBe(
      "continue",
    );
    expect(actions).not.toBeNull();
    await continueWithEmail(el);
    actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    expect(actions.querySelector('[slot="cancel"]')?.getAttribute("data-test")).toBe("back");
    expect(actions.querySelector('[slot="cancel"]')?.textContent?.trim()).toBe(t("action.cancel"));
    expect(actions.querySelector("wt-button:not([slot])")?.getAttribute("data-test")).toBe(
      "passkey-login",
    );
    expect(actions.nextElementSibling?.getAttribute("data-test")).toBe("try-another-way");

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=try-another-way]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=use-password]")!.click();
    await el.updateComplete;
    actions = el.shadowRoot!.querySelector("wt-form-actions")!;
    expect(actions.querySelector('[slot="cancel"]')?.getAttribute("data-test")).toBe("back");
    expect(actions.querySelector('[slot="cancel"]')?.textContent?.trim()).toBe(t("action.cancel"));
    expect(actions.querySelector("wt-button:not([slot])")?.getAttribute("data-test")).toBe(
      "submit",
    );
    expect(actions.nextElementSibling?.getAttribute("data-test")).toBe("try-another-way");
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
      { name: "confirm-password", autocomplete: "new-password", required: true },
      { name: "new-pin", autocomplete: "off", required: true },
      { name: "confirm-pin", autocomplete: "off", required: true },
    ]);

    for (const field of fields) {
      const toggle = field.querySelector<HTMLElement>("wt-button[slot=end]");
      expect(toggle?.ariaLabel).toBe(t("login.show_password"));
    }

    const passwordField = fields[0]!;
    const confirmPasswordField = fields[1]!;
    passwordField.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "secret words" } }),
    );
    passwordField.querySelector<HTMLElement>("wt-button[slot=end]")!.click();
    await el.updateComplete;
    expect(passwordField.shadowRoot!.querySelector<HTMLInputElement>("input")!.type).toBe("text");
    expect(passwordField.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe(
      "secret words",
    );
    expect(confirmPasswordField.shadowRoot!.querySelector<HTMLInputElement>("input")!.type).toBe(
      "password",
    );
    expect(passwordField.querySelector<HTMLElement>("wt-button[slot=end]")!.ariaLabel).toBe(
      t("login.hide_password"),
    );

    const username = el.shadowRoot!.querySelector<HTMLInputElement>("[data-autofill-username]")!;
    expect(username.name).toBe("email");
    expect(username.autocomplete).toBe("username");
    expect(username.value).toBe("new@example.test");
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=try-another-way]")!.click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=use-password]")!.click();
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

      el.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
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
    await openOtherWays(el, "bea@x.com");

    expect(el.shadowRoot!.querySelector("[data-test=forgot-password]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=passkey-login]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=use-password]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reset-by-email]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=back-to-passkey]")).not.toBeNull();
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
    await openOtherWays(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=google-login]")!.click();
    await flush(el);
    expect(api.beginGoogleLogin).toHaveBeenCalledWith();
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.test/login");
  });

  it("shows a separate email confirmation and allows resending only after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await openOtherWays(el, "bea@x.com");
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-reset]")!.click();
    await el.updateComplete;
    await openOtherWays(el, "bea@x.com");
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
    await openOtherWays(el);
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

  it("completes a token link with matching passwords and logs in", async () => {
    const api = stubApi();
    history.replaceState(
      null,
      "",
      "/manage/account?token=token-1&purpose=invitation#email=new%40example.test",
    );
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    (el as unknown as { password: string }).password = "a replacement password";
    (el as unknown as { confirmPassword: string }).confirmPassword = "a replacement password";
    (el as unknown as { pin: string }).pin = "4321";
    (el as unknown as { confirmPin: string }).confirmPin = "4321";
    await el.updateComplete;
    const loggedIn = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("logged-in", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=complete-account]")!.click();
    expect(await loggedIn).toEqual({ personId: "p1", accountSetup: true });
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

  // Passkey login: options → startAuthentication(the browser ceremony, mocked) → verify → logged-in.
  it("runs the passkey ceremony and logs in the returned person", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await continueWithEmail(el);
    const loggedIn = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("logged-in", (e) => resolve((e as CustomEvent).detail)),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=passkey-login]")!.click();
    expect((await loggedIn).personId).toBe("p9");
    // v13 wraps the server's options blob under `optionsJSON` — NOT the bare options object.
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: "abc" } });
    // The handle from options is echoed back with the assertion startAuthentication returned.
    expect(api.passkeyAuthVerify).toHaveBeenCalledWith({
      challengeHandle: "h1",
      response: { id: "cred-abc" },
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
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=try-another-way]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=use-password]")!.click();
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
