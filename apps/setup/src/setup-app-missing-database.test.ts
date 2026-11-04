import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton, WtInput } from "@waitron/ui";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial, venue } from "../test/first-setup-browser.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { shellEn, shellEs } from "./i18n/strings/shell.js";

import {
  q,
  click,
  damagedSummary,
  missingDatabaseFixture,
  namedSummary,
  openMissing,
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
it.each([
  { locale: "en", browser: "en-GB" },
  { locale: "es", browser: "es-ES" },
] as const)(
  "with the database missing, the page offers Start again and no Continue; pressing it draws what the setup reached and the missing-database tick, with no password ($locale)",
  async ({ locale, browser }) => {
    const t = initialOwnerStrings[locale];
    const { app, requests } = await missingDatabaseFixture({ locale: browser });
    expect(q(app, "missing-database")!.textContent!.trim()).toBe(t.missingDatabase);
    expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
    for (const name of ["resume", "resume-password"]) expect(q(app, name), name).toBeNull();
    await openMissing(app);
    expect(reached(app)).toEqual([t.reachedNotStarted]);
    const box = q<HTMLInputElement>(app, "retire-confirmed")!;
    expect(box.name).toBe("missing-database-confirmed");
    expect(box.closest("label")!.textContent!.trim()).toBe(t.missingConfirm);
    for (const name of ["resume", "resume-password"]) expect(q(app, name), name).toBeNull();
    expect(app.shadowRoot!.querySelector("input[type=password]")).toBeNull();
    expect(requests.some((r) => r.path.endsWith("/recover"))).toBe(false);
    expect(requests.some((r) => r.headers.has("X-Waitron-Setup-Owner"))).toBe(false);
  },
);

it("with the database missing and the setup finished, pressing Start again draws setupFinished and no Start again, with Reconnect still drawn", async () => {
  const t = initialOwnerStrings.en;
  const { app, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith("/start-again/summary"))
        return Response.json(
          { error: { code: "setup.start_again_refused", params: { cause: "setup-finished" } } },
          { status: 409 },
        );
    },
  });
  await openMissing(app);
  expect(q(app, "start-again-refused")!.textContent).toBe(t.setupFinished);
  expect(q(app, "start-again")).toBeNull();
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(q(app, "reconnect-first")).not.toBeNull();
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});

it("pressing Start again with the database missing keeps the page on repair and sends nothing that continues the setup", async () => {
  const { app, requests } = await missingDatabaseFixture();
  await openMissing(app);
  expect(q(app, "screen-cert")).toBeNull();
  expect(q(app, "screen-first-owner")).not.toBeNull();
  expect(q(app, "missing-database")).not.toBeNull();
  expect(q(app, "confirm-start-again")).not.toBeNull();
  expect(requests.some((r) => /\/(resume|recover|claim|provision|start-again)$/.test(r.path))).toBe(
    false,
  );
});

it("in a tab that signed in before, Continue with the database missing sends no password, keeps the page on repair and offers Start again", async () => {
  const { app, requests } = await missingDatabaseFixture({
    sameTab: true,
    ready: (app) => q(app, "resume-password") !== null,
  });
  await userEvent.fill(
    q<WtInput>(app, "resume-password")!.shadowRoot!.querySelector("input")!,
    venue.admin.password,
  );
  await click(app, "resume");
  await expect.poll(() => q(app, "start-again")).not.toBeNull();
  expect(q(app, "missing-database")).not.toBeNull();
  expect(q(app, "resume-password")).toBeNull();
  expect(q(app, "screen-cert")).toBeNull();
  expect(q(app, "screen-first-owner")).not.toBeNull();
  expect(requests.some((r) => /\/(resume|recover|claim|provision|start-again)$/.test(r.path))).toBe(
    false,
  );
  expect(requests.every((r) => !JSON.stringify(r.body ?? "").includes(venue.admin.password))).toBe(
    true,
  );
});

it("retires only after the confirmation, reading the summary again before sending it", async () => {
  const { app, requests } = await missingDatabaseFixture();
  await openMissing(app);
  expect(app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.missingAsk);
  expect(reached(app)).toEqual([initialOwnerStrings.en.reachedNotStarted]);
  expect(q<WtButton>(app, "confirm-start-again")!.disabled).toBe(true);
  expect(q<HTMLInputElement>(app, "retire-confirmed")!.closest("label")!.textContent!.trim()).toBe(
    initialOwnerStrings.en.missingConfirm,
  );
  const asked = requests.length;
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => app.shadowRoot!.textContent).toContain(initialOwnerStrings.en.restarting);
  const sent = requests.find((r) => r.path.endsWith("/start-again"))!;
  expect(sent.body).toEqual({
    inspectionId: "a".repeat(64),
    revision: 1,
    ownerGeneration: 1,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown: namedSummary },
  });
  expect(sent.headers.has("X-Waitron-Setup-Owner")).toBe(false);
  expect(requests.slice(asked).map((r) => r.path)).toEqual([
    "/setup-api/first-setup/resolution/start-again/summary",
    "/setup-api/first-setup/resolution/start-again",
  ]);
  expect(q(app, "start-again")).toBeNull();
  expect(requests.some((r) => /\/(claim|provision|abandon)$/.test(r.path))).toBe(false);
});

