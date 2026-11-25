import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./profile-screen.js";
import type { ProfileScreen } from "./profile-screen.js";
import type { DashboardApi } from "../api/client.js";
import type { OwnProfile } from "../api/account-api.js";
import { codeMessage } from "../i18n/codes.js";

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
      for (const action of ["remove-passkey", "change-password"]) {
        el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
        await el.updateComplete;
        await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
        expect(el.shadowRoot!.querySelector("wt-input[name=currentPassword]")).toBeNull();
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/look/a1437-${locale}-${theme}-${width}-${action}.png`,
        });
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
        await expect.poll(() => el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
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

  it("the edit dialog, with Save quiet and then ready", async () => {
    const { el, host } = await mountWidget<ProfileScreen>(
      "dashboard-profile-screen",
      { api: stubApi() },
      theme,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    el.editDetails();
    await el.updateComplete;
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
    await save.updateComplete;
    expect([save.variant, save.disabled]).toEqual(["secondary", true]);
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector("wt-input[name=telephone]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "+34 600 000 001" } }),
    );
    await el.updateComplete;
    await save.updateComplete;
    expect([save.variant, save.disabled]).toEqual(["primary", false]);
    await expectNoA11yViolations(host);
  });

  async function mountSecurity(
    overrides: Record<string, unknown>,
    profile: Partial<OwnProfile> = {},
  ) {
    const api = Object.assign(stubApi(), overrides);
    vi.mocked(api.getProfile).mockResolvedValue({ ...(await api.getProfile()), ...profile });
    const { el, host } = await mountWidget<ProfileScreen>(
      "dashboard-profile-screen",
      { api },
      theme,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    el.shadowRoot!.querySelector("wt-tabs")!
      .shadowRoot!.querySelector<HTMLButtonElement>("[data-key=security]")!
      .click();
    await el.updateComplete;
    const press = (action: string) =>
      el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    return { el, host, press, modal };
  }

  it("a refused Add passkey, with the reason under its row", async () => {
    const { el, host, press } = await mountSecurity({
      passkeyRegisterOptions: vi.fn().mockRejectedValue({ code: "passkey.challenge_expired" }),
    });
    press("add-passkey");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=start-error-passkey]")?.textContent)
      .toContain(codeMessage("passkey.challenge_expired"));
    await expectNoA11yViolations(host);
  });

  it("the authenticator's code to scan, opened by Set up", async () => {
    const { el, host, press, modal } = await mountSecurity({
      beginTotp: vi.fn().mockResolvedValue({
        enrollmentId: "setup",
        secret: "SECRET",
        uri: "otpauth://totp/Waitron:test",
        expiresAt: "2026-10-07T00:00:00Z",
      }),
    });
    press("setup-authenticator");
    await expect.poll(() => modal.open).toBe(true);
    await modal.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=authenticator-qr]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("the code window Add passkey opens on an account with an authenticator", async () => {
    const { el, host, press, modal } = await mountSecurity({}, { hasTotp: true });
    press("add-passkey");
    await expect.poll(() => modal.open).toBe(true);
    await modal.updateComplete;
    expect(el.shadowRoot!.querySelector("wt-input[name=totp]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
