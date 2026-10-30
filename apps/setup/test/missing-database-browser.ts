import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import "../src/setup-app.js";
import type { SetupApp } from "../src/setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "../src/first-setup-session.js";
import type {
  BackupRepairActivity,
  BackupRepairStatus,
  FirstSetupInspection,
  FirstSetupState,
  StartAgainRecoveryShown,
  StartAgainSummary,
} from "../src/api/first-setup-types.js";
import { initialOwnerStrings } from "../src/screens/initial-owner-strings.js";
import { initial, venue, wizardApi } from "./first-setup-browser.js";
import { mountWidget } from "../src/widgets/test-helpers.js";

export const q = <T extends Element>(app: SetupApp, name: string) =>
  app.shadowRoot!.querySelector<T>(`[data-test=${name}]`);
export async function click(app: SetupApp, name: string) {
  await userEvent.click(q<WtButton>(app, name)!.shadowRoot!.querySelector("button")!);
}
export const namedSummary: StartAgainSummary = { reached: "named" };
export const damagedSummary: StartAgainSummary = { ...namedSummary, recoveryRecordDamaged: true };
/** 25 Oct 2026 at 14:35 and 14:41 in the browser's own zone, so the shown times are fixed. */
export const recoveryStartedAt = new Date(2026, 9, 25, 14, 35).toISOString();
export const recoveryLastActiveAt = new Date(2026, 9, 25, 14, 41).toISOString();
export const shownTimes = {
  en: { started: "25 Oct 2026, 14:35", last: "25 Oct 2026, 14:41" },
  es: { started: "25 oct 2026, 14:35", last: "25 oct 2026, 14:41" },
} as const;
export const runningActivity: BackupRepairActivity = {
  state: "running",
  startedAt: recoveryStartedAt,
  lastActiveAt: recoveryLastActiveAt,
};
export const stoppedActivity: Extract<BackupRepairActivity, { state: "stopped" }> = {
  state: "stopped",
  startedAt: recoveryStartedAt,
  lastActiveSource: "memory",
  lastActiveAt: recoveryLastActiveAt,
  phase: "prepared",
  recoveryId: "r".repeat(32),
  failed: false,
  cloud: false,
};
export const stoppedRecovery: StartAgainRecoveryShown = {
  startedAt: recoveryStartedAt,
  lastActiveAt: recoveryLastActiveAt,
  lastActiveSource: "memory",
  failed: false,
  cloud: false,
};
export const stoppedSummary: StartAgainSummary = { ...namedSummary, recovery: stoppedRecovery };
export async function missingDatabaseFixture(
  options: {
    intercept?: NonNullable<Parameters<typeof wizardApi>[0]>["intercept"];
    recoveredStatus?: FirstSetupState["status"];
    summary?: StartAgainSummary;
    backupPhase?: BackupRepairStatus["phase"];
    /** What `/backup/activity` answers, read again on every request; `null` by default. */
    activity?: BackupRepairActivity | null | (() => BackupRepairActivity | null);
    sameTab?: boolean;
    /** What the mount waits for; by default the password step, or with `activity` given, the password step or the running view. */
    ready?: (app: SetupApp) => boolean;
    theme?: "light" | "dark";
    locale?: "en-GB" | "es-ES";
  } = {},
) {
  let recovered = false;
  const fixture = wizardApi({
    claimed: true,
    intercept(path, body, headers) {
      const custom = options.intercept?.(path, body, headers);
      if (custom !== undefined) return custom;
      if (path.endsWith("/resolution"))
        return Response.json({
          version: 2,
          inspectionId: (recovered ? "b" : "a").repeat(64),
          pair: "valid",
          database: "missing",
          emptyDatabase: false,
          password: "checkable",
          revision: recovered ? 2 : 1,
          ownerGeneration: recovered ? 2 : 1,
          repairEligible: false,
          artifacts: [],
        } satisfies FirstSetupInspection);
      if (path.endsWith("/resolution/recover")) {
        recovered = true;
        return Response.json({
          state: {
            ...initial,
            revision: 2,
            ownerGeneration: 2,
            status: options.recoveredStatus ?? "claimed",
            consumptionIntent: !["claimed", "abandoned"].includes(
              options.recoveredStatus ?? "claimed",
            ),
          },
          capability: "B".repeat(43),
          ownerGeneration: 2,
        });
      }
      if (path.endsWith("/start-again/summary"))
        return Response.json(options.summary ?? namedSummary);
      if (path.endsWith("/backup/status"))
        return Response.json({
          phase: options.backupPhase ?? "unstarted",
          proofRequired: true,
        } satisfies BackupRepairStatus);
      if (path.endsWith("/start-again")) return Response.json({ restarting: true });
      if (path.endsWith("/backup/activity"))
        return Response.json({
          activity:
            typeof options.activity === "function"
              ? options.activity()
              : (options.activity ?? null),
        });
    },
  });
  if (options.sameTab)
    sessionStorage.setItem(
      FIRST_SETUP_SESSION_KEY,
      JSON.stringify({
        version: 1,
        clientClaimNonce: "N".repeat(43),
        claimPending: false,
        owner: {
          attemptId: initial.attemptId,
          revision: 1,
          ownerGeneration: 1,
          capability: "A".repeat(43),
        },
      }),
    );
  const { el: app, host } = await mountWidget<SetupApp>(
    "setup-app",
    {
      api: fixture.api,
      browserLanguages: [options.locale ?? "en-GB"],
    },
    options.theme,
  );
  if (options.ready) await expect.poll(() => options.ready!(app)).toBe(true);
  else if (options.activity === undefined)
    await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  else
    await expect.poll(() => q(app, "resume-password") ?? q(app, "recovery-running")).not.toBeNull();
  return { app, host, ...fixture };
}
export async function recoverMissing(app: SetupApp) {
  await userEvent.fill(
    q<WtInput>(app, "resume-password")!.shadowRoot!.querySelector("input")!,
    venue.admin.password,
  );
  await click(app, "resume");
  await expect
    .poll(() => JSON.parse(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)!).owner?.ownerGeneration)
    .toBe(2);
  await expect
    .poll(() =>
      [initialOwnerStrings.en.waiting, initialOwnerStrings.es.waiting].some((text) =>
        app.shadowRoot!.textContent!.includes(text),
      ),
    )
    .toBe(false);
  await app.updateComplete;
}
