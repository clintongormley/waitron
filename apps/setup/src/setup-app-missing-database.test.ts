import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, venue } from "../test/first-setup-browser.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { backupRepairStrings } from "./i18n/backup-repair.js";
import { shellEn, shellEs } from "./i18n/strings/shell.js";

import {
  q,
  click,
  damagedSummary,
  missingDatabaseFixture,
  namedSummary,
  recoverMissing,
  recoveryStartedAt,
  runningActivity,
  shownTimes,
  stoppedActivity,
  stoppedRecovery,
  stoppedSummary,
} from "../test/missing-database-browser.js";

const reached = (app: Element) =>
  [...app.shadowRoot!.querySelectorAll("[data-test=missing-reached] li")].map((li) =>
    li.textContent!.trim(),
  );

afterEach(async () => {
  cleanupWidgets();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});
it.each([false, true])(
  "keeps a missing database on repair after password recovery (same tab %s)",
  async (sameTab) => {
    const { app, requests } = await missingDatabaseFixture({ sameTab });
    await recoverMissing(app);
    expect(q(app, "screen-cert")).toBeNull();
    expect(q(app, "screen-first-owner")).not.toBeNull();
    expect(q(app, "missing-database")).not.toBeNull();
    expect(q<WtButton>(app, "start-again")?.disabled).toBe(false);
    expect(requests.some((r) => /\/(resume|claim|provision|start-again)$/.test(r.path))).toBe(
      false,
    );
    expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(venue.admin.password);
  },
);

it("retires only after password recovery, confirmation and a fresh owner-bound missing inspection", async () => {
  const { app, requests } = await missingDatabaseFixture();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  await recoverMissing(app);
  expect(app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.missingAsk);
  expect(reached(app)).toEqual([initialOwnerStrings.en.reachedName.replace("{name}", "0CNQT")]);
  await click(app, "start-again");
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  expect(q<WtButton>(app, "confirm-start-again")!.disabled).toBe(true);
  expect(q<HTMLInputElement>(app, "retire-confirmed")!.closest("label")!.textContent!.trim()).toBe(
    initialOwnerStrings.en.missingConfirm,
  );
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.restarting);
  const sent = requests.find((r) => r.path.endsWith("/start-again"))!;
  expect(sent.body).toEqual({
    inspectionId: "b".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown: namedSummary },
  });
  expect(sent.headers.get("X-Waitron-Setup-Owner")).toBe("B".repeat(43));
  expect(sent.headers.get("X-Waitron-Setup-Attempt")).toBe(initial.attemptId);
  expect(sent.headers.get("X-Waitron-Setup-Revision")).toBe("2");
  expect(sent.headers.get("X-Waitron-Setup-Generation")).toBe("2");
  expect(requests.slice(-3).map((r) => r.path)).toEqual([
    "/setup-api/first-setup/resolution",
    "/setup-api/first-setup/resolution/start-again/summary",
    "/setup-api/first-setup/resolution/start-again",
  ]);
  expect(q(app, "start-again")).toBeNull();
  expect(requests.some((r) => /\/(claim|provision|abandon)$/.test(r.path))).toBe(false);
});

