import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, venue } from "../test/first-setup-browser.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";

import {
  q,
  click,
  missingDatabaseFixture,
  namedSummary,
  recoverMissing,
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
  initialOwnerStrings[locale].recoverBackupNote,
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
  "draws Recover from backup beside Start again with the recovery note under it ($locale)",
  async ({ locale, browser }) => {
    const { app } = await missingDatabaseFixture({ locale: browser });
    await recoverMissing(app);
    const t = initialOwnerStrings[locale];
    const actions = q(app, "missing-actions")!;
    expect(
      [...actions.querySelectorAll("wt-button")].map((b) => b.getAttribute("data-test")),
    ).toEqual(["recover-backup", "start-again"]);
    expect(q(app, "recover-backup-note")!.textContent!.trim()).toBe(t.recoverBackupNote);
    expect(
      actions.compareDocumentPosition(q(app, "recover-backup-note")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
);

it.each(["prepared", "placement-started", "restored", "selected", "uncertain"] as const)(
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