it("a refused retirement offers Start again again and never retries it by itself", async () => {
  const { app, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith("/start-again"))
        return Response.json(
          { error: { code: "setup.attempt_conflict", params: {} } },
          { status: 409 },
        );
    },
  });
  await openMissing(app);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "start-again")).not.toBeNull();
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(q(app, "screen-cert")).toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  expect(app.shadowRoot!.textContent).not.toContain(initialOwnerStrings.en.restarting);
});

it("cancels missing-database retirement without sending it or continuing the wizard", async () => {
  const { app, requests } = await missingDatabaseFixture();
  await openMissing(app);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "cancel-start-again");
  expect(q(app, "confirm-start-again")).toBeNull();
  expect(q(app, "screen-cert")).toBeNull();
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  await openMissing(app);
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
  await openMissing(app);
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

it("a second click on Start again's outer element while the summary is being read reads the box and the summary once", async () => {
  const held: ((response: Response) => void)[] = [];
  const { app, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith("/start-again/summary"))
        return new Promise<Response>((done) => held.push(done));
    },
  });
  const reads = (suffix: string) => requests.filter((r) => r.path.endsWith(suffix)).length;
  const inspections = reads("/first-setup/resolution");
  q(app, "start-again")!.dispatchEvent(new MouseEvent("click"));
  await expect.poll(() => reads("/start-again/summary")).toBe(1);
  q(app, "start-again")!.dispatchEvent(new MouseEvent("click"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const done of held) done(Response.json(namedSummary));
  await expect.poll(() => q(app, "missing-reached")).not.toBeNull();
  expect(reads("/first-setup/resolution")).toBe(inspections + 1);
  expect(reads("/start-again/summary")).toBe(1);
});

it("a setup read on pressing Start again that outlives its page opens no confirmation", async () => {
  let answer!: (value: Response) => void;
  let inspections = 0;
  const { app, api, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith("/resolution") && ++inspections === 2)
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
    },
  });
  const inspection = vi.spyOn(api, "inspectFirstSetupResolution");
  await click(app, "start-again");
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
  await Promise.all(inspection.mock.results.map((r) => r.value));
  await app.updateComplete;
  expect(q(app, "retire-confirmed")).toBeNull();
  expect(q(app, "missing-database")).toBeNull();
  expect(requests.some((r) => r.path.endsWith("/start-again/summary"))).toBe(false);
});

const askLines = (locale: "en" | "es") => [
  initialOwnerStrings[locale].missingAsk,
  initialOwnerStrings[locale].missingBackup,
  initialOwnerStrings[locale].reachedNotStarted,
];
const locales = [
  { locale: "en", browser: "en-GB" },
  { locale: "es", browser: "es-ES" },
] as const;

it.each([
  { locale: "en", browser: "en-GB", summaryReached: "claimed", line: "reachedNotStarted" },
  { locale: "es", browser: "es-ES", summaryReached: "claimed", line: "reachedNotStarted" },
  { locale: "en", browser: "en-GB", summaryReached: "named", line: "reachedNotStarted" },
  { locale: "es", browser: "es-ES", summaryReached: "named", line: "reachedNotStarted" },
  {
    locale: "en",
    browser: "en-GB",
    summaryReached: "fiscal-started",
    line: "reachedFiscalStarted",
  },
  {
    locale: "es",
    browser: "es-ES",
    summaryReached: "fiscal-started",
    line: "reachedFiscalStarted",
  },
  {
    locale: "en",
    browser: "en-GB",
    summaryReached: "fiscal-finished",
    line: "reachedFiscalFinished",
  },
  {
    locale: "es",
    browser: "es-ES",
    summaryReached: "fiscal-finished",
    line: "reachedFiscalFinished",
  },
] as const)(
  "an attempt that reached $summaryReached shows only $line, and names no series ($locale)",
  async ({ locale, browser, summaryReached, line }) => {
    const { app } = await missingDatabaseFixture({
      locale: browser,
      summary: { reached: summaryReached },
    });
    await openMissing(app);
    const t = initialOwnerStrings[locale];
    const text = app.shadowRoot!.textContent!;
    expect(text).toContain(t.missingDatabase);
    expect(text).toContain(t.missingAsk);
    expect(text).toContain(t.missingBackup);
    expect(reached(app)).toEqual([t[line]]);
    expect(text).not.toContain("0CNQT");
  },
);

