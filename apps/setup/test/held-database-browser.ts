import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import "../src/setup-app.js";
import type { SetupApp } from "../src/setup-app.js";
import type { FirstSetupInspection, StartAgainSummary } from "../src/api/first-setup-types.js";
import { initial, venue, wizardApi } from "./first-setup-browser.js";
import { click, q, stoppedActivity, stoppedSummary } from "./missing-database-browser.js";
import { mountWidget } from "../src/widgets/test-helpers.js";

export const tradingEnv = {
  name: "trading.env",
  status: "present",
  digest: "c".repeat(64),
} as const;
export const heldSummary = (held: NonNullable<StartAgainSummary["held"]>): StartAgainSummary => ({
  ...stoppedSummary,
  held,
});
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
  let generation = 1;
  let inspections = 0;
  const fixture = wizardApi({
    claimed: true,
    intercept(path, body) {
      if (path.endsWith("/backup/activity")) return Response.json({ activity: stoppedActivity });
      if (path.endsWith("/start-again/summary"))
        return (
          options.summary?.() ??
          Response.json(heldSummary({ rows: 105, kept: 0, records: 0, accepted: 0 }))
        );
      if (path.endsWith("/resolution/start-again"))
        return options.startAgain?.() ?? Response.json({ restarting: true });
      if (path.endsWith("/resolution/recover")) {
        if ((body as { password: string }).password !== venue.admin.password)
          return Response.json(
            { error: { code: "setup.owner_required", params: {} } },
            { status: 403 },
          );
        generation += 1;
        return Response.json({
          state: { ...initial, revision: generation, ownerGeneration: generation },
          capability: "B".repeat(43),
          ownerGeneration: generation,
        });
      }
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
          ...options.inspection?.(inspections++),
          revision: generation,
          ownerGeneration: generation,
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
/** Start again, then the setup password and Continue. */
export async function heldPasswordAccepted(app: SetupApp) {
  await click(app, "start-again");
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  await userEvent.fill(
    q<WtInput>(app, "resume-password")!.shadowRoot!.querySelector("input")!,
    venue.admin.password,
  );
  await click(app, "damaged-record-continue");
}
/**
 * After a refusal the page shows its reason and a disabled Start again while it is still re-reading
 * the box. Reconnect is always drawn and disabled only while the page is busy, so its enabling marks
 * the reads done.
 */
export const settled = (app: SetupApp) =>
  expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
