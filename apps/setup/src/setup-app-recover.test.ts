import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import type { SetupApp } from "./setup-app.js";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { setLocale } from "./i18n/t.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { initial } from "../test/first-setup-browser.js";
import { click, namedSummary, q } from "../test/missing-database-browser.js";
import {
  OLD_RECOVERY_ROUTE,
  OWNER_HEADER,
  cases,
  confirmation,
  fieldsIn,
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

// Recover is drawn beside a stopped recovery only from Task 2a on, so that row is not here.
for (const c of cases.filter((c) => c.activity === null))
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
