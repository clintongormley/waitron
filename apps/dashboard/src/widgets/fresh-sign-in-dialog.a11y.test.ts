import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { FreshSignIn } from "./fresh-sign-in.js";
import type { FreshSignInDialog } from "./fresh-sign-in-dialog.js";
import "./fresh-sign-in-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en-GB", "es-ES"]) {
    it(`the shared confirmation is accessible in ${theme}, ${locale}`, async () => {
      setLocale(locale);
      const { el, host } = await mountWidget<FreshSignInDialog>(
        "dashboard-fresh-sign-in-dialog",
        {
          api: {
            getProfile: async () => ({
              displayName: "Marta",
              firstNames: "Marta",
              lastNames: "",
              telephone: null,
              email: "marta@example.test",
              pendingEmail: null,
              locale: null,
              hasPassword: true,
              hasTotp: true,
              hasGoogle: false,
              passkeys: [],
            }),
            confirmFreshSignIn: vi.fn(),
            recoveryPackPasskeyOptions: vi.fn(),
          } as unknown as DashboardApi,
        },
        theme,
      );
      void el.show(new AbortController().signal);
      await el.updateComplete;
      const signIn = el.shadowRoot!.querySelector<FreshSignIn>("dashboard-fresh-sign-in")!;
      await expect.poll(() => signIn.ways).not.toBeNull();
      await el.updateComplete;
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-proof]")!.click();
      await expect.poll(() => signIn.invalid).toBe(true);
      await el.updateComplete;
      await expectNoA11yViolations(host);
    });
  }
