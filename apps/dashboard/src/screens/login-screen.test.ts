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
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    passkeyAuthOptions: vi
      .fn()
      .mockResolvedValue({ challengeHandle: "h1", options: { challenge: "abc" } }),
    passkeyAuthVerify: vi.fn().mockResolvedValue({ personId: "p9" }),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Lets the pending `getStaffRoster`/`login` promise settle and the element re-render. */
async function flush(el: LoginScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

describe("login-screen", () => {
  it("loads the roster and logs in the picked person", async () => {
    const api = stubApi();
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await flush(el);
    const loggedIn = new Promise<{ personId: string }>((resolve) =>
      el.addEventListener("logged-in", (e) => resolve((e as CustomEvent).detail)),
    );
    // select person p1, type password, submit
    (el as unknown as { selected: string }).selected = "p1";
    (el as unknown as { password: string }).password = "correct horse";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    expect((await loggedIn).personId).toBe("p1");
    expect(api.login).toHaveBeenCalledWith({
      personId: "p1",
      password: "correct horse",
      totp: undefined,
    });
  });

  it("shows an error key when login is rejected", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({ code: "password.invalid" }) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    (el as unknown as { selected: string }).selected = "p1";
    (el as unknown as { password: string }).password = "wrong";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("password.invalid");
  });

  // Drives the three field handlers through the DOM (the two tests above assign state directly, so
  // they never fire `@change`/`@wt-change`), and — by typing a code — exercises the non-empty TOTP
  // branch that passes `totp` through instead of `undefined`.
  it("reads the person, password and TOTP from the fields", async () => {
    const api = stubApi({
      getStaffRoster: vi.fn().mockResolvedValue([
        { personId: "p1", displayName: "Ada" },
        { personId: "p2", displayName: "Ben" },
      ]),
    });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await flush(el);

    const select = el.shadowRoot!.querySelector("select")!;
    select.value = "p2";
    select.dispatchEvent(new Event("change"));
    const [password, totp] = el.shadowRoot!.querySelectorAll("wt-input");
    password.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "hunter2" } }));
    totp.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "123456" } }));
    await el.updateComplete;

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await new Promise((r) => setTimeout(r));
    expect(api.login).toHaveBeenCalledWith({
      personId: "p2",
      password: "hunter2",
      totp: "123456",
    });
  });

  // The guard on `#loadRoster`: a rejected roster fetch must become the error banner, never an
  // unhandled promise rejection (the whole suite runs with pristine output, which pins that). Also
  // covers the `.code` path of `#loadRoster`'s catch.
  it("shows an error key when the roster fetch is rejected (and never rejects)", async () => {
    const api = stubApi({ getStaffRoster: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
    // The banner renders LOCALISED copy, never the raw wire code (the state above stays the raw code).
    const banner = el.shadowRoot!.querySelector("[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
  });

  it("falls back to server.internal when a rejected roster fetch carries no code", async () => {
    const api = stubApi({ getStaffRoster: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("selects nothing when the roster is empty", async () => {
    const api = stubApi({ getStaffRoster: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    await flush(el);
    expect((el as unknown as { selected: string }).selected).toBe("");
  });

  // The roster picker must DISPLAY `selected` even when it is not the first option. Today `#loadRoster`
  // always selects roster[0] (the first option), so a `.value` bound in the template renders right by
  // luck; this drives a NON-first selection through the fresh options-creating render (the []→populated
  // transition #loadRoster performs) to prove the live <select> value tracks `selected` regardless of
  // option order — the case a future initial-selection policy could produce. The stub roster fetch
  // never resolves, so `#loadRoster` cannot overwrite the injected state. Reconciling `.value` in
  // `updated()` (after the options render) is the fix, mirroring the edit dialog. Prove-by-deletion:
  // remove the `updated()` reconcile and the picker falls back to the first roster entry (p1).
  it("keeps the roster picker on the selected person even when it is not the first option", async () => {
    const api = stubApi({ getStaffRoster: vi.fn(() => new Promise<never>(() => {})) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete; // first render: empty roster, no <option>s yet
    // Simulate a roster load that selects a non-first entry, in one render so the <option>s are
    // created fresh with `selected` already pointing past the first — the ordering the bug hinges on.
    Object.assign(el as unknown as { roster: unknown; selected: string }, {
      roster: [
        { personId: "p1", displayName: "Ada" },
        { personId: "p2", displayName: "Ben" },
        { personId: "p3", displayName: "Cid" },
      ],
      selected: "p3",
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("select")!.value).toBe("p3");
  });

  it("falls back to server.internal when the rejection carries no code", async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<LoginScreen>("dashboard-login-screen", { api });
    await el.updateComplete;
    (el as unknown as { selected: string }).selected = "p1";
    (el as unknown as { password: string }).password = "wrong";
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=submit]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
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
