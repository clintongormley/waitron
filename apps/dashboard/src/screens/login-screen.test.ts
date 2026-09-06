import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAuthentication } from "@simplewebauthn/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
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

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    // Retained on the stub so the "does not fetch the roster on connect" test can prove the screen
    // never calls it — the screen itself no longer has a roster picker.
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    passkeyAuthOptions: vi
      .fn()
      .mockResolvedValue({ challengeHandle: "h1", options: { challenge: "abc" } }),
    passkeyAuthVerify: vi.fn().mockResolvedValue({ personId: "p9" }),
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

describe("login-screen", () => {
  it("submits the typed email + password", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    const loggedIn = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("logged-in", (e) => resolve((e as CustomEvent).detail)),
    );
    (el as unknown as { email: string }).email = "owner@x.com";
    (el as unknown as { password: string }).password = "correct horse";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    expect((await loggedIn).personId).toBe("p1");
    expect(api.login).toHaveBeenCalledWith({
      email: "owner@x.com",
      password: "correct horse",
      totp: undefined,
    });
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
    (el as unknown as { email: string }).email = "owner@x.com";
    (el as unknown as { password: string }).password = "wrong";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("password.invalid");
    // The banner renders LOCALISED copy, never the raw wire code (the state above stays the raw code).
    const banner = el.shadowRoot!.querySelector("[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("password.invalid", "es-ES"));
    expect(banner).not.toContain("password.invalid");
  });

  // Drives the field handlers through the DOM (the tests above assign state directly, so they never
  // fire `@wt-change`), and — by typing a code — exercises the non-empty TOTP branch that passes
  // `totp` through instead of `undefined`.
  it("reads the email, password and TOTP from the fields", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;

    const [email, password, totp] = el.shadowRoot!.querySelectorAll("wt-input");
    email.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "owner@x.com" } }));
    password.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "hunter2" } }));
    totp.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "123456" } }));
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await new Promise((r) => setTimeout(r));
    expect(api.login).toHaveBeenCalledWith({
      email: "owner@x.com",
      password: "hunter2",
      totp: "123456",
    });
  });

  it("falls back to server.internal when the rejection carries no code", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    (el as unknown as { email: string }).email = "owner@x.com";
    (el as unknown as { password: string }).password = "wrong";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
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
    await el.updateComplete;
    await flush(el);
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
    await el.updateComplete;
    await flush(el);
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
    await el.updateComplete;
    await flush(el);
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
  const inputs = [...el.shadowRoot!.querySelectorAll("wt-input")];
  for (const [i, value] of ["owner@example.com", "secret", "123456"].entries()) {
    await inputs[i].updateComplete;
    const input = inputs[i].shadowRoot!.querySelector("input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  await el.updateComplete;
  const input = inputs[1].shadowRoot!.querySelector("input")!;
  input.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  input.focus();
  await userEvent.keyboard("{Enter}");
  expect(login).toHaveBeenCalledExactlyOnceWith({
    email: "owner@example.com",
    password: "secret",
    totp: "123456",
  });
  resolve({ personId: "p1" });
  await flush(el);
});