it.each(["complete"] as const)(
  "does not offer missing-database retirement for %s work",
  async (recoveredStatus) => {
    const { app, requests } = await missingDatabaseFixture({ recoveredStatus });
    await recoverMissing(app);
    expect(q(app, "screen-cert")).toBeNull();
    expect(q(app, "finish-setup")).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain("Setup is complete");
    expect(q<WtButton>(app, "start-again")?.disabled ?? true).toBe(true);
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it.each([
  {
    recoveredStatus: "activation-started",
    reached: "fiscal-started",
    line: "reachedFiscalStarted",
  },
  { recoveredStatus: "uncertain", reached: "fiscal-started", line: "reachedFiscalStarted" },
  { recoveredStatus: "committed", reached: "fiscal-finished", line: "reachedFiscalFinished" },
  { recoveredStatus: "publication", reached: "fiscal-finished", line: "reachedFiscalFinished" },
] as const)(
  "offers the missing-database ask for $recoveredStatus work, saying $line",
  async ({ recoveredStatus, reached: summaryReached, line }) => {
    const { app, requests } = await missingDatabaseFixture({
      recoveredStatus,
      summary: { reached: summaryReached, lastName: "0CNQT" },
    });
    await recoverMissing(app);
    expect(q(app, "screen-cert")).toBeNull();
    expect(q(app, "finish-setup")).toBeNull();
    expect(app.shadowRoot!.textContent).not.toContain("Setup is complete");
    expect(reached(app)).toEqual([
      initialOwnerStrings.en.reachedName.replace("{name}", "0CNQT"),
      initialOwnerStrings.en[line],
    ]);
    expect(q<WtButton>(app, "start-again")?.disabled).toBe(false);
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it("requires password recovery again after a refused retirement and never retries it implicitly", async () => {
  const { app, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith("/start-again"))
        return Response.json(
          { error: { code: "setup.attempt_conflict", params: {} } },
          { status: 409 },
        );
    },
  });
  await recoverMissing(app);
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(q(app, "screen-cert")).toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  expect(app.shadowRoot!.textContent).not.toContain(initialOwnerStrings.en.restarting);
});

it("cancels missing-database retirement without sending it or continuing the wizard", async () => {
  const { app, requests } = await missingDatabaseFixture();
  await recoverMissing(app);
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "cancel-start-again");
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(q(app, "screen-cert")).toBeNull();
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  await click(app, "start-again");
  expect(q<HTMLInputElement>(app, "retire-confirmed")!.checked).toBe(false);
  expect(q<WtButton>(app, "confirm-start-again")!.disabled).toBe(true);
});

it("ignores duplicate clicks and a retirement answer after the app has left", async () => {
  let answer!: (value: Response) => void;
  const { app, api, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith("/start-again"))
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  const operation = vi.spyOn(api, "startAgainFirstSetup");
  await recoverMissing(app);
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  q(app, "confirm-start-again")!.dispatchEvent(new MouseEvent("click"));
  q(app, "confirm-start-again")!.dispatchEvent(new MouseEvent("click"));
  await expect.poll(() => answer).toBeTypeOf("function");
  expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  app.remove();
  answer(Response.json({ restarting: true }));
  await operation.mock.results[0]!.value;
  await app.updateComplete;
  expect(app.shadowRoot!.textContent).not.toContain(initialOwnerStrings.en.restarting);
});

it("does not restore missing-database evidence when a password inspection outlives its page", async () => {
  let answer!: (value: Response) => void;
  const { app, api, requests } = await missingDatabaseFixture({
    sameTab: true,
    intercept(path) {
      if (path.endsWith("/resolution"))
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  const inspection = vi.spyOn(api, "inspectFirstSetupResolution");
  const field = app.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
    "[data-test=resume-password]",
  )!;
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, venue.admin.password);
  await click(app, "resume");
  await expect.poll(() => answer).toBeTypeOf("function");
  const parent = app.parentNode!;
  app.remove();
  parent.append(app);
  answer(
    Response.json({
      version: 2,
      inspectionId: "a".repeat(64),
      pair: "valid",
      database: "missing",
      password: "checkable",
      revision: 1,
      ownerGeneration: 1,
      emptyDatabase: false,
      repairEligible: false,
      artifacts: [],
    }),
  );
  await inspection.mock.results[0]!.value;
  await app.updateComplete;
  expect(q(app, "missing-database")).toBeNull();
  expect(q(app, "resume-password")).toBeNull();
  expect(requests.some((r) => r.path.endsWith("/recover"))).toBe(false);
});

const askLines = (locale: "en" | "es") => [
  initialOwnerStrings[locale].missingAsk,
  initialOwnerStrings[locale].missingBackup,
  initialOwnerStrings[locale].reachedName.replace("{name}", "0CNQT"),
  initialOwnerStrings[locale].reachedNoName,
];
const locales = [
  { locale: "en", browser: "en-GB" },
  { locale: "es", browser: "es-ES" },
] as const;

it.each(locales)(
  "shows one series-name line for an attempt that only chose a name ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({ locale: browser });
    await recoverMissing(app);
    const t = initialOwnerStrings[locale];
    const text = app.shadowRoot!.textContent!;
    expect(text).toContain(t.missingDatabase);
    expect(text).toContain(t.missingAsk);
    expect(text).toContain(t.missingBackup);
    expect(reached(app)).toEqual([t.reachedName.replace("{name}", "0CNQT")]);
  },
);

