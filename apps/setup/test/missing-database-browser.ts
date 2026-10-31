import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import "../src/setup-app.js";
import type { SetupApp } from "../src/setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "../src/first-setup-session.js";
import type {
  BackupRepairActivity,
  BackupRepairStatus,
  FirstSetupInspection,
  StartAgainRecoveryShown,
  StartAgainSummary,
} from "../src/api/first-setup-types.js";
import { initial, wizardApi } from "./first-setup-browser.js";
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
    summary?: StartAgainSummary;
    backupPhase?: BackupRepairStatus["phase"];
    /** What `/backup/activity` answers, read again on every request; `null` by default. */
    activity?: BackupRepairActivity | null | (() => BackupRepairActivity | null);
    sameTab?: boolean;
    /** What the mount waits for; by default Start again or the running view. */
    ready?: (app: SetupApp) => boolean;
    theme?: "light" | "dark";
    locale?: "en-GB" | "es-ES";
  } = {},
) {
  const fixture = wizardApi({
    claimed: true,
    intercept(path, body, headers) {
      const custom = options.intercept?.(path, body, headers);
      if (custom !== undefined) return custom;
      if (path.endsWith("/resolution"))
        return Response.json({
          version: 2,
          inspectionId: "a".repeat(64),
          pair: "valid",
          database: "missing",
          emptyDatabase: false,
          password: "checkable",
          revision: 1,
          ownerGeneration: 1,
          repairEligible: false,
          artifacts: [],
        } satisfies FirstSetupInspection);
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
  else await expect.poll(() => q(app, "start-again") ?? q(app, "recovery-running")).not.toBeNull();
  return { app, host, ...fixture };
}
/** Presses Start again and waits for the box's answer: the ask, a refusal or an error. */
export async function openMissing(app: SetupApp) {
  await click(app, "start-again");
  await expect
    .poll(
      () =>
        q(app, "missing-reached") ??
        q(app, "start-again-refused") ??
        q(app, "check-again") ??
        [
          ...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions"),
        ].find((f) => f.error) ??
        null,
    )
    .not.toBeNull();
  await app.updateComplete;
}
