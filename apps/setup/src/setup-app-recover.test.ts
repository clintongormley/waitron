import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import type { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { setLocale } from "./i18n/t.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { initial } from "../test/first-setup-browser.js";
import {
  click,
  missingDatabaseFixture,
  namedSummary,
  openMissing,
  q,
  shownTimes,
  stoppedActivity,
  stoppedSummary,
} from "../test/missing-database-browser.js";
import { refusedCause, settled } from "../test/held-database-browser.js";
import {
  OLD_RECOVERY_ROUTE,
  OWNER_HEADER,
  cases,
  confirmation,
  fieldsIn,
  formErrors,
  sends,
  summaryReads,
  t,
  text,
  wipeFixture,
} from "../test/wipe-browser.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});

const locales = [
  ["en-GB", "en"],
  ["es-ES", "es"],
] as const;
const oldRecoveryMounted = (app: SetupApp) =>
  app.shadowRoot!.querySelector("setup-first-backup") !== null;
const tick = (app: SetupApp) => q<HTMLInputElement>(app, "retire-confirmed")!;
const tickLabel = (app: SetupApp) => tick(app).closest("label")!.textContent!.trim();
const paragraph = (app: SetupApp) => q(app, "recover-deletes")!.textContent!.trim();

for (const c of cases)
  it(`${c.name}: Recover sends exactly what Start again sends, with no password and no owner header, and never opens the old recovery`, async () => {
    const { app, requests } = await wipeFixture({
      inspection: c.inspection,
      activity: c.activity,
      summary: () => Response.json(c.summary),
    });
    await click(app, "recover-backup");
    expect(oldRecoveryMounted(app)).toBe(false);
    await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
    expect(oldRecoveryMounted(app)).toBe(false);
    expect(fieldsIn(confirmation(app, "confirm-recover"))).toEqual([]);
    await userEvent.click(tick(app));
    await click(app, "confirm-recover");
    await expect.poll(() => sends(requests).length).toBe(1);
    expect(sends(requests)[0]!.body).toEqual({
      inspectionId: "a".repeat(64),
      revision: 1,
      ownerGeneration: 1,
      ...c.sent,
    });
    await expect.poll(() => text(app)).toContain(t.restarting);
    expect(oldRecoveryMounted(app)).toBe(false);
    expect(requests.some((r) => r.headers.has(OWNER_HEADER))).toBe(false);
    expect(requests.some((r) => OLD_RECOVERY_ROUTE.test(r.path))).toBe(false);
  });

for (const [locale, lang] of locales)
  it(`Recover's confirmation says §9b's words (${locale})`, async () => {
    const s = initialOwnerStrings[lang];
    const { app } = await wipeFixture({ summary: () => Response.json(namedSummary) });
    setLocale(locale);
    await app.updateComplete;
    await click(app, "recover-backup");
    await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
    expect(paragraph(app)).toBe(`${s.recoverDeletes} ${s.noInvoiceSent} ${s.recoverThen}`);
    expect(tickLabel(app)).toBe(s.retireRecover);
    expect(tick(app).name).toBe("retire-setup");
    const confirm = q<WtButton>(app, "confirm-recover")!;
    expect(confirm.textContent!.trim()).toBe(s.recoverBackup);
    expect(confirm.disabled).toBe(true);
    expect(q(app, "start-again-deletes")).toBeNull();
    expect(q(app, "confirm-start-again")).toBeNull();
    const elements = confirmation(app, "confirm-recover");
    expect(elements.length).toBe(3);
    expect(elements[0]!.matches("p[data-test=recover-deletes]")).toBe(true);
    expect(elements[1]!.matches("label")).toBe(true);
    expect(elements[1]!.contains(tick(app))).toBe(true);
    expect(elements[2]!.matches("wt-form-actions")).toBe(true);
    await userEvent.click(tick(app));
    await expect.poll(() => confirm.disabled).toBe(false);
    expect(confirm.variant).toBe("danger");
  });

it("with the setup database missing, Recover's confirmation leaves out the no-invoice sentence and uses the missing-database tick", async () => {
  const { app } = await wipeFixture({ inspection: { database: "missing" } });
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  expect(paragraph(app)).toBe(`${t.recoverDeletes} ${t.recoverThen}`);
  expect(tickLabel(app)).toBe(t.missingConfirm);
  expect(tick(app).name).toBe("missing-database-confirmed");
  expect(q(app, "missing-reached")).not.toBeNull();
  expect(text(app)).not.toContain(t.missingBackup);
  expect(
    [...q(app, "missing-actions")!.querySelectorAll("[data-test]")].map((e) =>
      e.getAttribute("data-test"),
    ),
  ).toEqual([]);
});

it("a setup database the box cannot read all of: Recover's confirmation draws setupDatabaseUnreadable and leaves out the no-invoice sentence", async () => {
  const { app } = await wipeFixture({
    summary: () => Response.json({ ...namedSummary, databaseUnreadable: true }),
  });
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  expect(q(app, "setup-database-unreadable")!.textContent).toBe(t.setupDatabaseUnreadable);
  expect(paragraph(app)).toBe(`${t.recoverDeletes} ${t.recoverThen}`);
});

it("switching the language while Recover's confirmation is open redraws it in Spanish and keeps the tick", async () => {
  const es = initialOwnerStrings.es;
  const { app, requests } = await wipeFixture();
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(tick(app));
  setLocale("es-ES");
  await app.updateComplete;
  expect(paragraph(app)).toBe(`${es.recoverDeletes} ${es.noInvoiceSent} ${es.recoverThen}`);
  expect(tickLabel(app)).toBe(es.retireRecover);
  expect(tick(app).checked).toBe(true);
  expect(summaryReads(requests).length).toBe(1);
});

const refusals: [string, () => Response, string][] = [
  ["setup-finished", () => refusedCause("setup-finished"), t.setupFinished],
  [
    "trading-settings",
    () => refusedCause("trading-settings"),
    `${t.tradingSaved} ${t.tradingSavedPassword}`,
  ],
  ["kept-records", () => refusedCause("kept-records"), t.keptFault],
  [
    "setup.not_ready",
    () => Response.json({ error: { code: "setup.not_ready", params: {} } }, { status: 409 }),
    t.wipeUnavailable,
  ],
  [
    "setup.owner_required",
    () => Response.json({ error: { code: "setup.owner_required", params: {} } }, { status: 403 }),
    t.wipeUnavailable,
  ],
];
it.each(refusals)(
  "Recover from backup refuses where Start again refuses, in the same words: %s",
  async (_cause, summary, expected) => {
    const { app, requests } = await wipeFixture({ summary });
    await click(app, "recover-backup");
    await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
    await settled(app);
    expect(q(app, "start-again-refused")!.textContent!.trim()).toBe(expected);
    for (const name of [
      "recover-backup",
      "start-again",
      "retire-confirmed",
      "confirm-start-again",
      "confirm-recover",
    ])
      expect(q(app, name), name).toBeNull();
    expect(q(app, "reconnect-first")).not.toBeNull();
    expect(sends(requests)).toEqual([]);
    expect(oldRecoveryMounted(app)).toBe(false);
  },
);

it.each([
  ["uncheckable", { password: "uncheckable", revision: null, ownerGeneration: null }],
  ["repairable", { pair: "repairable" }],
] as const)(
  "where the wipe is not offered (%s), Recover from backup is drawn disabled like Start again",
  async (name, inspection) => {
    const { app } = await wipeFixture({ inspection });
    expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
    expect(q<WtButton>(app, "recover-backup")!.disabled).toBe(true);
    expect(q(app, "start-again-refused")!.textContent).toBe(t.wipeUnavailable);
    if (name === "uncheckable") expect(text(app)).toContain(t.uncheckable);
    expect(oldRecoveryMounted(app)).toBe(false);
  },
);

it.each(["selected", "uncertain"] as const)(
  "in the missing ask, a backup phase %s offers neither button and no 'If you have a backup' line",
  async (backupPhase) => {
    const { app } = await missingDatabaseFixture({ backupPhase });
    await openMissing(app);
    await settled(app);
    expect(q(app, "missing-reached")).not.toBeNull();
    expect(q(app, "recover-backup")).toBeNull();
    expect(q(app, "start-again")).toBeNull();
    expect(text(app)).not.toContain(t.missingBackup);
    if (backupPhase === "uncertain") expect(q(app, "recovery-unreadable")).not.toBeNull();
  },
);

it("pressing Recover beside Start again's open confirmation reads the box again and opens Recover's confirmation instead", async () => {
  const { app, requests } = await wipeFixture();
  await click(app, "start-again");
  await expect.poll(() => q(app, "start-again-deletes")).not.toBeNull();
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "recover-deletes")).not.toBeNull();
  await settled(app);
  expect(summaryReads(requests).length).toBe(2);
  expect(q(app, "start-again-deletes")).toBeNull();
  expect(q(app, "recover-backup")).toBeNull();
  expect(q(app, "start-again")).toBeNull();
  await userEvent.click(tick(app));
  await click(app, "confirm-recover");
  await expect.poll(() => text(app)).toContain(t.restarting);
  expect(sends(requests).length).toBe(1);
});