it.each(locales)(
  "says no series name was chosen when the record names none ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({
      locale: browser,
      summary: { reached: "claimed", lastName: null },
    });
    await recoverMissing(app);
    expect(reached(app)).toEqual([initialOwnerStrings[locale].reachedNoName]);
  },
);

it.each(locales)(
  "shows the series name and finished activation for an attempt that finished it ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({
      locale: browser,
      recoveredStatus: "committed",
      summary: { reached: "fiscal-finished", lastName: "0CNQT" },
    });
    await recoverMissing(app);
    const t = initialOwnerStrings[locale];
    expect(reached(app)).toEqual([
      t.reachedName.replace("{name}", "0CNQT"),
      t.reachedFiscalFinished,
    ]);
  },
);

it.each(locales)(
  "keeps Start again disabled until the missing-database confirmation is ticked ($locale)",
  async ({ locale, browser }) => {
    const { app, requests } = await missingDatabaseFixture({ locale: browser });
    await recoverMissing(app);
    await click(app, "start-again");
    const t = initialOwnerStrings[locale];
    const box = q<HTMLInputElement>(app, "retire-confirmed")!;
    expect(box.name).toBe("missing-database-confirmed");
    expect(box.closest("label")!.textContent!.trim()).toBe(t.missingConfirm);
    expect(app.shadowRoot!.textContent).toContain(t.startAgainHelp);
    expect(q<WtButton>(app, "confirm-start-again")!.disabled).toBe(true);
    await userEvent.click(box);
    expect(q<WtButton>(app, "confirm-start-again")!.disabled).toBe(false);
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it.each(locales)(
  "draws Recover from backup beside Start again, with no recovery note ($locale)",
  async ({ browser }) => {
    const { app } = await missingDatabaseFixture({ locale: browser });
    await recoverMissing(app);
    const actions = q(app, "missing-actions")!;
    expect(
      [...actions.querySelectorAll("wt-button")].map((b) => b.getAttribute("data-test")),
    ).toEqual(["recover-backup", "start-again"]);
    expect(q(app, "recover-backup-note")).toBeNull();
  },
);

it.each(["selected", "uncertain"] as const)(
  "offers no Start again in the ask while a backup recovery's journal reports %s",
  async (backupPhase) => {
    const { app, requests } = await missingDatabaseFixture({ backupPhase });
    await recoverMissing(app);
    expect(app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.missingAsk);
    expect(q(app, "recover-backup")).not.toBeNull();
    expect(q(app, "start-again")).toBeNull();
    expect(q(app, "recover-backup-note")).toBeNull();
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it.each(["prepared", "placement-started", "restored"] as const)(
  "while a backup recovery reported %s is running, draws no password field and no buttons",
  async (phase) => {
    const { app, requests } = await missingDatabaseFixture({
      backupPhase: phase,
      activity: runningActivity,
    });
    expect(q(app, "recovery-running")).not.toBeNull();
    expect(q(app, "resume-password")).toBeNull();
    expect(q(app, "resume")).toBeNull();
    expect(q(app, "start-again")).toBeNull();
    expect(q(app, "recover-backup")).toBeNull();
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it.each(["prepared", "placement-started", "restored"] as const)(
  "once a backup recovery reported %s has stopped, the ask offers Start again and no Recover from backup",
  async (phase) => {
    const { app, requests } = await missingDatabaseFixture({
      backupPhase: phase,
      activity: { ...stoppedActivity, phase },
      summary: stoppedSummary,
    });
    await recoverMissing(app);
    expect(app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.missingAsk);
    expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
    expect(q(app, "recover-backup")).toBeNull();
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it.each(locales)(
  "shows none of the ask's lines before the password step ($locale)",
  async ({ locale, browser }) => {
    const { app, requests } = await missingDatabaseFixture({ locale: browser });
    const text = app.shadowRoot!.textContent!;
    expect(text).toContain(initialOwnerStrings[locale].missingDatabase);
    for (const line of askLines(locale)) expect(text).not.toContain(line);
    expect(q(app, "missing-reached")).toBeNull();
    expect(q(app, "recover-backup")).not.toBeNull();
    expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
    expect(requests.some((r) => r.path.endsWith("/summary"))).toBe(false);
  },
);

it.each([
  { route: "/start-again/summary", answer: { reached: "unknown", lastName: "0CNQT" } },
  { route: "/backup/status", answer: { phase: "unknown", proofRequired: true } },
])("offers no Start again when $route answers an unreadable record", async ({ route, answer }) => {
  const { app, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith(route)) return Response.json(answer);
    },
  });
  await recoverMissing(app);
  expect(q(app, "missing-reached")).toBeNull();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(
    app.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error,
  ).not.toBe("");
  q(app, "start-again")!.dispatchEvent(new MouseEvent("click"));
  await app.updateComplete;
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  const asked = requests.length;
  q(app, "confirm-start-again")!.dispatchEvent(new MouseEvent("click"));
  await app.updateComplete;
  expect(requests).toHaveLength(asked);
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});

it("shows the before-password line only before the password step", async () => {
  let answer!: (value: Response) => void;
  const { app } = await missingDatabaseFixture({
    intercept(path) {
      if (!path.endsWith("/start-again/summary")) return undefined;
      return new Promise<Response>((resolve) => {
        answer = resolve;
      });
    },
  });
  const line = initialOwnerStrings.en.startUnavailable;
  expect(app.shadowRoot!.textContent).toContain(line);
  await userEvent.fill(
    q<WtInput>(app, "resume-password")!.shadowRoot!.querySelector("input")!,
    venue.admin.password,
  );
  await click(app, "resume");
  await expect.poll(() => answer).toBeTypeOf("function");
  await app.updateComplete;
  expect(app.shadowRoot!.textContent).not.toContain(line);
  answer(Response.json({ error: { code: "setup.attempt_conflict", params: {} } }, { status: 409 }));
  await expect
    .poll(
      () =>
        app.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")?.error,
    )
    .toBeTruthy();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(app.shadowRoot!.textContent).not.toContain(line);
});

const shells = { en: shellEn, es: shellEs };
const startAgainRequests = <R extends { path: string }>(requests: R[]) =>
  requests.filter((r) => r.path.endsWith("/start-again"));
async function damagedConfirmation(browser: "en-GB" | "es-ES", summary = damagedSummary) {
  const fixture = await missingDatabaseFixture({ locale: browser, summary });
  await recoverMissing(fixture.app);
  await click(fixture.app, "start-again");
  return fixture;
}

it.each(locales)(
  "a damaged recovery-key record is named in the confirmation, above what Start again deletes ($locale)",
  async ({ locale, browser }) => {
    const { app, requests } = await damagedConfirmation(browser);
    const t = initialOwnerStrings[locale];
    const notice = q(app, "recovery-record-damaged")!;
    expect(notice.textContent!.trim()).toBe(t.recoveryRecordDamaged);
    const help = [...app.shadowRoot!.querySelectorAll("p")].find(
      (p) => p.textContent!.trim() === t.startAgainHelp,
    )!;
    expect(notice.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q(app, "retire-confirmed")).not.toBeNull();
    expect(q(app, "cancel-start-again")).not.toBeNull();
    expect(startAgainRequests(requests)).toHaveLength(0);
  },
);

it.each(locales)(
  "a damaged record reaches the confirmation, never 'wait a moment' and never support ($locale)",
  async ({ locale, browser }) => {
    const { app } = await damagedConfirmation(browser);
    const text = app.shadowRoot!.textContent!;
    expect(text).not.toContain(shells[locale]["shell.not_ready"]);
    expect(text).not.toContain(shells[locale]["shell.first_setup.attempt_invalid"]);
    expect(q(app, "confirm-start-again")).not.toBeNull();
  },
);

it("Cancel stops Start again past a damaged record and sends nothing", async () => {
  const { app, requests } = await damagedConfirmation("en-GB");
  await click(app, "cancel-start-again");
  expect(startAgainRequests(requests)).toHaveLength(0);
  expect(q(app, "recovery-record-damaged")).toBeNull();
  expect(q(app, "retire-confirmed")).toBeNull();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
});

it("confirming sends the summary as displayed, the damaged record included", async () => {
  const { app, requests } = await damagedConfirmation("en-GB");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  const body = startAgainRequests(requests)[0]!.body as {
    confirmMissingDatabase: { shown: unknown };
  };
  expect(body.confirmMissingDatabase.shown).toEqual(damagedSummary);
});

it("an undamaged record shows no damaged notice", async () => {
  const { app } = await damagedConfirmation("en-GB", namedSummary);
  expect(q(app, "retire-confirmed")).not.toBeNull();
  expect(q(app, "recovery-record-damaged")).toBeNull();
});

const runningLines = (locale: "en" | "es") => {
  const t = initialOwnerStrings[locale];
  return [
    t.recoveryRunning.replace("{started}", shownTimes[locale].started),
    t.recoveryLastActive.replace("{at}", shownTimes[locale].last),
    t.recoveryRunningNext,
  ];
};
const lines = (app: Parameters<typeof q>[0], name: string) =>
  [...(q(app, name)?.querySelectorAll("p") ?? [])].map((p) => p.textContent!.trim());
const GETS = [
  "/setup-api/status",
  "/setup-api/discovery",
  "/setup-api/venue-defaults",
  "/setup-api/first-setup/status",
  "/setup-api/first-setup/resolution",
  "/setup-api/first-setup/resolution/backup/activity",
];

it.each(locales)(
  "while another device runs a recovery, says so before any password, with no buttons and nothing sent ($locale)",
  async ({ locale, browser }) => {
    const { app, requests } = await missingDatabaseFixture({
      locale: browser,
      activity: runningActivity,
    });
    expect(lines(app, "recovery-running")).toEqual(runningLines(locale));
    expect(app.shadowRoot!.textContent).toContain(initialOwnerStrings[locale].missingDatabase);
    expect(q(app, "resume-password")).toBeNull();
    expect(q(app, "resume")).toBeNull();
    expect(q(app, "start-again")).toBeNull();
    expect(q(app, "recover-backup")).toBeNull();
    expect(q(app, "confirm-start-again")).toBeNull();
    expect(requests.map((r) => r.path).filter((path) => !GETS.includes(path))).toEqual([]);
    expect(requests.every((r) => r.body === undefined)).toBe(true);
  },
);

it("reads the activity again every 30 s, and offers the password step once the recovery stopped", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    let reads = 0;
    const { app, requests } = await missingDatabaseFixture({
      activity: () => (++reads <= 2 ? runningActivity : stoppedActivity),
    });
    const activityReads = () => requests.filter((r) => r.path.endsWith("/backup/activity"));
    expect(activityReads()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect.poll(() => activityReads()).toHaveLength(2);
    await app.updateComplete;
    expect(q(app, "recovery-running")).not.toBeNull();
    expect(q(app, "resume-password")).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect.poll(() => q(app, "resume-password")).not.toBeNull();
    expect(activityReads()).toHaveLength(3);
    expect(q(app, "recovery-running")).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(activityReads()).toHaveLength(3);
  } finally {
    vi.useRealTimers();
  }
});

it("stops reading the activity when the page leaves", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { app, requests } = await missingDatabaseFixture({ activity: runningActivity });
    const activityReads = () => requests.filter((r) => r.path.endsWith("/backup/activity"));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect.poll(() => activityReads()).toHaveLength(2);
    app.remove();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(activityReads()).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

it("offers the password step at once for a recovery that failed, and Start again after it", async () => {
  const recovery = { ...stoppedRecovery, failed: true };
  const { app } = await missingDatabaseFixture({
    backupPhase: "placement-started",
    activity: { ...stoppedActivity, phase: "placement-started", failed: true },
    summary: { ...namedSummary, recovery },
  });
  expect(q(app, "recovery-running")).toBeNull();
  expect(q(app, "resume-password")).not.toBeNull();
  await recoverMissing(app);
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
  expect(q(app, "recover-backup")).toBeNull();
});

it.each(locales)(
  "after the password, names the stopped recovery and when it was last active ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({
      locale: browser,
      backupPhase: "prepared",
      activity: stoppedActivity,
      summary: stoppedSummary,
    });
    expect(q(app, "recovery-stopped")).toBeNull();
    await recoverMissing(app);
    const t = initialOwnerStrings[locale];
    expect(reached(app)).toEqual([t.reachedName.replace("{name}", "0CNQT")]);
    expect(lines(app, "recovery-stopped")).toEqual([
      t.recoveryStopped.replace("{started}", shownTimes[locale].started),
      t.recoveryLastActive.replace("{at}", shownTimes[locale].last),
    ]);
    expect(app.shadowRoot!.textContent).not.toContain(t.recoveryStoppedCloud);
    expect(app.shadowRoot!.textContent).not.toContain(t.missingBackup);
    const actions = q(app, "missing-actions")!;
    expect(
      [...actions.querySelectorAll("wt-button")].map((b) => b.getAttribute("data-test")),
    ).toEqual(["start-again"]);
    await click(app, "start-again");
    expect(app.shadowRoot!.textContent).toContain(t.startAgainHelp);
    expect(
      q<HTMLInputElement>(app, "retire-confirmed")!.closest("label")!.textContent!.trim(),
    ).toBe(t.missingConfirm);
  },
);

it.each(locales)(
  "says a stopped Cloud recovery's approval closes by itself within an hour ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({
      locale: browser,
      backupPhase: "prepared",
      activity: { ...stoppedActivity, cloud: true },
      summary: { ...namedSummary, recovery: { ...stoppedRecovery, cloud: true } },
    });
    await recoverMissing(app);
    const t = initialOwnerStrings[locale];
    expect(lines(app, "recovery-stopped")).toEqual([
      t.recoveryStopped.replace("{started}", shownTimes[locale].started),
      t.recoveryLastActive.replace("{at}", shownTimes[locale].last),
      t.recoveryStoppedCloud,
    ]);
  },
);

