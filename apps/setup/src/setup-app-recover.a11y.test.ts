import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { WtButton } from "@waitron/ui";
import { setLocale } from "./i18n/t.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { initial } from "../test/first-setup-browser.js";
import {
  click,
  namedSummary,
  q,
  stoppedActivity,
  stoppedSummary,
} from "../test/missing-database-browser.js";
import { refusedCause, settled } from "../test/held-database-browser.js";
import { text, wipeFixture } from "../test/wipe-browser.js";
import { cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
  setLocale("en-GB");
});

type Options = NonNullable<Parameters<typeof wipeFixture>[0]>;
const box = { wiped: false };
/** Each state's fixture: picture 2's confirmations, picture 3's refusal and the screen after the restart. */
const fixtures: Record<string, () => Options> = {
  "recover-confirmation": () => ({ summary: () => Response.json(namedSummary) }),
  "recover-missing": () => ({ inspection: { database: "missing" } }),
  "recover-stopped-present": () => ({
    activity: stoppedActivity,
    summary: () => Response.json(stoppedSummary),
  }),
  "recover-stopped-missing": () => ({
    inspection: { database: "missing" },
    backupPhase: "prepared",
    activity: stoppedActivity,
    summary: () => Response.json(stoppedSummary),
  }),
  "refused-fault": () => ({ summary: () => refusedCause("kept-records") }),
  "join-or-recover": () => ({
    startAgain: () => {
      box.wiped = true;
      return Response.json({ restarting: true });
    },
    status: () => (box.wiped ? Response.json({ claimed: false }) : undefined),
  }),
};
const states = Object.keys(fixtures);

for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const state of states)
        it(`${locale} ${theme} ${width} ${state}: accessible Recover from backup`, async () => {
          const previous = [innerWidth, innerHeight];
          box.wiped = false;
          try {
            await page.viewport(width, 1200);
            const { app, host } = await wipeFixture({ ...fixtures[state]!(), locale, theme });
            await click(app, "recover-backup");
            let section = q<HTMLElement>(app, "screen-first-owner")!;
            let focusable: WtButton;
            if (state === "refused-fault") {
              await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
              await settled(app);
              focusable = q<WtButton>(app, "reconnect-first")!;
            } else {
              await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
              await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
              focusable = q<WtButton>(app, "confirm-recover")!;
              await expect.poll(() => focusable.disabled).toBe(false);
              if (state === "join-or-recover") {
                await click(app, "confirm-recover");
                const restarting = initialOwnerStrings[locale === "es-ES" ? "es" : "en"].restarting;
                await expect.poll(() => text(app)).toContain(restarting);
                await click(app, "reconnect-first");
                await expect.poll(() => q(app, "screen-role")).not.toBeNull();
                const role = q<LitElement>(app, "screen-role")!;
                await role.updateComplete;
                section = role;
                focusable = role.shadowRoot!.querySelector<WtButton>("[data-test=choose-restore]")!;
              }
            }
            await app.updateComplete;
            await expectNoA11yViolations(host);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            expect(section.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            if (import.meta.env.VITE_A1131BC_RECOVER_LOOK === "1")
              await page.screenshot({
                path: `__screenshots__/a1131bc-recover/${locale}-${theme}-${width}-${state}.png`,
              });
            expect(focusable.disabled).toBe(false);
            const native = focusable.shadowRoot!.querySelector("button")!;
            native.focus();
            expect(focusable.shadowRoot!.activeElement).toBe(native);
            expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });
