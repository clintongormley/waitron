import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import { FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { setLocale } from "./i18n/t.js";
import { initialOwnerStrings } from "./screens/initial-owner-strings.js";
import { shellEn } from "./i18n/strings/shell.js";
import { initial, wizardApi } from "../test/first-setup-browser.js";
import {
  click,
  damagedSummary,
  formErrors,
  namedSummary,
  q,
} from "../test/missing-database-browser.js";
import { refusedCause, settled } from "../test/held-database-browser.js";
import {
  OWNER_HEADER,
  cases,
  confirmation,
  fieldsIn,
  oldRecoveryRequests,
  sends,
  summaryReads,
  t,
  text,
  wipeFixture,
} from "../test/wipe-browser.js";
import type { SetupApp } from "./setup-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

beforeEach(() => sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY));
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
  await navigator.locks.request(`waitron:first-setup:attempt:${initial.attemptId}`, () => {});
});

for (const c of cases)
  it(`${c.name}: Start again asks for no password, reads the summary with no owner tab, and sends what was shown`, async () => {
    const { app, requests } = await wipeFixture({
      inspection: c.inspection,
      summary: () => Response.json(c.summary),
    });
    await click(app, "start-again");
    await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
    expect(fieldsIn(confirmation(app))).toEqual([]);
    expect(q(app, "start-again")).toBeNull();
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

for (const database of ["occupied", "missing", "corrupt"] as const)
  for (const [press, confirm] of [
    ["start-again", "confirm-start-again"],
    ["recover-backup", "confirm-recover"],
  ] as const)
    it(`setup database ${database}, ${press}: the repair page sends nothing under /resolution/backup/ on load, on the wipe or on Reconnect`, async () => {
      const { app, requests } = await wipeFixture({ inspection: { database } });
      expect(oldRecoveryRequests(requests)).toEqual([]);
      await click(app, press);
      await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
      await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
      await click(app, confirm);
      await expect.poll(() => sends(requests).length).toBe(1);
      expect(oldRecoveryRequests(requests)).toEqual([]);
      const before = requests.length;
      await click(app, "reconnect-first");
      await expect.poll(() => requests.length).toBeGreaterThan(before);
      await settled(app);
      expect(oldRecoveryRequests(requests)).toEqual([]);
    });

it("an ordinary first setup resumed in a tab that holds its session sends nothing under /resolution/backup/", async () => {
  sessionStorage.setItem(
    FIRST_SETUP_SESSION_KEY,
    JSON.stringify({
      version: 1,
      tabLockId: "N".repeat(43),
      claimPending: false,
      owner: {
        attemptId: initial.attemptId,
        revision: 1,
        ownerGeneration: 1,
        capability: "A".repeat(43),
      },
    }),
  );
  const { api, requests } = wizardApi({ claimed: true });
  const { el: app } = await mountWidget<SetupApp>("setup-app", {
    api,
    browserLanguages: ["en-GB"],
  });
  await expect.poll(() => q(app, "screen-cert")).not.toBeNull();
  expect(requests.some((r) => r.headers.has(OWNER_HEADER))).toBe(true);
  expect(oldRecoveryRequests(requests)).toEqual([]);
});

it("with the setup database missing and the setup finished, Start again draws the box's refusal and is no longer offered", async () => {
  const { app } = await wipeFixture({
    inspection: { database: "missing" },
    summary: () => refusedCause("setup-finished"),
  });
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

it("where the setup record cannot be read, Start again is not offered and no summary is read", async () => {
  const { app, requests } = await wipeFixture({
    inspection: { pair: "invalid", revision: null, ownerGeneration: null },
  });
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(summaryReads(requests)).toEqual([]);
});

it("where the setup record pair is repairable, Start again is offered", async () => {
  const { app } = await wipeFixture({ inspection: { pair: "repairable" } });
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
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

it("a summary read that fails draws the error beside Start again, still offered", async () => {
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
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
  fail = false;
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
});

const locales = [
  ["en-GB", "en"],
  ["es-ES", "es"],
] as const;
const refusals: { name: string; summary: () => Response; words: (lang: "en" | "es") => string }[] =
  [
    {
      name: "the setup finished",
      summary: () => refusedCause("setup-finished"),
      words: (lang) => initialOwnerStrings[lang].setupFinished,
    },
    {
      name: "the setup database holds records Waitron never deletes",
      summary: () => refusedCause("kept-records"),
      words: (lang) => initialOwnerStrings[lang].keptFault,
    },
    {
      name: "the box answers setup.connection_insecure",
      summary: () =>
        Response.json(
          { error: { code: "setup.connection_insecure", params: {} } },
          { status: 403 },
        ),
      words: (lang) => initialOwnerStrings[lang].wipeInsecure,
    },
    {
      name: "the box answers setup.not_ready",
      summary: () =>
        Response.json({ error: { code: "setup.not_ready", params: {} } }, { status: 409 }),
      words: (lang) => initialOwnerStrings[lang].wipeFault,
    },
    ...(
      [
        ["may-have-filed", "wipeMayHaveFiled"],
        ["unexpected", "wipeUnexpected"],
        ["too-large", "wipeTooLarge"],
        ["unreadable", "wipeUnreadable"],
      ] as const
    ).map(([cause, key]) => ({
      name: `the box answers setup.not_ready for ${cause}`,
      summary: () =>
        Response.json({ error: { code: "setup.not_ready", params: { cause } } }, { status: 503 }),
      words: (lang: "en" | "es") => initialOwnerStrings[lang][key],
    })),
  ];

it.each([
  "wipeMayHaveFiled",
  "wipeUnexpected",
  "wipeTooLarge",
  "wipeUnreadable",
  "wipeFault",
  "wipeInsecure",
] as const)("%s has English and Spanish words, and they differ", (key) => {
  expect(initialOwnerStrings.en[key]).toMatch(/\S/);
  expect(initialOwnerStrings.es[key]).toMatch(/\S/);
  expect(initialOwnerStrings.es[key]).not.toBe(initialOwnerStrings.en[key]);
});

for (const [locale, lang] of locales)
  for (const r of refusals)
    it(`in ${locale}, where ${r.name}, Start again draws the box's words and is no longer offered`, async () => {
      const { app } = await wipeFixture({ summary: r.summary });
      setLocale(locale);
      await app.updateComplete;
      await click(app, "start-again");
      await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
      await settled(app);
      expect(q(app, "start-again-refused")!.textContent).toBe(r.words(lang));
      expect(q(app, "start-again")).toBeNull();
      expect(q(app, "retire-confirmed")).toBeNull();
    });

it("where the box answers setup.connection_insecure, the link to set up the secure connection stays", async () => {
  const { app } = await wipeFixture({
    summary: () =>
      Response.json({ error: { code: "setup.connection_insecure", params: {} } }, { status: 403 }),
  });
  await click(app, "start-again");
  await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
  await settled(app);
  expect(q(app, "start-again-refused")!.textContent).toBe(initialOwnerStrings.en.wipeInsecure);
  expect(q<HTMLAnchorElement>(app, "secure-connection")!.getAttribute("href")).toBe(
    "/setup/connection",
  );
});

for (const [locale, lang] of locales)
  it(`in ${locale}, a setup database the box cannot read all of is named above what Start again deletes, with no line about invoices`, async () => {
    const strings = initialOwnerStrings[lang];
    const { app } = await wipeFixture({
      summary: () => Response.json({ ...namedSummary, databaseUnreadable: true }),
    });
    setLocale(locale);
    await app.updateComplete;
    await click(app, "start-again");
    await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
    const line = q(app, "setup-database-unreadable");
    expect(line!.textContent).toBe(strings.setupDatabaseUnreadable);
    const deletes = q(app, "start-again-deletes")!;
    expect(deletes.textContent!.trim()).toBe(strings.heldLost);
    expect(line!.compareDocumentPosition(deletes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

for (const [locale, lang] of locales)
  it(`in ${locale}, where the setup record cannot be read, the page says deleting is not offered`, async () => {
    const strings = initialOwnerStrings[lang];
    const { app } = await wipeFixture({
      inspection: { pair: "invalid", revision: null, ownerGeneration: null },
    });
    setLocale(locale);
    await app.updateComplete;
    expect(q(app, "start-again-refused")!.textContent).toBe(strings.wipeUnavailable);
  });

it("a summary that changed after the confirmation was drawn closes it, says the setup changed, and Start again then opens on the new summary", async () => {
  let reads = 0;
  const { app, requests } = await wipeFixture({
    summary: () => Response.json(reads++ === 0 ? namedSummary : damagedSummary),
  });
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "retire-confirmed")).toBeNull();
  await settled(app);
  expect(formErrors(app)).toContain(t.heldChanged);
  expect(sends(requests)).toEqual([]);
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(false);
  await expect.poll(() => app.shadowRoot!.activeElement).toBe(q(app, "start-again"));
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  expect(q(app, "recovery-record-damaged")).not.toBeNull();
});

it("a send refused setup.not_ready closes the confirmation, draws the box's words and offers no Start again", async () => {
  const { app } = await wipeFixture({
    startAgain: () =>
      Response.json({ error: { code: "setup.not_ready", params: {} } }, { status: 409 }),
  });
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
  await settled(app);
  expect(q(app, "start-again-refused")!.textContent).toBe(t.wipeFault);
  expect(q(app, "retire-confirmed")).toBeNull();
  expect(q(app, "start-again")).toBeNull();
  await expect.poll(() => app.shadowRoot!.activeElement).toBe(q(app, "start-again-refused"));
});

it("Start again reads and sends with the setup as read on pressing, not as first drawn", async () => {
  const { app, requests } = await wipeFixture({
    inspectionAt: (read) => (read === 0 ? {} : { inspectionId: "b".repeat(64), revision: 2 }),
  });
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => sends(requests).length).toBe(1);
  for (const r of [...summaryReads(requests), ...sends(requests)])
    expect(r.body).toMatchObject({ inspectionId: "b".repeat(64), revision: 2 });
});

it("where the setup as read on pressing can no longer be deleted, no summary is read and the page says so", async () => {
  const { app, requests } = await wipeFixture({
    inspectionAt: (read) =>
      read === 0 ? {} : { pair: "invalid", revision: null, ownerGeneration: null },
  });
  await click(app, "start-again");
  await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
  await settled(app);
  expect(q(app, "start-again-refused")!.textContent).toBe(t.wipeUnavailable);
  expect(q<WtButton>(app, "start-again")!.disabled).toBe(true);
  expect(summaryReads(requests)).toEqual([]);
});

it("pressing Start again moves focus to the confirmation's tick box", async () => {
  const { app } = await wipeFixture();
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await expect.poll(() => app.shadowRoot!.activeElement).toBe(q(app, "retire-confirmed"));
});

it("a refusal drawn on pressing Start again takes the focus in the button's place", async () => {
  const { app } = await wipeFixture({ summary: () => refusedCause("kept-records") });
  await click(app, "start-again");
  await expect.poll(() => q(app, "start-again-refused")).not.toBeNull();
  await expect.poll(() => app.shadowRoot!.activeElement).toBe(q(app, "start-again-refused"));
});

it("focus the person moved elsewhere while the summary loads stays there", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { app } = await wipeFixture({
    summary: async () => {
      await gate;
      return Response.json(namedSummary);
    },
  });
  await click(app, "start-again");
  await expect.poll(() => text(app)).toContain(t.waiting);
  const chooser = app.shadowRoot!.querySelector<HTMLElement>("wt-language-chooser")!;
  chooser
    .shadowRoot!.querySelector("[data-test=lang-trigger]")!
    .shadowRoot!.querySelector("button")!
    .focus();
  expect(app.shadowRoot!.activeElement).toBe(chooser);
  release();
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await app.updateComplete;
  expect(app.shadowRoot!.activeElement).toBe(chooser);
});

it("an answer to Start again that does not confirm the restart says to reconnect and check, never that the setup changed", async () => {
  const { app } = await wipeFixture({ startAgain: () => Response.json({}) });
  await click(app, "start-again");
  await expect.poll(() => q(app, "retire-confirmed")).not.toBeNull();
  await userEvent.click(q<HTMLInputElement>(app, "retire-confirmed")!);
  await click(app, "confirm-start-again");
  await expect.poll(() => formErrors(app)).toContain(t.error);
  expect(formErrors(app)).not.toContain(t.heldChanged);
  expect(text(app)).not.toContain(t.restarting);
});