it.each(locales)(
  "after a restart, says when the recovery's last step was saved ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({
      locale: browser,
      backupPhase: "restored",
      activity: { ...stoppedActivity, phase: "restored", lastActiveSource: "saved-step" },
      summary: {
        ...namedSummary,
        recovery: { ...stoppedRecovery, lastActiveSource: "saved-step" },
      },
    });
    await recoverMissing(app);
    const t = initialOwnerStrings[locale];
    expect(lines(app, "recovery-stopped")).toEqual([
      t.recoveryStopped.replace("{started}", shownTimes[locale].started),
      t.recoveryLastSaved.replace("{at}", shownTimes[locale].last),
    ]);
  },
);

it("sends the stopped recovery back exactly as it was shown", async () => {
  const { app, requests } = await missingDatabaseFixture({
    backupPhase: "prepared",
    activity: stoppedActivity,
    summary: stoppedSummary,
  });
  await recoverMissing(app);
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainRequests(requests)).toHaveLength(1);
  expect(startAgainRequests(requests)[0]!.body).toEqual({
    inspectionId: "b".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown: stoppedSummary },
  });
});

it("offers no Start again when the summary names a recovery but no stopped journal is reported", async () => {
  const { app } = await missingDatabaseFixture({ summary: stoppedSummary });
  await recoverMissing(app);
  expect(q(app, "missing-reached")).toBeNull();
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
});

