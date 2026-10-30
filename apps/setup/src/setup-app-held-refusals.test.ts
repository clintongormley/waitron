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
import { heldFixture, refusedCause, settled, tradingEnv } from "../test/held-database-browser.js";
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
function expectNoConfirmation(app: SetupApp, t: ReturnType<typeof stringsFor>) {
  expect(q(app, "start-again-deletes")).toBeNull();
  expect(text(app)).not.toContain(startAgainDeletesIt(t));
  for (const words of [t.heldLost, t.noInvoiceSent]) expect(text(app)).not.toContain(words);
  expect(q(app, "retire-confirmed")).toBeNull();
  expect(q(app, "confirm-start-again")).toBeNull();
}
const refusalWords = (app: SetupApp) => q(app, "start-again-refused")?.textContent!.trim();
async function confirmAndSend(app: SetupApp, requests: { path: string }[]) {
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await app.updateComplete;
  await click(app, "confirm-start-again");
  await expect.poll(() => startAgainSends(requests)).toHaveLength(1);
}

for (const locale of locales) {
  it(`${locale}: a send refused kept-records after the confirmation closes it, says the setup changed, and Start again then draws the fault`, async () => {
    const t = stringsFor(locale);
    let summaries = 0;
    const { app, requests } = await heldFixture({
      locale,
      // The first read draws the confirmation and the second is the send's own check.
      summary: () =>
        summaries++ < 2 ? Response.json(stoppedSummary) : refusedCause("kept-records"),
      startAgain: () => refusedCause("kept-records"),
    });
    await confirmAndSend(app, requests);
    await expect.poll(() => q(app, "retire-confirmed")).toBeNull();
    await settled(app);
    expect(formErrors(app)).toContain(t.heldChanged);
    expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
    await click(app, "start-again");
    await expect.poll(() => refusalWords(app)).toBe(t.keptFault);
    await settled(app);
    expect(formErrors(app)).not.toContain(t.heldChanged);
    expect(q(app, "start-again")).toBeNull();
    expectNoConfirmation(app, t);
    expectStoppedRefused(app, t);
    expect(startAgainSends(requests)).toHaveLength(1);
  });
}

for (const locale of locales) {
  it(`${locale}: a summary refused kept-records beside a stopped recovery: draws the fault and offers no confirmation`, async () => {
    const t = stringsFor(locale);
    const { app, requests } = await heldFixture({
      locale,
      summary: () => refusedCause("kept-records"),
    });
    await click(app, "start-again");
    await expect.poll(() => refusalWords(app)).toBe(t.keptFault);
    await settled(app);
    expectNoConfirmation(app, t);
    expectStoppedRefused(app, t);
    expect(q(app, "start-again")).toBeNull();
    expect(q(app, "reconnect-first")).not.toBeNull();
    expect(startAgainSends(requests)).toEqual([]);
  });

  it(`${locale}: saved trading settings beside a stopped recovery draw nothing on load; pressing Start again draws the box's words beside the password`, async () => {
    const t = stringsFor(locale);
    const { app, requests } = await heldFixture({
      locale,
      inspection: () => ({ artifacts: [tradingEnv] }),
      summary: () => refusedCause("trading-settings"),
    });
    await settled(app);
    expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
    expect(text(app)).not.toContain(t.tradingSaved);
    expect(q(app, "start-again-refused")).toBeNull();
    await click(app, "start-again");
    await expect.poll(() => refusalWords(app)).toBe(`${t.tradingSaved} ${t.tradingSavedPassword}`);
    await settled(app);
    expect(text(app)).not.toContain(t.wipeUnavailable);
    expect(q(app, "start-again")).toBeNull();
    expect(q(app, "resume-password")).not.toBeNull();
    expectStoppedRefused(app, t);
    expect(startAgainSends(requests)).toEqual([]);
  });
}