const stoppedLines = (app: SetupApp) => {
  const blocks = app.shadowRoot!.querySelectorAll("[data-test=recovery-stopped]");
  expect(blocks.length).toBe(1);
  return [...blocks[0]!.querySelectorAll("p")].map((p) => p.textContent!.trim());
};
const recoverStoppedLine = t.recoveryStoppedRecover.replace("{started}", shownTimes.en.started);
const ids = { inspectionId: "a".repeat(64), revision: 1, ownerGeneration: 1 };

it.each([
  [
    "present",
    () =>
      wipeFixture({
        activity: stoppedActivity,
        summary: () => Response.json(stoppedSummary),
      }),
    { ...ids, confirmRecoveryDiscard: { shown: stoppedSummary } },
  ],
  [
    "missing",
    () =>
      missingDatabaseFixture({
        backupPhase: "prepared",
        activity: stoppedActivity,
        summary: stoppedSummary,
      }),
    { ...ids, confirmMissingDatabase: { nothingFiledOrSold: true, shown: stoppedSummary } },
  ],
] as const)(
  "beside a stopped recovery (%s database), Recover is offered, names the recovery with recoveryStoppedRecover, and sends what Start again sends",
  async (_shape, mount, body) => {
    const { app, requests } = await mount();
    await settled(app);
    expect(q<WtButton>(app, "recover-backup")!.disabled).toBe(false);
    await click(app, "recover-backup");
    await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
    const [first, second] = stoppedLines(app);
    expect(first).toBe(recoverStoppedLine);
    expect(second).toBe(t.recoveryLastActive.replace("{at}", shownTimes.en.last));
    expect(text(app)).not.toContain("Start again deletes it");
    await userEvent.click(tick(app));
    await click(app, "confirm-recover");
    await expect.poll(() => sends(requests).length).toBe(1);
    expect(sends(requests)[0]!.body).toEqual(body);
  },
);

