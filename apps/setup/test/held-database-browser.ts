import { expect } from "vitest";
import type { WtButton } from "@waitron/ui";
import "../src/setup-app.js";
import type { SetupApp } from "../src/setup-app.js";
import type { FirstSetupInspection } from "../src/api/first-setup-types.js";
import { wizardApi } from "./first-setup-browser.js";
import { q, stoppedActivity, stoppedSummary } from "./missing-database-browser.js";
import { mountWidget } from "../src/widgets/test-helpers.js";

export const tradingEnv = {
  name: "trading.env",
  status: "present",
  digest: "c".repeat(64),
} as const;
export const refusedCause = (cause: string) =>
  Response.json(
    { error: { code: "setup.start_again_refused", params: { cause } } },
    { status: 409 },
  );
/** A setup database holding records beside a stopped recovery, drawn signed out. */
export async function heldFixture(
  options: {
    /** Merged into every inspection read, counted from 0. */
    inspection?: (read: number) => Partial<FirstSetupInspection>;
    summary?: () => Response;
    startAgain?: () => Response;
    locale?: string;
    theme?: "light" | "dark";
  } = {},
) {
  let inspections = 0;
  const fixture = wizardApi({
    claimed: true,
    intercept(path) {
      if (path.endsWith("/backup/activity")) return Response.json({ activity: stoppedActivity });
      if (path.endsWith("/start-again/summary"))
        return options.summary?.() ?? Response.json(stoppedSummary);
      if (path.endsWith("/resolution/start-again"))
        return options.startAgain?.() ?? Response.json({ restarting: true });
      if (path.endsWith("/resolution"))
        return Response.json({
          version: 2,
          inspectionId: "a".repeat(64),
          pair: "valid",
          database: "occupied",
          emptyDatabase: false,
          password: "checkable",
          repairEligible: false,
          artifacts: [],
          revision: 1,
          ownerGeneration: 1,
          ...options.inspection?.(inspections++),
        } satisfies FirstSetupInspection);
    },
  });
  const { el: app, host } = await mountWidget<SetupApp>(
    "setup-app",
    { api: fixture.api, browserLanguages: [options.locale ?? "en-GB"] },
    options.theme,
  );
  await expect.poll(() => q(app, "recovery-stopped")).not.toBeNull();
  await app.updateComplete;
  return { app, host, ...fixture };
}
/**
 * After a refusal the page shows its reason and a disabled Start again while it is still re-reading
 * the box. Reconnect is always drawn and disabled only while the page is busy, so its enabling marks
 * the reads done.
 */
export const settled = (app: SetupApp) =>
  expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
