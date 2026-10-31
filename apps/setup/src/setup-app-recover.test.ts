import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { WtButton } from "@waitron/ui";
import type { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { setLocale, t as say } from "./i18n/t.js";
import { shellEn } from "./i18n/strings/shell.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { initial, venue } from "../test/first-setup-browser.js";
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

/** A box that restarts after the wipe: unreachable while `down`, then answering no setup once wiped. */
function restartingBox() {
  const box = {
    down: false,
    wiped: false,
    claimedAgain: false,
    inspectionDown: false,
    offeringsDown: false,
  };
  return {
    box,
    options: {
      intercept: (path: string) => {
        if (box.offeringsDown && path.endsWith("/offerings")) {
          box.offeringsDown = false;
          return Promise.reject(new TypeError("network unavailable"));
        }
        if (box.inspectionDown && path.endsWith("/resolution"))
          return Promise.reject(new TypeError("Failed to fetch"));
      },
      startAgain: () => {
        box.wiped = true;
        return Response.json({ restarting: true });
      },
      status: () => {
        if (box.down) throw new TypeError("Failed to fetch");
        return box.wiped && !box.claimedAgain ? Response.json({ claimed: false }) : undefined;
      },
    },
  };
}
async function confirmWipe(
  app: SetupApp,
  kind: "recover" | "start-again",
  restarting: string = t.restarting,
) {
  await click(app, kind === "recover" ? "recover-backup" : "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(tick(app));
  await click(app, kind === "recover" ? "confirm-recover" : "confirm-start-again");
  await expect.poll(() => text(app)).toContain(restarting);
}
const otherScreens = ["screen-first-owner", "screen-venue", "screen-mode"];

for (const [locale, lang] of locales)
  it(`after Recover from backup's wipe, Reconnect opens Join or recover (${locale})`, async () => {
    const { options } = restartingBox();
    const { app } = await wipeFixture(options);
    setLocale(locale);
    await app.updateComplete;
    await confirmWipe(app, "recover", initialOwnerStrings[lang].restarting);
    await click(app, "reconnect-first");
    await expect.poll(() => q(app, "screen-role")).not.toBeNull();
    await q<LitElement>(app, "screen-role")!.updateComplete;
    expect(q(app, "screen-role")!.shadowRoot!.querySelector("h1")!.textContent).toBe(
      say("role.heading", locale),
    );
    for (const name of otherScreens) expect(q(app, name), name).toBeNull();
    expect(oldRecoveryMounted(app)).toBe(false);
  });

it("Reconnect while the box is still restarting keeps the choice, and the next Reconnect opens Join or recover", async () => {
  const { box, options } = restartingBox();
  const { app } = await wipeFixture(options);
  await confirmWipe(app, "recover");
  box.down = true;
  await click(app, "reconnect-first");
  await expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
  await settled(app);
  expect(q(app, "screen-first-owner")).not.toBeNull();
  expect(q(app, "screen-role")).toBeNull();
  box.down = false;
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-role")).not.toBeNull();
});

it("a Reconnect that finds a setup claimed again draws the repair page, not Join or recover, and forgets the choice", async () => {
  const { box, options } = restartingBox();
  const { app } = await wipeFixture(options);
  await confirmWipe(app, "recover");
  box.claimedAgain = true;
  await click(app, "reconnect-first");
  await expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
  await settled(app);
  expect(q(app, "screen-first-owner")).not.toBeNull();
  expect(q(app, "screen-role")).toBeNull();
  box.claimedAgain = false;
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-first-owner")).toBeNull();
  expect(q(app, "screen-role")).toBeNull();
});

it("after Start again's wipe, Reconnect opens the setup choice screen", async () => {
  const { options } = restartingBox();
  const { app } = await wipeFixture(options);
  await confirmWipe(app, "start-again");
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-mode")).not.toBeNull();
  expect(q(app, "screen-venue")).toBeNull();
  expect(q(app, "screen-role")).toBeNull();
});

it("beside a stopped recovery, after Recover, a failed summary read and Check again, the wipe's Reconnect still opens Join or recover", async () => {
  const { options } = restartingBox();
  let reads = 0;
  const { app } = await wipeFixture({
    ...options,
    activity: stoppedActivity,
    summary: () =>
      reads++ === 0
        ? Response.json({ error: { code: "server.internal", params: {} } }, { status: 500 })
        : Response.json(stoppedSummary),
  });
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "check-again")).not.toBeNull();
  await settled(app);
  await click(app, "check-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(tick(app));
  await click(app, "confirm-recover");
  await expect.poll(() => text(app)).toContain(t.restarting);
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-role")).not.toBeNull();
});

it("a Recover send answered setup.start_again_incomplete keeps the choice: Reconnect, once the box answers no setup, opens Join or recover", async () => {
  const { box, options } = restartingBox();
  const { app } = await wipeFixture({
    ...options,
    startAgain: () => {
      box.wiped = true;
      return Response.json(
        { error: { code: "setup.start_again_incomplete", params: {} } },
        { status: 409 },
      );
    },
  });
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(tick(app));
  await click(app, "confirm-recover");
  await expect
    .poll(() => formErrors(app))
    .toContain(shellEn["shell.first_setup.start_again_incomplete"]);
  await settled(app);
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-role")).not.toBeNull();
});

/** A box that deletes the setup and restarts before its answer reaches the page. */
function answerLostBox() {
  const { box, options } = restartingBox();
  return {
    box,
    options: {
      ...options,
      intercept: (path: string) => {
        if (path.endsWith("/resolution/start-again")) {
          box.wiped = true;
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return options.intercept(path);
      },
    },
  };
}
async function sendWipe(app: SetupApp, kind: "recover" | "start-again") {
  await click(app, kind === "recover" ? "recover-backup" : "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(tick(app));
  await click(app, kind === "recover" ? "confirm-recover" : "confirm-start-again");
  await expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
  await settled(app);
}

for (const [kind, screen] of [
  ["recover", "screen-role"],
  ["start-again", "screen-mode"],
] as const)
  it(`a ${kind} wipe whose answer never reaches the page: Reconnect, once the box answers no setup, opens ${screen}`, async () => {
    const { box, options } = answerLostBox();
    const { app } = await wipeFixture(options);
    await sendWipe(app, kind);
    expect(box.wiped).toBe(true);
    expect(formErrors(app)).toContain(t.error);
    await click(app, "reconnect-first");
    await expect.poll(() => q(app, "screen-first-owner")).toBeNull();
    expect(q(app, screen)).not.toBeNull();
    for (const other of ["screen-role", "screen-mode", "screen-venue"].filter((s) => s !== screen))
      expect(q(app, other), other).toBeNull();
  });

it("a Recover send whose answer is lost while the box kept the setup: Reconnect, finding it still claimed, draws the repair page, not Join or recover", async () => {
  const { box, options } = restartingBox();
  const { app } = await wipeFixture({
    ...options,
    intercept: (path: string) =>
      path.endsWith("/resolution/start-again")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : options.intercept(path),
  });
  await sendWipe(app, "recover");
  expect(box.wiped).toBe(false);
  expect(formErrors(app)).toContain(t.error);
  await click(app, "reconnect-first");
  await expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
  await settled(app);
  expect(q(app, "screen-first-owner")).not.toBeNull();
  expect(q(app, "screen-role")).toBeNull();
});

it("a Recover send refused kept-records forgets the choice: a Reconnect that then finds no setup opens the venue screen", async () => {
  const { box, options } = restartingBox();
  const { app } = await wipeFixture({ ...options, startAgain: () => refusedCause("kept-records") });
  await sendWipe(app, "recover");
  box.wiped = true;
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-first-owner")).toBeNull();
  expect(q(app, "screen-venue")).not.toBeNull();
  expect(q(app, "screen-role")).toBeNull();
});

it("a Recover send refused setup.attempt_conflict forgets the choice: a Reconnect that then finds no setup opens the venue screen", async () => {
  const { box, options } = restartingBox();
  const { app } = await wipeFixture({
    ...options,
    startAgain: () =>
      Response.json({ error: { code: "setup.attempt_conflict", params: {} } }, { status: 409 }),
  });
  await sendWipe(app, "recover");
  expect(formErrors(app)).toContain(t.heldChanged);
  box.wiped = true;
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-first-owner")).toBeNull();
  expect(q(app, "screen-venue")).not.toBeNull();
  expect(q(app, "screen-role")).toBeNull();
});

it("from Join or recover, Restore from backup opens the fresh-box restore screen, and nothing went to the old recovery's routes", async () => {
  const { options } = restartingBox();
  const { app, requests } = await wipeFixture(options);
  await confirmWipe(app, "recover");
  expect(oldRecoveryMounted(app)).toBe(false);
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-role")).not.toBeNull();
  const role = q<LitElement>(app, "screen-role")!;
  await role.updateComplete;
  const choose = role.shadowRoot!.querySelector<WtButton>("[data-test=choose-restore]")!;
  await userEvent.click(choose.shadowRoot!.querySelector("button")!);
  await expect.poll(() => q(app, "screen-restore")).not.toBeNull();
  expect(oldRecoveryMounted(app)).toBe(false);
  expect(requests.some((r) => OLD_RECOVERY_ROUTE.test(r.path))).toBe(false);
});

it("a Reconnect that finds the setup claimed and then cannot read it still forgets the choice", async () => {
  const { box, options } = restartingBox();
  const { app } = await wipeFixture(options);
  await confirmWipe(app, "recover");
  box.claimedAgain = true;
  box.inspectionDown = true;
  await click(app, "reconnect-first");
  await expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
  await settled(app);
  expect(q(app, "screen-role")).toBeNull();
  box.claimedAgain = false;
  box.inspectionDown = false;
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-first-owner")).toBeNull();
  expect(q(app, "screen-venue")).not.toBeNull();
});

/** From the setup choice screen, a Live venue whose offerings read fails, then Reconnect. */
async function failedOfferingReconnect(app: SetupApp, box: { offeringsDown: boolean }) {
  await expect.poll(() => q(app, "screen-mode")).not.toBeNull();
  const emit = (name: string, detail?: unknown) =>
    app
      .shadowRoot!.querySelector("main")!
      .dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  box.offeringsDown = true;
  emit("setup-patch", { patch: { mode: "live", venue } });
  emit("setup-goto", { screen: "venue" });
  await expect.poll(() => q(app, "screen-venue")).not.toBeNull();
  emit("setup-advance");
  await expect.poll(() => q(app, "reconnect-first")).not.toBeNull();
  await settled(app);
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-first-owner")).toBeNull();
}

it("the choice is used once: after Start again's landing, a Reconnect after a failed offering opens the venue screen", async () => {
  const { box, options } = restartingBox();
  const { app } = await wipeFixture(options);
  await confirmWipe(app, "start-again");
  await click(app, "reconnect-first");
  await failedOfferingReconnect(app, box);
  expect(q(app, "screen-venue")).not.toBeNull();
  expect(q(app, "screen-mode")).toBeNull();
});

it("taking the page off the screen forgets the choice: put back, Reconnect opens the venue screen", async () => {
  const { options } = restartingBox();
  const { app } = await wipeFixture(options);
  await confirmWipe(app, "recover");
  const host = app.parentElement!;
  app.remove();
  host.append(app);
  await expect.poll(() => q(app, "reconnect-first")).not.toBeNull();
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-first-owner")).toBeNull();
  expect(q(app, "screen-venue")).not.toBeNull();
  expect(q(app, "screen-role")).toBeNull();
});

it("after setup.start_again_incomplete, a Reconnect that finds the setup claimed again forgets the choice", async () => {
  const { box, options } = restartingBox();
  const { app } = await wipeFixture({
    ...options,
    startAgain: () => {
      box.wiped = true;
      return Response.json(
        { error: { code: "setup.start_again_incomplete", params: {} } },
        { status: 409 },
      );
    },
  });
  await click(app, "recover-backup");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(tick(app));
  await click(app, "confirm-recover");
  await expect
    .poll(() => formErrors(app))
    .toContain(shellEn["shell.first_setup.start_again_incomplete"]);
  await settled(app);
  box.claimedAgain = true;
  await click(app, "reconnect-first");
  await expect.poll(() => q<WtButton>(app, "reconnect-first")?.disabled).toBe(false);
  await settled(app);
  expect(q(app, "screen-role")).toBeNull();
  box.claimedAgain = false;
  await click(app, "reconnect-first");
  await expect.poll(() => q(app, "screen-first-owner")).toBeNull();
  expect(q(app, "screen-venue")).not.toBeNull();
});
