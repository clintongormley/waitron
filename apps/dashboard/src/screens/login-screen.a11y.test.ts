import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./login-screen.js";
import type { LoginScreen } from "./login-screen.js";
import type { DashboardApi } from "../api/client.js";

/**
 * Mounts the screen with an `api` STUB assigned as a property, never from bare markup. The
 * screen's `connectedCallback` fires `void this.#loadRoster()` → `api.getStaffRoster()`; with no
 * `api` that is an unhandled rejection, which pollutes the run (a stray rejection is a finding).
 * So this mirrors `till-lock-screen.a11y.test.ts`: a stub whose `getStaffRoster` resolves a small
 * roster, mounted via `mountWidget`'s property assignment.
 */
function stubApi(): DashboardApi {
  return {
    getStaffRoster: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ada" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
  } as unknown as DashboardApi;
}

/** Settles the in-flight roster fetch and the follow-up render. */
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
