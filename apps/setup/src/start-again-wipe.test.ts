import { expect, it } from "vitest";
import { SetupApi } from "./api/client.js";
import type { FirstSetupInspection, StartAgainSummary } from "./api/first-setup-types.js";
import { startAgainRefusalCause } from "./first-setup-session.js";
import { readWipeSummary, sendWipe, wipeRefusal } from "./start-again-wipe.js";

const snapshot = { inspectionId: "b".repeat(64), revision: 2, ownerGeneration: 2 };
const shown: StartAgainSummary = { reached: "named" };
const recovery = {
  startedAt: "2026-10-16T13:00:00.000Z",
  lastActiveAt: "2026-10-16T13:10:00.000Z",
  lastActiveSource: "memory",
  failed: false,
  cloud: false,
} as const;
const stopped = { ...shown, recovery } as const satisfies StartAgainSummary;
const unreadable = { ...shown, databaseUnreadable: true } as const satisfies StartAgainSummary;
const damagedRecord = {
  ...shown,
  recoveryRecordDamaged: true,
} as const satisfies StartAgainSummary;

function fixture(
  options: {
    summary?: unknown;
    result?: unknown;
    intercept?: (path: string) => Response | undefined;
  } = {},
) {
  const requests: { path: string; body: unknown; headers: Headers }[] = [];
  const api = new SetupApi("", async (url, init) => {
    const path = String(url);
    requests.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init?.headers),
    });
    const intercepted = options.intercept?.(path);
    if (intercepted !== undefined) return intercepted;
    if (path.endsWith("/start-again/summary"))
      return Response.json("summary" in options ? options.summary : shown);
    if (path.endsWith("/start-again")) return Response.json(options.result ?? { restarting: true });
    return Response.json({ error: { code: "unexpected" } }, { status: 500 });
  });
  const sent = () => requests.filter((r) => r.path.endsWith("/start-again"));
  return { api, requests, sent };
}

it.each<StartAgainSummary>([
  shown,
  damagedRecord,
  stopped,
  unreadable,
  { ...stopped, ...unreadable },
])(
  "readWipeSummary reads the summary %j for the snapshot alone, with no owner header",
  async (summary) => {
    const { api, requests } = fixture({ summary });
    await expect(readWipeSummary(api, snapshot)).resolves.toEqual(summary);
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/resolution/start-again/summary",
    ]);
    expect(requests[0]!.body).toEqual(snapshot);
    expect(requests[0]!.headers.has("X-Waitron-Setup-Owner")).toBe(false);
  },
);
it.each([
  { name: "an unknown stage", summary: { reached: "unknown" } },
  { name: "a retired name", summary: { reached: "named", lastName: "0CNQT" } },
  { name: "an extra key", summary: { reached: "named", extra: true } },
  {
    name: "a false damaged-record flag",
    summary: { reached: "named", recoveryRecordDamaged: false },
  },
  { name: "a false unreadable flag", summary: { reached: "named", databaseUnreadable: false } },
  {
    name: "a recovery missing a field",
    summary: { reached: "named", recovery: { ...recovery, cloud: undefined } },
  },
  {
    name: "an unknown recovery activity source",
    summary: { reached: "named", recovery: { ...recovery, lastActiveSource: "guess" } },
  },
  {
    name: "a recovery start that is not text",
    summary: { reached: "named", recovery: { ...recovery, startedAt: 1 } },
  },
  {
    name: "a recovery with an extra key",
    summary: { reached: "named", recovery: { ...recovery, extra: true } },
  },
  { name: "null", summary: null },
])("readWipeSummary refuses an unreadable summary ($name)", async ({ summary }) => {
  const { api } = fixture({ summary });
  await expect(readWipeSummary(api, snapshot)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});
it("a summary carrying held is refused as unreadable", async () => {
  const { api, sent } = fixture({
    summary: { ...shown, held: { rows: 20, kept: 0, records: 0, accepted: 0 } },
  });
  await expect(readWipeSummary(api, snapshot)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(sendWipe(api, snapshot, "occupied", shown)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(sent()).toHaveLength(0);
});

it.each<{
  name: string;
  database: FirstSetupInspection["database"];
  summary: StartAgainSummary;
  confirm: Record<string, unknown>;
}>([
  {
    name: "a missing database",
    database: "missing",
    summary: shown,
    confirm: { confirmMissingDatabase: { nothingFiledOrSold: true, shown } },
  },
  {
    name: "a missing database with a damaged recovery-key record",
    database: "missing",
    summary: damagedRecord,
    confirm: { confirmMissingDatabase: { nothingFiledOrSold: true, shown: damagedRecord } },
  },
  {
    name: "a missing database beside a stopped recovery",
    database: "missing",
    summary: stopped,
    confirm: { confirmMissingDatabase: { nothingFiledOrSold: true, shown: stopped } },
  },
  {
    name: "a present database beside a stopped recovery",
    database: "occupied",
    summary: stopped,
    confirm: { confirmRecoveryDiscard: { shown: stopped } },
  },
  {
    name: "a damaged database",
    database: "corrupt",
    summary: unreadable,
    confirm: { confirmUnreadableDatabase: { shown: unreadable } },
  },
  {
    name: "a damaged database beside a stopped recovery",
    database: "corrupt",
    summary: { ...stopped, ...unreadable },
    confirm: { confirmRecoveryDiscard: { shown: { ...stopped, ...unreadable } } },
  },
  {
    name: "a readable held database with no stopped recovery",
    database: "occupied",
    summary: shown,
    confirm: {},
  },
  {
    name: "an empty database",
    database: "no-venue-rows",
    summary: shown,
    confirm: {},
  },
  {
    name: "an empty database with a damaged recovery-key record",
    database: "no-venue-rows",
    summary: damagedRecord,
    confirm: { recoveryRecordDamagedShown: true },
  },
  {
    name: "a stopped recovery and a damaged recovery-key record",
    database: "no-venue-rows",
    summary: { ...stopped, ...damagedRecord },
    confirm: {
      confirmRecoveryDiscard: { shown: { ...stopped, ...damagedRecord } },
      recoveryRecordDamagedShown: true,
    },
  },
  {
    name: "a damaged database and a damaged recovery-key record",
    database: "corrupt",
    summary: { ...unreadable, ...damagedRecord },
    confirm: {
      confirmUnreadableDatabase: { shown: { ...unreadable, ...damagedRecord } },
      recoveryRecordDamagedShown: true,
    },
  },
])(
  "sendWipe for $name reads the summary again and sends exactly its confirmation, with no owner header",
  async ({ database, summary, confirm }) => {
    const { api, requests } = fixture({ summary });
    await expect(sendWipe(api, snapshot, database, summary)).resolves.toEqual({
      restarting: true,
    });
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/resolution/start-again/summary",
      "/setup-api/first-setup/resolution/start-again",
    ]);
    expect(requests[0]!.body).toEqual(snapshot);
    expect(requests[1]!.body).toEqual({ ...snapshot, ...confirm });
    expect(requests.some((r) => r.headers.has("X-Waitron-Setup-Owner"))).toBe(false);
  },
);
it("a stopped recovery and a damaged recovery-key record send confirmRecoveryDiscard and recoveryRecordDamagedShown together", async () => {
  const both = { ...stopped, ...damagedRecord };
  const { api, sent } = fixture({ summary: both });
  await sendWipe(api, snapshot, "occupied", both);
  expect(sent()[0]!.body).toEqual({
    ...snapshot,
    confirmRecoveryDiscard: { shown: both },
    recoveryRecordDamagedShown: true,
  });
});

it.each<{ name: string; summary: StartAgainSummary; shown: StartAgainSummary }>([
  { name: "what the setup reached", summary: { reached: "fiscal-finished" }, shown },
  { name: "a recovery-key record turned damaged", summary: damagedRecord, shown },
  { name: "a recovery-key record no longer damaged", summary: shown, shown: damagedRecord },
  { name: "a stopped recovery appeared", summary: stopped, shown },
  { name: "the stopped recovery gone", summary: shown, shown: stopped },
  {
    name: "the stopped recovery's last activity",
    summary: { ...stopped, recovery: { ...recovery, lastActiveAt: "2026-10-16T13:20:00.000Z" } },
    shown: stopped,
  },
  {
    name: "the stopped recovery now failed",
    summary: { ...stopped, recovery: { ...recovery, failed: true } },
    shown: stopped,
  },
  {
    name: "the stopped recovery's start",
    summary: { ...stopped, recovery: { ...recovery, startedAt: "2026-10-16T12:00:00.000Z" } },
    shown: stopped,
  },
  {
    name: "where the stopped recovery's last activity was read from",
    summary: { ...stopped, recovery: { ...recovery, lastActiveSource: "saved-step" } },
    shown: stopped,
  },
  {
    name: "the stopped recovery now from the cloud",
    summary: { ...stopped, recovery: { ...recovery, cloud: true } },
    shown: stopped,
  },
  { name: "the database turned unreadable", summary: unreadable, shown },
  { name: "the database readable again", summary: shown, shown: unreadable },
])(
  "sendWipe refuses a summary that changed between display and confirmation ($name), and sends nothing",
  async ({ summary, shown: displayed }) => {
    for (const database of ["missing", "occupied", "corrupt"] as const) {
      const { api, sent } = fixture({ summary });
      await expect(sendWipe(api, snapshot, database, displayed)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
      expect(sent()).toHaveLength(0);
    }
  },
);
it("sendWipe refuses an unreadable summary at the send, and sends nothing", async () => {
  const { api, sent } = fixture({ summary: { reached: "named", extra: true } });
  await expect(sendWipe(api, snapshot, "missing", shown)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(sent()).toHaveLength(0);
});
it.each([{ restarting: false }, {}])(
  "sendWipe does not accept an incomplete restart answer %j",
  async (result) => {
    const { api } = fixture({ result });
    const failure = await sendWipe(api, snapshot, "missing", shown).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as { code?: unknown }).code).toBeUndefined();
  },
);

const refused = (params: unknown) =>
  Response.json({ error: { code: "setup.start_again_refused", params } }, { status: 409 });
it.each(["trading-settings", "setup-finished", "kept-records"] as const)(
  "a Start again refused for %s reaches the page with its cause, from the summary and from the send",
  async (cause) => {
    const fromSummary = await readWipeSummary(
      fixture({ intercept: (path) => (path.endsWith("/summary") ? refused({ cause }) : undefined) })
        .api,
      snapshot,
    ).catch((error: unknown) => error);
    expect(fromSummary).toMatchObject({ code: "setup.start_again_refused", status: 409 });
    expect(startAgainRefusalCause(fromSummary)).toBe(cause);
    expect(wipeRefusal(fromSummary)).toBe(cause);
    const { api, requests } = fixture({
      intercept: (path) => (path.endsWith("/start-again") ? refused({ cause }) : undefined),
    });
    const fromSend = await sendWipe(api, snapshot, "occupied", shown).catch(
      (error: unknown) => error,
    );
    expect(requests).toHaveLength(2);
    expect(fromSend).toMatchObject({ code: "setup.start_again_refused", status: 409 });
    expect(wipeRefusal(fromSend)).toBe(cause);
  },
);
it.each([
  { name: "setup.not_ready", error: { code: "setup.not_ready" }, cause: "unavailable" },
  { name: "setup.owner_required", error: { code: "setup.owner_required" }, cause: "unavailable" },
  {
    name: "an unknown refusal cause",
    error: { code: "setup.start_again_refused", params: { cause: "x" } },
    cause: undefined,
  },
  { name: "another code", error: { code: "setup.attempt_conflict" }, cause: undefined },
  { name: "storage.disk_full", error: { code: "storage.disk_full" }, cause: undefined },
  { name: "a thrown Error", error: new Error("no"), cause: undefined },
  { name: "null", error: null, cause: undefined },
])("wipeRefusal names $name as $cause", ({ error, cause }) => {
  expect(wipeRefusal(error)).toBe(cause);
});
