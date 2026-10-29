import { afterEach, expect, it } from "vitest";
import { SetupApi } from "./api/client.js";
import type {
  FirstSetupInspection,
  FirstSetupState,
  StartAgainSummary,
} from "./api/first-setup-types.js";
import {
  FirstSetupSession,
  FIRST_SETUP_SESSION_KEY,
  startAgainRefusalCause,
} from "./first-setup-session.js";
import { initial } from "../test/first-setup-browser.js";

const sessions: FirstSetupSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
const snapshot = { inspectionId: "a".repeat(64), revision: 1, ownerGeneration: 1 };
const shown: StartAgainSummary = { reached: "named" };
async function fixture(
  options: {
    status?: FirstSetupState["status"];
    inspection?: Partial<FirstSetupInspection>;
    result?: unknown;
    summary?: StartAgainSummary;
    intercept?: (path: string) => Response | Promise<Response> | undefined;
  } = {},
) {
  const state = {
    ...initial,
    revision: 2,
    ownerGeneration: 2,
    status: options.status ?? "claimed",
  };
  const requests: { path: string; body: unknown; headers: Headers }[] = [];
  const api = new SetupApi("", async (url, init) => {
    const path = String(url);
    requests.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init?.headers),
    });
    const result = options.intercept?.(path);
    if (result !== undefined) return result;
    if (path.endsWith("/recover"))
      return Response.json({ state, capability: "B".repeat(43), ownerGeneration: 2 });
    if (path.endsWith("/resolution"))
      return Response.json({
        version: 2,
        inspectionId: "b".repeat(64),
        pair: "valid",
        database: "missing",
        password: "checkable",
        revision: 2,
        ownerGeneration: 2,
        emptyDatabase: false,
        repairEligible: false,
        artifacts: [],
        ...options.inspection,
      });
    if (path.endsWith("/start-again/summary")) return Response.json(options.summary ?? shown);
    if (path.endsWith("/start-again")) return Response.json(options.result ?? { restarting: true });
    return Response.json({ claimed: true, state });
  });
  const session = new FirstSetupSession(api);
  sessions.push(session);
  await session.open();
  await session.recover(snapshot, "original password");
  return { session, requests };
}
it.each(["claimed", "consumption-intent", "abandoned"] as const)(
  "retires recovered %s work and requires password recovery even after a refresh",
  async (status) => {
    const { session, requests } = await fixture({ status });
    await expect(session.retireMissingDatabase(shown)).resolves.toEqual({ restarting: true });
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/resolution/recover",
      "/setup-api/first-setup/resolution",
      "/setup-api/first-setup/resolution/start-again/summary",
      "/setup-api/first-setup/resolution/start-again",
    ]);
    expect(requests[3]!.body).toEqual({
      inspectionId: "b".repeat(64),
      revision: 2,
      ownerGeneration: 2,
      confirmMissingDatabase: { nothingFiledOrSold: true, shown },
    });
    expect(requests[3]!.headers.get("X-Waitron-Setup-Owner")).toBe("B".repeat(43));
    await session.refresh();
    await expect(session.retireMissingDatabase(shown)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(1);
  },
);
it.each([
  { revision: 3 },
  { ownerGeneration: 3 },
  { inspectionId: "bad" },
  { pair: "invalid" as const },
  { database: "occupied" as const },
  { database: "no-venue-rows" as const, emptyDatabase: true },
  { database: "unknown" as const },
  { password: "uncheckable" as const },
])("rejects changed evidence %j before retirement", async (inspection) => {
  const { session, requests } = await fixture({ inspection });
  await expect(session.retireMissingDatabase(shown)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(session.recoveryRequired).toBe(true);
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});
it.each(["activation-started", "committed", "publication", "uncertain"] as const)(
  "proceeds to the inspection and summary for %s work",
  async (status) => {
    const summary = { reached: "fiscal-started" } as const;
    const { session, requests } = await fixture({ status, summary });
    await expect(session.retireMissingDatabase(summary)).resolves.toEqual({ restarting: true });
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/resolution/recover",
      "/setup-api/first-setup/resolution",
      "/setup-api/first-setup/resolution/start-again/summary",
      "/setup-api/first-setup/resolution/start-again",
    ]);
  },
);
it("refuses a summary that changed between display and confirmation, and sends nothing", async () => {
  const { session, requests } = await fixture({
    summary: { reached: "fiscal-finished" },
  });
  await expect(session.retireMissingDatabase(shown)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});
it.each([
  { reached: "unknown" },
  { reached: "named", lastName: "0CNQT" },
  { reached: "named", extra: true },
  { reached: "named", recoveryRecordDamaged: false },
  null,
])("refuses an unreadable summary %j, and sends nothing", async (summary) => {
  const { session, requests } = await fixture({
    intercept: (path) => (path.endsWith("/summary") ? Response.json(summary) : undefined),
  });
  await expect(session.missingDatabaseSummary()).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(session.retireMissingDatabase(shown)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});
it("reads a damaged-record summary and sends it back unchanged", async () => {
  const damaged = { reached: "named", recoveryRecordDamaged: true } as const;
  const { session, requests } = await fixture({ summary: damaged });
  await expect(session.missingDatabaseSummary()).resolves.toEqual(damaged);
  await expect(session.retireMissingDatabase(damaged)).resolves.toEqual({ restarting: true });
  expect(requests.at(-1)!.body).toMatchObject({
    confirmMissingDatabase: { nothingFiledOrSold: true, shown: damaged },
  });
});
it("refuses a summary that turned damaged between display and confirmation, and sends nothing", async () => {
  const { session, requests } = await fixture({
    summary: { ...shown, recoveryRecordDamaged: true },
  });
  await expect(session.retireMissingDatabase(shown)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});
const held = {
  ...shown,
  held: { rows: 20, kept: 0, records: 0, accepted: 0 },
} as const satisfies StartAgainSummary;
it("reads a summary naming what the setup database holds and sends it back unchanged", async () => {
  const { session, requests } = await fixture({ summary: held });
  await expect(session.missingDatabaseSummary()).resolves.toEqual(held);
  await expect(session.retireMissingDatabase(held)).resolves.toEqual({ restarting: true });
  expect(requests.at(-1)!.body).toMatchObject({
    confirmMissingDatabase: { nothingFiledOrSold: true, shown: held },
  });
});
it.each([
  { name: "a row more", summary: { ...held, held: { ...held.held, rows: 21 } }, shown: held },
  { name: "a kept row more", summary: { ...held, held: { ...held.held, kept: 1 } }, shown: held },
  {
    name: "an invoice record more",
    summary: { ...held, held: { ...held.held, records: 1 } },
    shown: held,
  },
  {
    name: "an accepted record more",
    summary: { ...held, held: { ...held.held, records: 1, accepted: 1 } },
    shown: { ...held, held: { ...held.held, records: 1 } },
  },
  { name: "the counts gone", summary: shown, shown: held },
  { name: "the counts appeared", summary: held, shown },
])(
  "refuses a summary whose held counts changed between display and confirmation ($name), and sends nothing",
  async ({ summary, shown: displayed }) => {
    const { session, requests } = await fixture({ summary });
    await expect(session.retireMissingDatabase(displayed)).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);
it.each([
  null,
  20,
  {},
  { rows: 20, kept: 0, records: 0 },
  { rows: 20, kept: 0, records: 0, accepted: 0, extra: 0 },
  { rows: -1, kept: 0, records: 0, accepted: 0 },
  { rows: 20, kept: -1, records: 0, accepted: 0 },
  { rows: 20, kept: 0, records: -1, accepted: 0 },
  { rows: 20, kept: 0, records: 1, accepted: -1 },
  { rows: 20.5, kept: 0, records: 0, accepted: 0 },
  { rows: "20", kept: 0, records: 0, accepted: 0 },
  { rows: Number.MAX_SAFE_INTEGER + 2, kept: 0, records: 0, accepted: 0 },
  { rows: 20, kept: 0, records: 1, accepted: 2 },
  { rows: 20, kept: 21, records: 0, accepted: 0 },
])("refuses a summary with held counts %j, and sends nothing", async (value) => {
  const { session, requests } = await fixture({
    intercept: (path) =>
      path.endsWith("/summary") ? Response.json({ ...shown, held: value }) : undefined,
  });
  await expect(session.missingDatabaseSummary()).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(session.retireMissingDatabase(shown)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});
it.each([
  { rows: 0, kept: 0, records: 0, accepted: 0 },
  { rows: 3, kept: 3, records: 5, accepted: 5 },
])("accepts held counts at their limits %j", async (counts) => {
  const summary = { ...shown, held: counts };
  const { session } = await fixture({ summary });
  await expect(session.missingDatabaseSummary()).resolves.toEqual(summary);
});
it.each(["complete"] as const)("refuses %s work before inspection", async (status) => {
  const { session, requests } = await fixture({ status });
  await expect(session.retireMissingDatabase(shown)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(requests.map((r) => r.path)).toEqual(["/setup-api/first-setup/resolution/recover"]);
});
it.each([{ restarting: false }, {}])(
  "does not accept an incomplete restart answer %j",
  async (result) => {
    const { session } = await fixture({ result });
    await expect(session.retireMissingDatabase(shown)).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(session.recoveryRequired).toBe(true);
  },
);
it.each(["inspection", "summary", "retirement"] as const)(
  "ignores a late %s answer after disposal",
  async (stage) => {
    let answer!: (value: Response) => void;
    const { session, requests } = await fixture({
      intercept(path) {
        if (
          path.endsWith(
            { inspection: "/resolution", summary: "/summary", retirement: "/start-again" }[stage],
          )
        )
          return new Promise<Response>((resolve) => {
            answer = resolve;
          });
      },
    });
    const operation = session.retireMissingDatabase(shown);
    await expect.poll(() => answer).toBeTypeOf("function");
    await session.dispose();
    answer(
      Response.json(
        stage === "inspection"
          ? {
              pair: "valid",
              database: "missing",
              password: "checkable",
              inspectionId: "b".repeat(64),
              revision: 2,
              ownerGeneration: 2,
            }
          : stage === "summary"
            ? shown
            : { restarting: true },
      ),
    );
    await expect(operation).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(session.state).toBeUndefined();
    expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(
      stage === "retirement" ? 1 : 0,
    );
  },
);
const presentDatabase = { database: "no-venue-rows", emptyDatabase: true } as const;
it.each(["claimed", "consumption-intent"] as const)(
  "retireDamagedRecord sends the flag once the inspection still matches, for %s work",
  async (status) => {
    const { session, requests } = await fixture({ status, inspection: presentDatabase });
    await expect(session.retireDamagedRecord()).resolves.toEqual({ restarting: true });
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/resolution/recover",
      "/setup-api/first-setup/resolution",
      "/setup-api/first-setup/resolution/start-again",
    ]);
    expect(requests[2]!.body).toEqual({
      inspectionId: "b".repeat(64),
      revision: 2,
      ownerGeneration: 2,
      recoveryRecordDamagedShown: true,
    });
    expect(requests[2]!.headers.get("X-Waitron-Setup-Owner")).toBe("B".repeat(43));
    expect(session.recoveryRequired).toBe(true);
  },
);
it.each([
  { database: "missing" as const },
  { revision: 3 },
  { ownerGeneration: 3 },
  { pair: "invalid" as const },
  { emptyDatabase: false },
  { database: "occupied" as const, emptyDatabase: false },
  { password: "uncheckable" as const },
  { inspectionId: "bad" },
])("retireDamagedRecord sends nothing when the inspection changed to %j", async (inspection) => {
  const { session, requests } = await fixture({
    inspection: { ...presentDatabase, ...inspection },
  });
  await expect(session.retireDamagedRecord()).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(session.recoveryRequired).toBe(true);
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});
it.each([{ restarting: false }, {}])(
  "retireDamagedRecord does not accept an incomplete restart answer %j",
  async (result) => {
    const { session } = await fixture({ result, inspection: presentDatabase });
    await expect(session.retireDamagedRecord()).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(session.recoveryRequired).toBe(true);
  },
);

it("after a sent Start again with the database present, the stopped recovery's summary and another Start again need the password again, and send nothing", async () => {
  const { session, requests } = await fixture({ inspection: presentDatabase });
  await session.retireDamagedRecord();
  const sent = requests.length;
  await expect(session.stoppedRecoverySummary()).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  await expect(session.retireDamagedRecord()).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect(requests).toHaveLength(sent);
});

it("retireDamagedRecord sends a summary naming only the recovery-key record as the warning flag alone", async () => {
  const { session, requests } = await fixture({ inspection: presentDatabase });
  await expect(
    session.retireDamagedRecord({ ...shown, recoveryRecordDamaged: true }),
  ).resolves.toEqual({ restarting: true });
  expect(requests.at(-1)!.path).toBe("/setup-api/first-setup/resolution/start-again");
  expect(requests.at(-1)!.body).toEqual({
    inspectionId: "b".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    recoveryRecordDamagedShown: true,
  });
});
it("retireDamagedRecord sends a stopped recovery's summary only as the discard confirmation", async () => {
  const stopped = {
    ...shown,
    recovery: {
      startedAt: "2026-10-16T13:00:00.000Z",
      lastActiveAt: "2026-10-16T13:10:00.000Z",
      lastActiveSource: "memory",
      failed: false,
      cloud: false,
    },
  } as const satisfies StartAgainSummary;
  const { session, requests } = await fixture({ inspection: presentDatabase });
  await expect(session.retireDamagedRecord(stopped)).resolves.toEqual({ restarting: true });
  expect(requests.at(-1)!.body).toEqual({
    inspectionId: "b".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    confirmRecoveryDiscard: { shown: stopped },
  });
});

const refused = (params: unknown) =>
  Response.json({ error: { code: "setup.start_again_refused", params } }, { status: 409 });
it.each(["trading-settings", "setup-finished", "kept-records"] as const)(
  "a Start again refused for %s reaches the page with its cause, from the summary and from the send",
  async (cause) => {
    const { session } = await fixture({
      inspection: presentDatabase,
      intercept: (path) =>
        path.endsWith("/summary") || path.endsWith("/start-again") ? refused({ cause }) : undefined,
    });
    const fromSummary = await session.stoppedRecoverySummary().catch((error: unknown) => error);
    expect(fromSummary).toMatchObject({ code: "setup.start_again_refused", status: 409 });
    expect(startAgainRefusalCause(fromSummary)).toBe(cause);
    const fromSend = await session.retireDamagedRecord(held).catch((error: unknown) => error);
    expect(fromSend).toMatchObject({ code: "setup.start_again_refused", status: 409 });
    expect(startAgainRefusalCause(fromSend)).toBe(cause);
  },
);
it.each([
  {
    name: "an unknown cause",
    error: { code: "setup.start_again_refused", params: { cause: "x" } },
  },
  { name: "no cause", error: { code: "setup.start_again_refused", params: {} } },
  { name: "no params", error: { code: "setup.start_again_refused" } },
  {
    name: "a cause on another code",
    error: { code: "setup.not_ready", params: { cause: "kept-records" } },
  },
  {
    name: "a cause that is not a string",
    error: { code: "setup.start_again_refused", params: { cause: 1 } },
  },
  {
    name: "a cause inherited, not its own",
    error: {
      code: "setup.start_again_refused",
      params: Object.create({ cause: "kept-records" }) as object,
    },
  },
  { name: "a thrown Error", error: new Error("no") },
  { name: "null", error: null },
  { name: "a string", error: "setup.start_again_refused" },
])(
  "names no Start again refusal cause for $name, so the page shows a generic refusal",
  ({ error }) => {
    expect(startAgainRefusalCause(error)).toBeUndefined();
  },
);

const heldStopped = {
  ...held,
  recovery: {
    startedAt: "2026-10-16T13:00:00.000Z",
    lastActiveAt: "2026-10-16T13:10:00.000Z",
    lastActiveSource: "memory",
    failed: false,
    cloud: false,
  },
} as const satisfies StartAgainSummary;
const tradingSaved = {
  artifacts: [{ name: "trading.env", status: "present" as const, digest: "c".repeat(64) }],
};
it.each([
  { name: "a tenant or venue row", inspection: { database: "occupied", emptyDatabase: false } },
  {
    name: "a row in another table",
    inspection: { database: "no-venue-rows", emptyDatabase: false },
  },
] as const)(
  "beside a stopped recovery and a setup database holding $name, the summary is read and Start again sends it back as the discard confirmation",
  async ({ inspection }) => {
    const { session, requests } = await fixture({ inspection, summary: heldStopped });
    await expect(session.stoppedRecoverySummary()).resolves.toEqual(heldStopped);
    await expect(session.retireDamagedRecord(heldStopped)).resolves.toEqual({ restarting: true });
    expect(requests.at(-1)!.path).toBe("/setup-api/first-setup/resolution/start-again");
    expect(requests.at(-1)!.body).toEqual({
      inspectionId: "b".repeat(64),
      revision: 2,
      ownerGeneration: 2,
      confirmRecoveryDiscard: { shown: heldStopped },
    });
  },
);
it.each<{ name: string; inspection: Partial<FirstSetupInspection>; summary: StartAgainSummary }>([
  {
    name: "saved trading settings",
    inspection: { database: "occupied", emptyDatabase: false, ...tradingSaved },
    summary: heldStopped,
  },
  {
    name: "trading settings that cannot be read",
    inspection: {
      database: "occupied",
      emptyDatabase: false,
      artifacts: [{ name: "trading.env", status: "unreadable" }],
    },
    summary: heldStopped,
  },
  {
    name: "a summary that does not say what the database holds",
    inspection: { database: "occupied", emptyDatabase: false },
    summary: { ...heldStopped, held: undefined },
  },
  {
    name: "a database whose contents are unknown",
    inspection: { database: "unknown", emptyDatabase: false },
    summary: heldStopped,
  },
])(
  "beside a stopped recovery, the summary is not read as the held state with $name, and Start again sends nothing",
  async ({ inspection, summary }) => {
    const { session, requests } = await fixture({ inspection, summary });
    await expect(session.stoppedRecoverySummary()).rejects.toBeInstanceOf(Error);
    if (summary.held !== undefined)
      await expect(session.retireDamagedRecord(summary)).rejects.toMatchObject({
        code: "setup.attempt_conflict",
      });
    expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
  },
);
it("a setup database holding records with no stopped recovery drawn still refuses Start again, even with held counts", async () => {
  const { session, requests } = await fixture({
    inspection: { database: "occupied", emptyDatabase: false },
  });
  await expect(session.retireDamagedRecord(held)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});