it("after a failed summary read beside a stopped recovery, Check again from Recover reopens Recover's confirmation", async () => {
  let reads = 0;
  const { app } = await wipeFixture({
    activity: stoppedActivity,
    summary: () =>
      reads++ === 0
        ? Response.json({ error: { code: "server.internal", params: {} } }, { status: 500 })
        : Response.json(stoppedSummary),
  });
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  await settled(app);
  expect(stoppedLines(app)[0]).toBe(recoverStoppedLine);
  expect(text(app)).not.toContain("Start again deletes it");
  await click(app, "check-again");
  await expect.poll(() => q(app, "recover-deletes")).not.toBeNull();
  expect(q(app, "confirm-recover")).not.toBeNull();
  expect(q(app, "start-again-deletes")).toBeNull();
});

it("with the database missing and a recovery not yet settled, Check again from Recover reopens Recover's confirmation", async () => {
  let statusReads = 0;
  const { app, requests } = await missingDatabaseFixture({
    summary: stoppedSummary,
    intercept(path) {
      if (path.endsWith("/backup/status"))
        return Response.json({
          phase: statusReads++ === 0 ? "selected" : "prepared",
          proofRequired: true,
        });
    },
  });
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  await settled(app);
  expect(q(app, "recovery-unreadable")).not.toBeNull();
  await click(app, "check-again");
  await expect.poll(() => q(app, "recover-deletes")).not.toBeNull();
  expect(q(app, "confirm-recover")).not.toBeNull();
  expect(stoppedLines(app)[0]).toBe(recoverStoppedLine);
  await userEvent.click(tick(app));
  await click(app, "confirm-recover");
  await expect.poll(() => sends(requests).length).toBe(1);
  expect(sends(requests)[0]!.body).toEqual({
    ...ids,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown: stoppedSummary },
  });
});

it("a Recover send refused kept-records closes the confirmation, says the setup changed, and offers Recover again", async () => {
  const { app } = await wipeFixture({ startAgain: () => refusedCause("kept-records") });
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(tick(app));
  await click(app, "confirm-recover");
  await expect.poll(() => q(app, "retire-confirmed")).toBeNull();
  await settled(app);
  expect(formErrors(app)).toContain(t.heldChanged);
  expect(q<WtButton>(app, "recover-backup")!.disabled).toBe(false);
  await expect.poll(() => app.shadowRoot!.activeElement).toBe(q(app, "recover-backup"));
});

it("Cancel after Recover beside a stopped recovery draws the on-load line again, and Start again then draws its own words", async () => {
  const { app } = await wipeFixture({
    activity: stoppedActivity,
    summary: () => Response.json(stoppedSummary),
  });
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "recover-deletes")).not.toBeNull();
  await click(app, "cancel-start-again");
  await expect.poll(() => q(app, "recover-deletes")).toBeNull();
  await settled(app);
  expect(stoppedLines(app)[0]).toBe(t.recoveryStopped.replace("{started}", shownTimes.en.started));
  expect(q<WtButton>(app, "recover-backup")!.disabled).toBe(false);
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
  await click(app, "start-again");
  await expect.poll(() => q(app, "start-again-deletes")).not.toBeNull();
  expect(q(app, "recover-deletes")).toBeNull();
  expect(stoppedLines(app)[0]).toBe(t.recoveryStopped.replace("{started}", shownTimes.en.started));
});