it("saved trading settings beside a stopped recovery and a database with rows but no venue's say the same once Start again is pressed", async () => {
  const t = stringsFor("en-GB");
  const { app } = await heldFixture({
    inspection: () => ({
      database: "no-venue-rows",
      emptyDatabase: false,
      artifacts: [tradingEnv],
    }),
    summary: () => refusedCause("trading-settings"),
  });
  await settled(app);
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
  expect(text(app)).not.toContain(t.tradingSaved);
  await click(app, "start-again");
  await expect.poll(() => refusalWords(app)).toBe(`${t.tradingSaved} ${t.tradingSavedPassword}`);
  expect(text(app)).not.toContain(t.wipeUnavailable);
});

it("saved trading settings where the setup record cannot be read: no Start again, and the page says the password cannot be checked and deleting is not offered", async () => {
  const t = stringsFor("en-GB");
  const { app, requests } = await heldFixture({
    inspection: () => ({
      artifacts: [tradingEnv],
      password: "uncheckable",
      revision: null,
      ownerGeneration: null,
    }),
  });
  await settled(app);
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(text(app)).toContain(t.uncheckable);
  expect(refusalWords(app)).toBe(t.wipeUnavailable);
  expect(text(app)).not.toContain(t.tradingSaved);
  expect(q(app, "resume-password")).toBeNull();
  expect(requests.filter((r) => r.path.endsWith("/start-again/summary"))).toEqual([]);
});

for (const locale of locales) {
  it(`${locale}: the summary refused because the setup finished: says so, and Start again is no longer offered`, async () => {
    const t = stringsFor(locale);
    const { app, requests } = await heldFixture({
      locale,
      summary: () => refusedCause("setup-finished"),
    });
    await click(app, "start-again");
    await expect.poll(() => refusalWords(app)).toBe(t.setupFinished);
    await settled(app);
    expect(q(app, "start-again")).toBeNull();
    expect(shown(app)).not.toContain(shellFor(locale)["shell.not_ready"]);
    expect(shown(app)).not.toContain(t.recoveryDetailsUnread);
    expect(text(app)).not.toContain(t.wipeUnavailable);
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
    await click(app, "start-again");
    await expect.poll(() => text(app)).toContain(`${t.tradingSaved} ${t.tradingSavedPassword}`);
    await settled(app);
    expect(q(app, "start-again")).toBeNull();
    expect(q(app, "resume-password")).not.toBeNull();
    expect(shown(app)).not.toContain(shellFor(locale)["shell.not_ready"]);
    expect(shown(app)).not.toContain(t.recoveryDetailsUnread);
  });
}

it.each(["setup-finished", "trading-settings"] as const)(
  "Start again refused at the send with %s: the page says why, and Start again is no longer offered",
  async (cause) => {
    const t = stringsFor("en-GB");
    const { app, requests } = await heldFixture({ startAgain: () => refusedCause(cause) });
    await confirmAndSend(app, requests);
    await expect
      .poll(() => text(app))
      .toContain(cause === "setup-finished" ? t.setupFinished : t.tradingSaved);
    await settled(app);
    expect(q(app, "start-again")).toBeNull();
    expect(q(app, "retire-confirmed")).toBeNull();
    expect(shown(app)).not.toContain(t.error);
    expect(shown(app)).not.toContain(shellEn["shell.not_ready"]);
  },
);

it("Start again refused at the send with a cause the page has no words for keeps the confirmation and the generic refusal", async () => {
  const t = stringsFor("en-GB");
  const { app, requests } = await heldFixture({ startAgain: () => refusedCause("other-cause") });
  await confirmAndSend(app, requests);
  await settled(app);
  expect(q(app, "retire-confirmed")).not.toBeNull();
  expect(formErrors(app)).toContain(t.error);
  expect(text(app)).not.toContain(t.setupFinished);
  expect(text(app)).not.toContain(t.tradingSaved);
  expect(q(app, "start-again-refused")).toBeNull();
});

it("Reconnect after a refusal reads the box again and forgets it", async () => {
  const t = stringsFor("en-GB");
  const { app } = await heldFixture({ summary: () => refusedCause("setup-finished") });
  await click(app, "start-again");
  await expect.poll(() => text(app)).toContain(t.setupFinished);
  await settled(app);
  await click(app, "reconnect-first");
  await expect.poll(() => q<WtButton>(app, "start-again")?.disabled).toBe(false);
  expect(text(app)).not.toContain(t.setupFinished);
});
