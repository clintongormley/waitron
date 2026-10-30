import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import type { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { setLocale } from "./i18n/t.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { shellEn, shellEs } from "./i18n/strings/shell.js";
import { initial } from "../test/first-setup-browser.js";
import { click, q, stoppedSummary } from "../test/missing-database-browser.js";
import {
  heldFixture,
  heldPasswordAccepted,
  refusedCause,
  settled,
  tradingEnv,
} from "../test/held-database-browser.js";
import { cleanupWidgets } from "./widgets/test-helpers.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});
const locales = ["en-GB", "es-ES"] as const;
const stringsFor = (locale: string) => initialOwnerStrings[locale.startsWith("es") ? "es" : "en"];
const shellFor = (locale: string) => (locale.startsWith("es") ? shellEs : shellEn);
const text = (app: SetupApp) => app.shadowRoot!.textContent!;
const formErrors = (app: SetupApp) =>
  [...app.shadowRoot!.querySelectorAll<HTMLElement & { error: string }>("wt-form-actions")].map(
    (f) => f.error,
  );
// A form's error is drawn inside wt-form-actions' own shadow root, out of reach of text(app).
const shown = (app: SetupApp) => [text(app), ...formErrors(app)].join("\n");
const startAgainSends = (requests: { path: string }[]) =>
  requests.filter((r) => r.path.endsWith("/resolution/start-again"));
const refusedLines = (app: SetupApp) =>
  [...q(app, "held-refused")!.querySelectorAll("p")].map((p) => p.textContent!.trim());
const refusedStoppedParts = (t: ReturnType<typeof stringsFor>) =>
  t.recoveryStoppedRefused.split("{started}");
const startAgainDeletesIt = (t: ReturnType<typeof stringsFor>) => {
  const tail = t.recoveryStopped.split("{started}")[1]!;
  const refusedTail = refusedStoppedParts(t)[1]!;
  expect(tail.startsWith(refusedTail)).toBe(true);
  return tail.slice(refusedTail.length).trim();
};
function expectStoppedRefused(app: SetupApp, t: ReturnType<typeof stringsFor>) {
  const stopped = q(app, "recovery-stopped")!.textContent!;
  for (const part of refusedStoppedParts(t)) expect(stopped).toContain(part);
  expect(text(app)).not.toContain(startAgainDeletesIt(t));
}
function expectNoHeldConfirmation(app: SetupApp, t: ReturnType<typeof stringsFor>) {
  expect(q(app, "start-again-deletes")).toBeNull();
  expect(text(app)).not.toContain(startAgainDeletesIt(t));
  for (const words of [t.heldLost, t.noInvoiceSent]) expect(text(app)).not.toContain(words);
  expect(q(app, "retire-confirmed")).toBeNull();
  expect(q(app, "confirm-start-again")).toBeNull();
}
function expectInOrder(app: SetupApp, lines: string[]) {
  const shown = [...q(app, "held-refused")!.querySelectorAll("p")];
  const order = lines.map((line) => shown.find((p) => p.textContent!.trim() === line)!);
  for (const [index, element] of order.slice(1).entries())
    expect(
      order[index]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
      String(index),
    ).toBeTruthy();
}

for (const locale of locales) {
  it(`${locale}: kept rows and an invoice record after the password: says what is kept, that it is a fault, and offers no confirmation`, async () => {
    const t = stringsFor(locale);
    const { app, requests } = await heldFixture({
      locale,
      summary: () => Response.json(stoppedSummary),
    });
    await heldPasswordAccepted(app);
    await expect.poll(() => q(app, "held-refused")).not.toBeNull();
    await app.updateComplete;
    const lines = [
      t.heldRows.replace("{rows}", "105"),
      t.heldKept.replace("{kept}", "2"),
      t.heldInvoiceOne.replace("{accepted}", "0"),
      t.heldFault,
    ];
    expect(refusedLines(app)).toEqual(lines);
    expectInOrder(app, lines);
    expectNoHeldConfirmation(app, t);
    expectStoppedRefused(app, t);
    expect(q<WtButton>(app, "cancel-start-again")!.disabled).toBe(false);
    expect(q(app, "reconnect-first")).not.toBeNull();
    expect(startAgainSends(requests)).toEqual([]);
    await click(app, "cancel-start-again");
    await expect.poll(() => q(app, "held-refused")).toBeNull();
  });

  it(`${locale}: an invoice record and no other kept row after the password: the saved items, the invoice line with no kept-items line, then the fault`, async () => {
    const t = stringsFor(locale);
    const { app } = await heldFixture({
      locale,
      summary: () => Response.json(stoppedSummary),
    });
    await heldPasswordAccepted(app);
    await expect.poll(() => q(app, "held-refused")).not.toBeNull();
    await app.updateComplete;
    const lines = [
      t.heldRows.replace("{rows}", "105"),
      t.heldInvoiceOne.replace("{accepted}", "1"),
      t.heldFault,
    ];
    expect(refusedLines(app)).toEqual(lines);
    expectInOrder(app, lines);
    expectNoHeldConfirmation(app, t);
    expectStoppedRefused(app, t);
  });

  it(`${locale}: kept rows and no invoice record after the password: the saved items, the kept-items line with no invoice line, then the fault`, async () => {
    const t = stringsFor(locale);
    const { app } = await heldFixture({
      locale,
      summary: () => Response.json(stoppedSummary),
    });
    await heldPasswordAccepted(app);
    await expect.poll(() => q(app, "held-refused")).not.toBeNull();
    await app.updateComplete;
    const lines = [
      t.heldRows.replace("{rows}", "105"),
      t.heldKept.replace("{kept}", "2"),
      t.heldFault,
    ];
    expect(refusedLines(app)).toEqual(lines);
    expectInOrder(app, lines);
    expectNoHeldConfirmation(app, t);
    expectStoppedRefused(app, t);
  });

  it(`${locale}: one kept row and several invoices use the singular and the plural`, async () => {
    const t = stringsFor(locale);
    const { app } = await heldFixture({
      locale,
      summary: () => Response.json(stoppedSummary),
    });
    await heldPasswordAccepted(app);
    await expect.poll(() => q(app, "held-refused")).not.toBeNull();
    await app.updateComplete;
    expect(refusedLines(app)).toEqual([
      t.heldRows.replace("{rows}", "105"),
      t.heldKeptOne,
      t.heldInvoices.replace("{records}", "3").replace("{accepted}", "2"),
      t.heldFault,
    ]);
  });

  it(`${locale}: saved trading settings beside a stopped recovery keep Start again disabled and say so, pointing at the password`, async () => {
    const t = stringsFor(locale);
    const { app, requests } = await heldFixture({
      locale,
      inspection: () => ({ artifacts: [tradingEnv] }),
    });
    expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
    expect(text(app)).toContain(`${t.tradingSaved} ${t.tradingSavedPassword}`);
    expect(text(app)).not.toContain(t.startUnavailableOccupied);
    expect(text(app)).not.toContain(t.startUnavailable);
    expect(q(app, "resume-password")).not.toBeNull();
    expectStoppedRefused(app, t);
    expect(startAgainSends(requests)).toEqual([]);
  });
}

it("saved trading settings beside a stopped recovery and a database with rows but no venue's say the same", async () => {
  const t = stringsFor("en-GB");
  const { app } = await heldFixture({
    inspection: () => ({
      database: "no-venue-rows",
      emptyDatabase: false,
      artifacts: [tradingEnv],
    }),
  });
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(text(app)).toContain(t.tradingSaved);
  expect(text(app)).not.toContain(t.startUnavailable);
});

it("saved trading settings where the password cannot be checked leave off the sentence about the password", async () => {
  const t = stringsFor("en-GB");
  const { app } = await heldFixture({
    inspection: () => ({ artifacts: [tradingEnv], password: "uncheckable" }),
  });
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(text(app)).toContain(t.tradingSaved);
  expect(text(app)).not.toContain(t.tradingSavedPassword);
  expect(q(app, "resume-password")).toBeNull();
});

for (const locale of locales) {
  it(`${locale}: the summary refused because the setup finished: says so, and Start again stays disabled`, async () => {
    const t = stringsFor(locale);
    const { app, requests } = await heldFixture({
      locale,
      summary: () => refusedCause("setup-finished"),
    });
    await heldPasswordAccepted(app);
    await expect.poll(() => text(app)).toContain(t.setupFinished);
    await expect.poll(() => q<WtButton>(app, "start-again")?.disabled).toBe(true);
    await settled(app);
    expect(shown(app)).not.toContain(shellFor(locale)["shell.not_ready"]);
    expect(shown(app)).not.toContain(t.recoveryDetailsUnread);
    expect(text(app)).not.toContain(t.startUnavailableOccupied);
    expectStoppedRefused(app, t);
    expect(q(app, "reconnect-first")).not.toBeNull();
    expect(startAgainSends(requests)).toEqual([]);
  });

  it(`${locale}: the summary refused because trading settings were saved since the page loaded: says so beside the password`, async () => {
    const t = stringsFor(locale);
    const { app } = await heldFixture({
      locale,
      summary: () => refusedCause("trading-settings"),
    });
    await heldPasswordAccepted(app);
    await expect.poll(() => text(app)).toContain(`${t.tradingSaved} ${t.tradingSavedPassword}`);
    await expect.poll(() => q<WtButton>(app, "start-again")?.disabled).toBe(true);
    await settled(app);
    expect(q(app, "resume-password")).not.toBeNull();
    expect(shown(app)).not.toContain(shellFor(locale)["shell.not_ready"]);
    expect(shown(app)).not.toContain(t.recoveryDetailsUnread);
  });
}

it.each(["setup-finished", "trading-settings"] as const)(
  "Start again refused at the send with %s: the page says why, and Start again stays disabled",
  async (cause) => {
    const t = stringsFor("en-GB");
    const { app, requests } = await heldFixture({ startAgain: () => refusedCause(cause) });
    await heldPasswordAccepted(app);
    await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
    await app.updateComplete;
    await click(app, "confirm-start-again");
    await expect.poll(() => startAgainSends(requests)).toHaveLength(1);
    await expect
      .poll(() => text(app))
      .toContain(cause === "setup-finished" ? t.setupFinished : t.tradingSaved);
    await expect.poll(() => q<WtButton>(app, "start-again")?.disabled).toBe(true);
    await settled(app);
    expect(shown(app)).not.toContain(t.error);
    expect(shown(app)).not.toContain(shellEn["shell.not_ready"]);
  },
);

for (const locale of locales) {
  it(`${locale}: Start again refused at the send with kept-records: says the setup database changed and asks for the password again`, async () => {
    const t = stringsFor(locale);
    const { app, requests } = await heldFixture({
      locale,
      startAgain: () => refusedCause("kept-records"),
    });
    await heldPasswordAccepted(app);
    await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
    await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
    await app.updateComplete;
    await click(app, "confirm-start-again");
    await expect.poll(() => startAgainSends(requests)).toHaveLength(1);
    await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
    await app.updateComplete;
    expect(formErrors(app)).toEqual([t.heldChanged]);
    expect(formErrors(app)).not.toContain(t.error);
    expect(q(app, "resume-password")).not.toBeNull();
  });
}

it("Start again refused at the send with a cause the page has no words for keeps the generic refusal", async () => {
  const t = stringsFor("en-GB");
  const { app, requests } = await heldFixture({ startAgain: () => refusedCause("other-cause") });
  await heldPasswordAccepted(app);
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainSends(requests)).toHaveLength(1);
  await expect.poll(() => q(app, "damaged-record-password")).not.toBeNull();
  await app.updateComplete;
  expect(formErrors(app)).toEqual([t.error]);
  expect(text(app)).not.toContain(t.setupFinished);
  expect(text(app)).not.toContain(t.tradingSaved);
});

it("Reconnect after a refusal reads the box again and forgets it", async () => {
  const t = stringsFor("en-GB");
  const { app } = await heldFixture({ summary: () => refusedCause("setup-finished") });
  await heldPasswordAccepted(app);
  await expect.poll(() => text(app)).toContain(t.setupFinished);
  await settled(app);
  await click(app, "reconnect-first");
  await expect.poll(() => q<WtButton>(app, "start-again")?.disabled).toBe(false);
  expect(text(app)).not.toContain(t.setupFinished);
});
