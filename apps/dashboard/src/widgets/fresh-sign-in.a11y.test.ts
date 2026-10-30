import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, OwnProfile } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { FreshSignIn } from "./fresh-sign-in.js";
import "./fresh-sign-in.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const PASSKEY = { id: "pk1", name: null, createdAt: "", lastUsedAt: null, provider: null };

function profile(overrides: Partial<OwnProfile>): OwnProfile {
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

const STATES: Record<string, { own: Partial<OwnProfile> | "failed"; refusal?: string }> = {
  password: { own: {} },
  "password and code": { own: { hasTotp: true, passkeys: [PASSKEY] } },
  "passkey only": { own: { hasPassword: false, passkeys: [PASSKEY] } },
  "passkey and code": { own: { hasPassword: false, hasTotp: true, passkeys: [PASSKEY] } },
  "no way in": { own: { hasPassword: false, passkeys: [] } },
  "refused password": { own: { hasTotp: true }, refusal: "password.invalid" },
  "refused code": { own: { hasTotp: true }, refusal: "totp.invalid" },
  "code no longer needed": { own: {}, refusal: "totp.invalid" },
  "profile unreadable": { own: "failed" },
};

describe.each(["light", "dark"] as const)("fresh sign-in accessibility (%s)", (theme) => {
  it.each(
    Object.keys(STATES).flatMap((state) => [
      { state, locale: "en-GB" },
      { state, locale: "es-ES" },
    ]),
  )("draws $state in $locale", async ({ state, locale }) => {
    setLocale(locale);
    const { own, refusal } = STATES[state]!;
    const api = {
      getProfile:
        own === "failed"
          ? vi.fn().mockRejectedValue({ code: "connection.failed" })
          : vi.fn().mockResolvedValue(profile(own)),
      recoveryPackPasskeyOptions: vi.fn(),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<FreshSignIn>("dashboard-fresh-sign-in", { api }, theme);
    const root = el.shadowRoot!;
    await expect
      .poll(() =>
        root.querySelector(
          "[data-test=use-passkey], [data-test=no-way-in], [data-test=profile-failed]",
        ),
      )
      .toBeTruthy();
    if (refusal !== undefined) el.refuse({ code: refusal, status: 401 });
    if (state === "code no longer needed") await expect.poll(() => el.notice).toBeTruthy();
    await el.updateComplete;
    for (const input of root.querySelectorAll("wt-input")) await input.updateComplete;
    await expectNoA11yViolations(host);
  });
});
