import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./login-screen.js";
import type { LoginScreen } from "./login-screen.js";
import type { DashboardApi } from "../api/client.js";

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthnAutofill: vi.fn().mockResolvedValue(false),
  startAuthentication: vi.fn(() => new Promise(() => undefined)),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));

/**
 * Mounts the screen with an `api` STUB assigned as a property, never from bare markup. The screen
 * fetches only the public Google configuration on connect (email login has no pre-login roster).
 * The language chooser reads `getLocales` when opened. The passkey and account-action methods keep
 * every rendered state free of incidental missing-stub errors. Mounted via `mountWidget`'s property assignment,
 * mirroring `till-lock-screen.a11y.test.ts`.
 */
function stubApi(): DashboardApi {
  return {
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    passkeyAuthOptions: vi
      .fn()
      .mockResolvedValue({ challengeHandle: "h1", options: { challenge: "abc" } }),
    passkeyAuthVerify: vi.fn().mockResolvedValue({ personId: "p1" }),
    inspectAccountAction: vi
      .fn()
      .mockResolvedValue({ email: "new@example.test", purpose: "invitation" }),
    getLocales: vi
      .fn()
      .mockResolvedValue({ locales: [{ code: "en-GB", label: "English" }], venueDefault: "es-ES" }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
  } as unknown as DashboardApi;
}

/** Settles any follow-up render. */
async function flush(el: LoginScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);
afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe.each(["light", "dark"] as const)("login-screen a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { el, host } = await mountWidget<LoginScreen>(
      "dashboard-login-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);

    (el as unknown as { email: string }).email = "owner@example.com";
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=continue]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=try-another-way]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=use-password]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders account setup accessibly", async () => {
    history.replaceState(
      null,
      "",
      "/manage/account?token=token-1&purpose=invitation#email=new%40example.test",
    );
    const { el, host } = await mountWidget<LoginScreen>(
      "dashboard-login-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders factor and reset confirmation accessibly", async () => {
    const { el, host } = await mountWidget<LoginScreen>(
      "dashboard-login-screen",
      { api: stubApi() },
      theme,
    );
    Object.assign(el as unknown as Record<string, string>, {
      email: "owner@example.com",
      password: "correct horse",
      step: "factor",
    });
    await el.updateComplete;
    await expectNoA11yViolations(host);

    Object.assign(el as unknown as Record<string, string>, { step: "reset-sent" });
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders a remembered passkey account accessibly", async () => {
    const saved = JSON.stringify({ email: "owner@example.com", method: "passkey" });
    sessionStorage.setItem("waitron-login-preference", saved);
    localStorage.setItem("waitron-login-preference", saved);
    const { host } = await mountWidget<LoginScreen>(
      "dashboard-login-screen",
      { api: stubApi() },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