it.each(locales)(
  "says the recovery's records cannot be read when its journal is unreadable ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({ locale: browser, backupPhase: "uncertain" });
    await recoverMissing(app);
    const t = initialOwnerStrings[locale];
    expect(q(app, "recovery-unreadable")!.textContent!.trim()).toBe(t.recoveryUnreadable);
    expect(app.shadowRoot!.textContent).toContain(t.missingAsk);
    expect(q(app, "recover-backup")).not.toBeNull();
    expect(q(app, "start-again")).toBeNull();
  },
);

it.each(locales)(
  "explains a password step refused because a recovery is in progress ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({
      locale: browser,
      intercept(path) {
        if (path.endsWith("/resolution/recover"))
          return Response.json(
            {
              error: {
                code: "setup.recovery_in_progress",
                params: {
                  startedAt: stoppedRecovery.startedAt,
                  lastActiveAt: stoppedRecovery.lastActiveAt,
                },
              },
            },
            { status: 409 },
          );
      },
    });
    await userEvent.fill(
      q<WtInput>(app, "resume-password")!.shadowRoot!.querySelector("input")!,
      venue.admin.password,
    );
    await click(app, "resume");
    await expect
      .poll(() =>
        [
          ...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions"),
        ].map((f) => f.error),
      )
      .toContain(shells[locale]["shell.first_setup.recovery_in_progress"]);
  },
);

