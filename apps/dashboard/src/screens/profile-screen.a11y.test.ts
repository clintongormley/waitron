import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
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
      passkeys: [
        {
          id: "credential",
          name: null,
          createdAt: "2026-09-09T12:00:00Z",
          lastUsedAt: "2026-09-28T08:30:00Z",
          provider: "Google Password Manager",
        },
        {
          id: "spare",
          name: "Spare key",
          createdAt: "2026-09-10T12:00:00Z",
          lastUsedAt: null,
          provider: null,
        },
      ],
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
  it.each([
    ["en-GB", 390],
    ["en-GB", 1280],
    ["es-ES", 390],
    ["es-ES", 1280],
  ] as const)("hovered card actions are accessible in %s at %i px", async (locale, width) => {
    const previous = currentLocale();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setLocale(locale);
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const api = stubApi();
      const profile = await api.getProfile();
      vi.mocked(api.getProfile).mockResolvedValue({ ...profile, pendingEmail: "next@example.com" });
      const { el, host } = await mountWidget<ProfileScreen>(
        "dashboard-profile-screen",
        { api },
        theme,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-test=confirm-email]")).not.toBeNull();
      const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
      for (const tab of ["details", "security"]) {
        tabs.shadowRoot!.querySelector<HTMLButtonElement>(`[data-key=${tab}]`)!.click();
        await el.updateComplete;
        await (tabs as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
        const actions = el.shadowRoot!.querySelectorAll(`[slot=${tab}] .card-action`);
        expect(actions.length).toBeGreaterThan(0);
        for (const action of actions) {
          const inner = action.shadowRoot!.querySelector("button")!;
          await userEvent.hover(inner);
          expect(inner.matches(":hover")).toBe(true);
          await expectNoA11yViolations(host);
        }
        await page.screenshot({
          element: host,
          path: `__screenshots__/look/a319-profile-${locale}-${theme}-${width}-${tab}.png`,
        });
      }
    } finally {
      setLocale(previous);
      await page.viewport(viewport.width, viewport.height);
    }
  });

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
