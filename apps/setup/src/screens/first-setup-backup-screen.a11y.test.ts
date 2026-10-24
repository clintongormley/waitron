import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { FirstSetupBackupScreen } from "./first-setup-backup-screen.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import {
  repairApi,
  inspection,
  saved,
  bucketProof,
  click,
  q,
  recoveryEntry,
  moduleAnswer,
} from "../../test/first-setup-backup-browser.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
for (const locale of ["en-GB", "es-ES"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280])
      for (const state of ["source", "refused", "authenticated", "wait", "restarting"] as const)
        it(`${locale} ${theme} ${width} ${state}: accessible backup repair`, async () => {
          const previous = [innerWidth, innerHeight];
          try {
            await page.viewport(width, 1200);
            setLocale(locale);
            const { api } = repairApi((action, body) => {
              if (state === "refused" && action === "open")
                return Response.json(
                  { error: { code: "promotion.break_glass_invalid", params: {} } },
                  { status: 422 },
                );
              if (state === "restarting" && action === "status")
                return Response.json({
                  phase: "restored",
                  recoveryId: saved.recoveryId,
                  proofRequired: true,
                });
              if (action === "resume")
                return Response.json({ ...saved, input: { selected: "saved" } });
              if (action === "prepare") return moduleAnswer(body, true);
            });
            const { el, host } = await mountWidget<FirstSetupBackupScreen>(
              "setup-first-backup",
              { api, inspection },
              theme,
            );
            await expect.poll(() => q<WtButton>(el, "prove")?.disabled).toBe(false);
            if (state !== "source") {
              await bucketProof(el);
              await click(el, state === "restarting" ? "resume" : "prove");
              if (state === "refused")
                await expect.poll(() => q<WtButton>(el, "prove").disabled).toBe(false);
              else await expect.poll(() => q(el, "review")).not.toBeNull();
            }
            if (state === "wait") {
              const entry = await recoveryEntry(el);
              await click(entry, "compare");
              await expect.poll(() => q(entry, "hour-wait")).not.toBeNull();
            }
            if (state === "restarting") {
              await click(el, "commit");
              await expect.poll(() => q(el, "restarting")).not.toBeNull();
            }
            await expectNoA11yViolations(host);
            expect(innerWidth).toBe(width);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            if (import.meta.env.VITE_A731_LOOK === "1")
              await page.screenshot({
                path: `__screenshots__/a731/${locale}-${theme}-${width}-${state}.png`,
              });
          } finally {
            await page.viewport(previous[0]!, previous[1]!);
          }
        });