it.each(locales)(
  "keeps Start again disabled until the missing-database confirmation is ticked ($locale)",
  async ({ locale, browser }) => {
    const { app, requests } = await missingDatabaseFixture({ locale: browser });
    await openMissing(app);
    const t = initialOwnerStrings[locale];
    const box = q<HTMLInputElement>(app, "retire-confirmed")!;
    expect(box.name).toBe("missing-database-confirmed");
    expect(box.closest("label")!.textContent!.trim()).toBe(t.missingConfirm);
    expect(q<WtButton>(app, "confirm-start-again")!.disabled).toBe(true);
    await userEvent.click(box);
    expect(q<WtButton>(app, "confirm-start-again")!.disabled).toBe(false);
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

it.each(locales)("draws Recover from backup beside Start again ($locale)", async ({ browser }) => {
  const { app } = await missingDatabaseFixture({ locale: browser });
  expect(q(app, "recover-backup")).not.toBeNull();
  expect(q(app, "start-again")).not.toBeNull();
  await openMissing(app);
  const actions = q(app, "missing-actions")!;
  expect(
    [...actions.querySelectorAll("wt-button")].map((b) => b.getAttribute("data-test")),
  ).toEqual(["recover-backup"]);
});

it.each(locales)(
  "shows none of the ask's lines before Start again is pressed ($locale)",
  async ({ locale, browser }) => {
    const { app, requests } = await missingDatabaseFixture({ locale: browser });
    const text = app.shadowRoot!.textContent!;
    expect(text).toContain(initialOwnerStrings[locale].missingDatabase);
    for (const line of askLines(locale)) expect(text).not.toContain(line);
    expect(q(app, "missing-reached")).toBeNull();
    expect(q(app, "recover-backup")).not.toBeNull();
    expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
    expect(requests.some((r) => r.path.endsWith("/summary"))).toBe(false);
  },
);

it.each([{ route: "/start-again/summary", answer: { reached: "unknown" } }])(
  "opens no confirmation when $route answers an unreadable record",
  async ({ route, answer }) => {
    const { app, requests } = await missingDatabaseFixture({
      intercept(path) {
        if (path.endsWith(route)) return Response.json(answer);
      },
    });
    await openMissing(app);
    expect(q(app, "missing-reached")).toBeNull();
    expect(q(app, "retire-confirmed")).toBeNull();
    expect(q(app, "confirm-start-again")).toBeNull();
    expect(
      [
        ...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions"),
      ].some((f) => f.error),
    ).toBe(true);
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);

const shells = { en: shellEn, es: shellEs };
const startAgainRequests = <R extends { path: string }>(requests: R[]) =>
  requests.filter((r) => r.path.endsWith("/start-again"));
async function damagedConfirmation(browser: "en-GB" | "es-ES", summary = damagedSummary) {
  const fixture = await missingDatabaseFixture({ locale: browser, summary });
  await openMissing(fixture.app);
  return fixture;
}

it.each(locales)(
  "a damaged recovery-key record is named in the confirmation, above what Start again deletes ($locale)",
  async ({ locale, browser }) => {
    const { app, requests } = await damagedConfirmation(browser);
    const t = initialOwnerStrings[locale];
    const notice = q(app, "recovery-record-damaged")!;
    expect(notice.textContent!.trim()).toBe(t.recoveryRecordDamaged);
    expect(
      notice.compareDocumentPosition(q(app, "start-again-deletes")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

it.each(locales)(
  "with the database missing, the confirmation says what Start again deletes but not that no invoice was sent ($locale)",
  async ({ locale, browser }) => {
    const { app } = await damagedConfirmation(browser, namedSummary);
    const t = initialOwnerStrings[locale];
    expect(q(app, "start-again-deletes")!.textContent!.trim()).toBe(t.heldLost);
    const text = app.shadowRoot!.textContent!;
    expect(text).not.toContain(t.noInvoiceSent);
    if (locale === "en") expect(text).not.toContain("No invoice");
    expect(q(app, "missing-database")!.textContent!.trim()).toBe(t.missingDatabase);
    expect(q(app, "retire-confirmed")!.closest("label")!.textContent!.trim()).toBe(
      t.missingConfirm,
    );
  },
);

it("an undamaged record shows no damaged notice", async () => {
  const { app } = await damagedConfirmation("en-GB", namedSummary);
  expect(q(app, "retire-confirmed")).not.toBeNull();
  expect(q(app, "recovery-record-damaged")).toBeNull();
});

it("sends no Start again when the summary changed after it was shown", async () => {
  let summaries = 0;
  const { app, requests } = await missingDatabaseFixture({
    intercept(path) {
      if (path.endsWith("/start-again/summary"))
        return Response.json(++summaries === 1 ? namedSummary : damagedSummary);
    },
  });
  await openMissing(app);
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => summaries).toBe(2);
  await expect.poll(() => q(app, "retire-confirmed")).toBeNull();
  await expect.poll(() => q(app, "start-again")).not.toBeNull();
  expect(
    [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
      (f) => f.error,
    ),
  ).toContain(initialOwnerStrings.en.heldChanged);
  expect(startAgainRequests(requests)).toHaveLength(0);
});