it.each(locales)(
  "explains a Start again refused because the recovery was discarded elsewhere ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({
      locale: browser,
      backupPhase: "prepared",
      activity: stoppedActivity,
      summary: stoppedSummary,
      intercept(path) {
        if (path.endsWith("/resolution/start-again"))
          return Response.json(
            { error: { code: "setup.recovery_discarded", params: {} } },
            { status: 409 },
          );
      },
    });
    await recoverMissing(app);
    await click(app, "start-again");
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
    await click(app, "confirm-start-again");
    await expect
      .poll(() =>
        [
          ...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions"),
        ].map((f) => f.error),
      )
      .toContain(shells[locale]["shell.first_setup.recovery_discarded"]);
  },
);

it("sends no Start again when the stopped recovery changed after it was shown", async () => {
  let summaries = 0;
  const { app, requests } = await missingDatabaseFixture({
    backupPhase: "prepared",
    activity: stoppedActivity,
    intercept(path) {
      if (path.endsWith("/start-again/summary"))
        return Response.json(
          ++summaries === 1
            ? stoppedSummary
            : { ...namedSummary, recovery: { ...stoppedRecovery, cloud: true } },
        );
    },
  });
  await recoverMissing(app);
  await click(app, "start-again");
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => summaries).toBe(2);
  await expect.poll(() => q(app, "resume-password")).not.toBeNull();
  expect(startAgainRequests(requests)).toHaveLength(0);
});

