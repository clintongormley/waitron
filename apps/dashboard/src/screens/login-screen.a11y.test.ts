import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./login-screen.js";
import type { LoginScreen } from "./login-screen.js";
import type { DashboardApi } from "../api/client.js";

/**
 * Mounts the screen with an `api` STUB assigned as a property, never from bare markup. The screen
 * fetches nothing on connect (email login has no pre-login roster), but the language chooser reads
 * `getLocales` when opened and the passkey button would call `passkeyAuthOptions`, so the stub
 * carries the whole surface the screen may touch. Mounted via `mountWidget`'s property assignment,
 * mirroring `till-lock-screen.a11y.test.ts`.
 */
function stubApi(): DashboardApi {
  return {
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    getLocales: vi
      .fn()
      .mockResolvedValue({ locales: [{ code: "en-GB", label: "English" }], venueDefault: "es-ES" }),
  } as unknown as DashboardApi;
}

/** Settles any follow-up render. */
async function flush(el: LoginScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("login-screen a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { el, host } = await mountWidget<LoginScreen>(
      "dashboard-login-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
