import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import type { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { setLocale } from "./i18n/t.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { shellEn } from "./i18n/strings/shell.js";
import type {
  BackupRepairActivity,
  BackupRepairStatus,
  FirstSetupInspection,
  StartAgainConfirm,
  StartAgainSummary,
} from "./api/first-setup-types.js";
import { initial, wizardApi } from "../test/first-setup-browser.js";
import {
  click,
  damagedSummary,
  namedSummary,
  q,
  stoppedActivity,
  stoppedSummary,
} from "../test/missing-database-browser.js";
import { refusedCause, settled } from "../test/held-database-browser.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});

const t = initialOwnerStrings.en;
const text = (app: SetupApp) => app.shadowRoot!.textContent!;
// A form's error is drawn inside wt-form-actions' own shadow root, out of reach of text(app).
const formErrors = (app: SetupApp) =>
  [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
    (f) => f.error,
  );
const OWNER_HEADER = "X-Waitron-Setup-Owner";

async function wipeFixture(
  options: {
    inspection?: Partial<FirstSetupInspection>;
    activity?: BackupRepairActivity | null | (() => BackupRepairActivity | null);
    summary?: () => Response | Promise<Response>;
    startAgain?: () => Response;
    backupPhase?: BackupRepairStatus["phase"];
  } = {},
) {
  const fixture = wizardApi({
    claimed: true,
    intercept(path) {
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
type Sent = { path: string; body: unknown; headers: Headers };
const summaryReads = (requests: Sent[]) =>
  requests.filter((r) => r.path.endsWith("/start-again/summary"));
const sends = (requests: Sent[]) =>
  requests.filter((r) => r.path.endsWith("/resolution/start-again"));

const cases: {
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

for (const c of cases)
  it(`${c.name}: Start again asks for no password, reads the summary with no owner tab, and sends what was shown`, async () => {
    const { app, requests } = await wipeFixture({
      inspection: c.inspection,
      activity: c.activity,
      summary: () => Response.json(c.summary),
    });
    await click(app, "start-again");
    await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
    expect(q(app, "damaged-record-password")).toBeNull();
    expect(summaryReads(requests).length).toBe(1);
    for (const read of summaryReads(requests)) expect(read.headers.has(OWNER_HEADER)).toBe(false);
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
    await click(app, "confirm-start-again");
    await expect.poll(() => sends(requests).length).toBe(1);
    const [sent] = sends(requests);
    expect(sent!.headers.has(OWNER_HEADER)).toBe(false);
    expect(sent!.body).toEqual({
      inspectionId: "a".repeat(64),
      revision: 1,
      ownerGeneration: 1,
      ...c.sent,
    });
    expect(requests.some((r) => r.path.endsWith("/resolution/recover"))).toBe(false);
    await expect.poll(() => text(app)).toContain(t.restarting);
  });

it("with the setup database missing, no Continue or password field is drawn, before or after Start again", async () => {
  const { app } = await wipeFixture({ inspection: { database: "missing" } });
  expect(q(app, "resume")).toBeNull();
  expect(q(app, "resume-password")).toBeNull();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  expect(q(app, "missing-reached")).not.toBeNull();
  expect(q(app, "resume")).toBeNull();
  expect(q(app, "resume-password")).toBeNull();
});

it("with the setup database missing and the setup finished, Start again draws the box's refusal and is no longer offered", async () => {
  const { app } = await wipeFixture({
    inspection: { database: "missing" },
    summary: () => refusedCause("setup-finished"),
  });
  expect(q(app, "resume")).toBeNull();
  await click(app, "start-again");
  await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
  await settled(app);
  expect(q(app, "start-again-refused")!.textContent).toContain(t.setupFinished);
  expect(q(app, "start-again")).toBeNull();
  expect(q(app, "retire-confirmed")).toBeNull();
  expect(q(app, "reconnect-first")).not.toBeNull();
});

it("a summary refused setup.owner_required never says to resume in the owner tab", async () => {
  const { app } = await wipeFixture({
    summary: () =>
      Response.json({ error: { code: "setup.owner_required", params: {} } }, { status: 403 }),
  });
  await click(app, "start-again");
  await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
  await settled(app);
  expect(text(app)).not.toContain(shellEn["shell.first_setup.owner_required"]);
  expect(q(app, "start-again")).toBeNull();
  expect(q(app, "retire-confirmed")).toBeNull();
});

it("where the setup password cannot be checked, Start again is not offered and no summary is read", async () => {
  const { app, requests } = await wipeFixture({
    inspection: { password: "uncheckable", revision: null, ownerGeneration: null },
  });
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(summaryReads(requests)).toEqual([]);
});

it("where the setup record pair is only repairable, Start again is not offered and no summary is read", async () => {
  const { app, requests } = await wipeFixture({ inspection: { pair: "repairable" } });
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(summaryReads(requests)).toEqual([]);
});

it("pressing Start again reads the setup again before reading the summary", async () => {
  const { app, requests } = await wipeFixture();
  const before = requests.filter((r) => r.path.endsWith("/resolution")).length;
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  const after = requests.map((r) => r.path);
  const inspected = after.lastIndexOf(after.filter((p) => p.endsWith("/resolution")).at(-1)!);
  expect(requests.filter((r) => r.path.endsWith("/resolution")).length).toBe(before + 1);
  expect(inspected).toBeLessThan(after.findIndex((p) => p.endsWith("/start-again/summary")));
});

it("a recovery found running when Start again is pressed draws the running recovery and no confirmation", async () => {
  let activity: BackupRepairActivity | null = null;
  const { app, requests } = await wipeFixture({ activity: () => activity });
  activity = {
    state: "running",
    startedAt: stoppedActivity.startedAt,
    lastActiveAt: stoppedActivity.lastActiveAt,
  };
  await click(app, "start-again");
  await expect.poll(() => q(app, "recovery-running")).not.toBeNull();
  await app.updateComplete;
  expect(q(app, "retire-confirmed")).toBeNull();
  expect(summaryReads(requests)).toEqual([]);
});

it("a send refused kept-records closes the confirmation, says the setup changed, and offers Start again again", async () => {
  const { app } = await wipeFixture({ startAgain: () => refusedCause("kept-records") });
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "retire-confirmed")).toBeNull();
  await settled(app);
  expect(formErrors(app)).toContain(t.heldChanged);
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
});

it("a summary answered after the page has left and been read again draws no confirmation", async () => {
  let answer!: (response: Response) => void;
  const { app, requests } = await wipeFixture({
    summary: () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  });
  await click(app, "start-again");
  await expect.poll(() => summaryReads(requests).length).toBe(1);
  const parent = app.parentElement!;
  app.remove();
  parent.append(app);
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "start-again")).not.toBeNull();
  await settled(app);
  answer(Response.json(namedSummary));
  await new Promise((resolve) => setTimeout(resolve, 100));
  await app.updateComplete;
  expect(q(app, "retire-confirmed")).toBeNull();
});

it("beside a stopped recovery, a summary read refused storage.disk_full says so and offers Check again, which reads it again", async () => {
  let full = true;
  const { app, requests } = await wipeFixture({
    activity: stoppedActivity,
    summary: () =>
      full
        ? Response.json(
            { error: { code: "storage.disk_full", params: { restartDeletesLogs: true } } },
            { status: 507 },
          )
        : Response.json(stoppedSummary),
  });
  await click(app, "start-again");
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  await settled(app);
  expect(formErrors(app)).toContain(shellEn["shell.first_setup.disk_full"]);
  expect(q(app, "recovery-stopped")).not.toBeNull();
  expect(q(app, "retire-confirmed")).toBeNull();
  full = false;
  await click(app, "check-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  expect(summaryReads(requests).length).toBe(2);
});

it("with no stopped recovery, a summary read that fails draws the error beside Start again, still offered", async () => {
  let fail = true;
  const { app } = await wipeFixture({
    summary: () =>
      fail
        ? Response.json(
            { error: { code: "storage.disk_full", params: { restartDeletesLogs: true } } },
            { status: 507 },
          )
        : Response.json(namedSummary),
  });
  await click(app, "start-again");
  await expect.poll(() => formErrors(app)).toContain(shellEn["shell.first_setup.disk_full"]);
  await settled(app);
  expect(q(app, "check-again")).toBeNull();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
  fail = false;
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
});