const ACTIONS = [
  "resume-password",
  "resume",
  "start-again",
  "recover-backup",
  "confirm-start-again",
  "abandon-attempt",
  "replace-attempt",
  "finish-setup",
  "damaged-record-continue",
];
const actionsDrawn = (app: Parameters<typeof q>[0]) =>
  ACTIONS.filter((name) => q(app, name) !== null);

it.each(locales)(
  "a tab that signed in before reads the activity on reload and draws the same running view, with no password field and nothing sent ($locale)",
  async ({ locale, browser }) => {
    const { app, requests } = await missingDatabaseFixture({
      locale: browser,
      sameTab: true,
      activity: runningActivity,
    });
    expect(lines(app, "recovery-running")).toEqual(runningLines(locale));
    expect(actionsDrawn(app)).toEqual([]);
    expect(q(app, "reconnect-first")).not.toBeNull();
    expect(requests.map((r) => r.path).filter((path) => !GETS.includes(path))).toEqual([]);
  },
);

it.each([false, true])(
  "Reconnect while another device runs a recovery reads the activity again and offers nothing (same tab %s)",
  async (sameTab) => {
    let reads = 0;
    const { app, requests } = await missingDatabaseFixture({
      sameTab,
      activity: () => (++reads === 1 ? null : runningActivity),
    });
    expect(q(app, "resume-password")).not.toBeNull();
    await click(app, "reconnect-first");
    await expect.poll(() => q(app, "recovery-running")).not.toBeNull();
    expect(reads).toBe(2);
    expect(lines(app, "recovery-running")).toEqual(runningLines("en"));
    expect(actionsDrawn(app)).toEqual([]);
    expect(requests.map((r) => r.path).filter((path) => !GETS.includes(path))).toEqual([]);
  },
);

