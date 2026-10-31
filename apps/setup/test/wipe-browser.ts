import { expect } from "vitest";
import type { SetupApp } from "../src/setup-app.js";
import { initialOwnerStrings } from "../src/screens/initial-owner-strings.js";
import type {
  BackupRepairActivity,
  BackupRepairStatus,
  FirstSetupInspection,
  StartAgainConfirm,
  StartAgainSummary,
} from "../src/api/first-setup-types.js";
import { wizardApi } from "./first-setup-browser.js";
import {
  damagedSummary,
  namedSummary,
  q,
  stoppedActivity,
  stoppedSummary,
} from "./missing-database-browser.js";
import { settled } from "./held-database-browser.js";
import { mountWidget } from "../src/widgets/test-helpers.js";

export const t = initialOwnerStrings.en;
export const text = (app: SetupApp) => app.shadowRoot!.textContent!;
// A form's error is drawn inside wt-form-actions' own shadow root, out of reach of text(app).
export const formErrors = (app: SetupApp) =>
  [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
    (f) => f.error,
  );
export const OWNER_HEADER = "X-Waitron-Setup-Owner";
/** A page request that would open, run or close the repair page's old recovery from backup. */
export const OLD_RECOVERY_ROUTE =
  /\/resolution\/backup\/(open|resume|prepare|commit|close|renew|cloud\/)/;
/** The confirmation's own elements: its first line through the actions holding its Confirm. */
export const confirmation = (app: SetupApp, confirm = "confirm-start-again") => {
  const actions = q(app, confirm)!.closest("wt-form-actions")!;
  const first = app.shadowRoot!.querySelector(
    [
      "recovery-record-damaged",
      "setup-database-unreadable",
      "start-again-deletes",
      "recover-deletes",
    ]
      .map((name) => `[data-test=${name}]`)
      .join(", "),
  )!;
  const elements: Element[] = [];
  for (let el: Element | null = first; el; el = el.nextElementSibling) {
    elements.push(el);
    if (el === actions) return elements;
  }
  throw new Error("the confirmation's Confirm does not follow its first line");
};
export const fieldsIn = (elements: Element[]) =>
  elements.flatMap((el) => [
    ...(el.matches("wt-input, input:not([type=checkbox])") ? [el] : []),
    ...el.querySelectorAll("wt-input, input:not([type=checkbox])"),
  ]);

export async function wipeFixture(
  options: {
    inspection?: Partial<FirstSetupInspection>;
    /** Merged into each inspection read after `inspection`, counted from 0. */
    inspectionAt?: (read: number) => Partial<FirstSetupInspection>;
    activity?: BackupRepairActivity | null | (() => BackupRepairActivity | null);
    summary?: () => Response | Promise<Response>;
    startAgain?: () => Response;
    backupPhase?: BackupRepairStatus["phase"];
    /** Answers `/first-setup/status` before the fixture's own answer, when it returns a response. */
    status?: (path: string, headers: Headers) => Response | undefined;
  } = {},
) {
  let inspections = 0;
  const fixture = wizardApi({
    claimed: true,
    intercept(path, _body, headers) {
      if (path.endsWith("/first-setup/status")) {
        const answer = options.status?.(path, headers);
        if (answer !== undefined) return answer;
      }
      if (path.endsWith("/backup/activity"))
        return Response.json({
          activity:
            typeof options.activity === "function"
              ? options.activity()
              : (options.activity ?? null),
        });
      if (path.endsWith("/backup/status"))
        return Response.json({
          phase: options.backupPhase ?? "unstarted",
          proofRequired: true,
        } satisfies BackupRepairStatus);
      if (path.endsWith("/start-again/summary"))
        return options.summary?.() ?? Response.json(namedSummary);
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
          revision: 1,
          ownerGeneration: 1,
          repairEligible: false,
          artifacts: [],
          ...options.inspection,
          ...options.inspectionAt?.(inspections++),
        } satisfies FirstSetupInspection);
    },
  });
  const { el: app } = await mountWidget<SetupApp>("setup-app", {
    api: fixture.api,
    browserLanguages: ["en-GB"],
  });
  await expect.poll(() => q(app, "start-again")).not.toBeNull();
  await settled(app);
  return { app, ...fixture };
}
export type Sent = { path: string; body: unknown; headers: Headers };
export const summaryReads = (requests: Sent[]) =>
  requests.filter((r) => r.path.endsWith("/start-again/summary"));
export const sends = (requests: Sent[]) =>
  requests.filter((r) => r.path.endsWith("/resolution/start-again"));

export const cases: {
  name: string;
  inspection: Partial<FirstSetupInspection>;
  activity: BackupRepairActivity | null;
  summary: StartAgainSummary;
  sent: StartAgainConfirm;
}[] = [
  {
    name: "an empty unused setup database",
    inspection: { database: "no-venue-rows", emptyDatabase: true },
    activity: null,
    summary: { reached: "claimed" },
    sent: {},
  },
  {
    name: "a setup database holding records, with no stopped recovery",
    inspection: { database: "occupied" },
    activity: null,
    summary: namedSummary,
    sent: {},
  },
  {
    name: "a setup database holding records beside a stopped recovery",
    inspection: { database: "occupied" },
    activity: stoppedActivity,
    summary: stoppedSummary,
    sent: { confirmRecoveryDiscard: { shown: stoppedSummary } },
  },
  {
    name: "a damaged recovery-key record",
    inspection: { database: "occupied" },
    activity: null,
    summary: damagedSummary,
    sent: { recoveryRecordDamagedShown: true },
  },
  {
    name: "a missing setup database",
    inspection: { database: "missing" },
    activity: null,
    summary: namedSummary,
    sent: { confirmMissingDatabase: { nothingFiledOrSold: true, shown: namedSummary } },
  },
  {
    name: "a setup database the box cannot read all of",
    inspection: { database: "occupied" },
    activity: null,
    summary: { ...namedSummary, databaseUnreadable: true },
    sent: { confirmUnreadableDatabase: { shown: { ...namedSummary, databaseUnreadable: true } } },
  },
];
