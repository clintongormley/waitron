import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./profile-screen.js";
import type { ProfileScreen } from "./profile-screen.js";
import type { DashboardApi } from "../api/client.js";

function stubApi(): DashboardApi {
  return {
    getProfile: vi.fn().mockResolvedValue({
      displayName: "Alex",
      firstNames: "Alex",
      lastNames: "Rivera",
      telephone: "+34 600 000 000",
      email: "alex@example.com",
      locale: "en-GB",
      hasPassword: true,
      hasTotp: false,
      hasGoogle: false,
      passkeys: [{ id: "credential", createdAt: "2026-09-09T12:00:00Z" }],
    }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [{ code: "en-GB", label: "English" }],
      venueDefault: "en-GB",
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
  } as unknown as DashboardApi;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("profile-screen a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { el, host } = await mountWidget<ProfileScreen>(
      "dashboard-profile-screen",
      { api: stubApi() },
      theme,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