it.each([false, true])(
  "an activity answer that cannot be read offers nothing but Reconnect (same tab %s)",
  async (sameTab) => {
    const { app, requests } = await missingDatabaseFixture({
      sameTab,
      intercept(path) {
        if (path.endsWith("/backup/activity"))
          return Response.json({ activity: { state: "running", startedAt: recoveryStartedAt } });
      },
      ready: (app) =>
        [
          ...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions"),
        ].some((f) => f.error === initialOwnerStrings.en.error),
    });
    expect(requests.some((r) => r.path.endsWith("/backup/activity"))).toBe(true);
    await app.updateComplete;
    expect(actionsDrawn(app)).toEqual([]);
    expect(q(app, "recovery-running")).toBeNull();
    expect(q(app, "reconnect-first")).not.toBeNull();
    expect(requests.map((r) => r.path).filter((path) => !GETS.includes(path))).toEqual([]);
  },
);

it.each(locales)(
  "a summary naming a recovery that the backup status does not report as stopped says its records cannot be read, and Check again reads both again ($locale)",
  async ({ locale, browser }) => {
    let phase: "unstarted" | "prepared" = "unstarted";
    const { app, requests } = await missingDatabaseFixture({
      locale: browser,
      activity: stoppedActivity,
      summary: stoppedSummary,
      intercept(path) {
        if (path.endsWith("/backup/status")) return Response.json({ phase, proofRequired: true });
      },
    });
    await recoverMissing(app);
    const t = initialOwnerStrings[locale];
    expect(q(app, "recovery-unreadable")!.textContent!.trim()).toBe(t.recoveryUnreadable);
    expect(q(app, "check-again")!.textContent!.trim()).toBe(t.checkAgain);
    expect(
      [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
        (f) => f.error,
      ),
    ).not.toContain(shells[locale]["shell.first_setup.attempt_invalid"]);
    expect(app.shadowRoot!.textContent).not.toContain(
      shells[locale]["shell.first_setup.attempt_invalid"],
    );
    expect(q(app, "recovery-stopped")).toBeNull();
    expect(q<WtButton>(app, "start-again")?.disabled ?? true).toBe(true);
    const summaries = () => requests.filter((r) => r.path.endsWith("/start-again/summary"));
    const statuses = () => requests.filter((r) => r.path.endsWith("/backup/status"));
    expect([summaries().length, statuses().length]).toEqual([1, 1]);
    phase = "prepared";
    await click(app, "check-again");
    await expect.poll(() => q(app, "recovery-stopped")).not.toBeNull();
    expect([summaries().length, statuses().length]).toEqual([2, 2]);
    expect(q(app, "check-again")).toBeNull();
    expect(q(app, "recovery-unreadable")).toBeNull();
    expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
  },
);

it.each(["en", "es"] as const)(
  "the setup page's Check again has the backup screen's words for the same button (%s)",
  (locale) => {
    expect(initialOwnerStrings[locale].checkAgain).toBe(backupRepairStrings[locale].reconnect);
  },
);
