import { afterEach, expect, it } from "vitest";
import { SetupApi } from "./api/client.js";
import type {
  FirstSetupInspection,
  FirstSetupState,
  StartAgainSummary,
} from "./api/first-setup-types.js";
import { FirstSetupSession, FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial } from "../test/first-setup-browser.js";

const sessions: FirstSetupSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
const snapshot = { inspectionId: "a".repeat(64), revision: 1, ownerGeneration: 1 };
const shown: StartAgainSummary = { reached: "named", lastName: "0CNQT" };
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
    const summary = { reached: "fiscal-started", lastName: "0CNQT" } as const;
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
    summary: { reached: "fiscal-finished", lastName: "0CNQT" },
  });
  await expect(session.retireMissingDatabase(shown)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});
it.each([
  { reached: "unknown", lastName: "0CNQT" },
  { reached: "named", lastName: "" },
  { reached: "named", lastName: "0CNQT", extra: true },
  { reached: "named", lastName: "0CNQT", recoveryRecordDamaged: false },
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
  const damaged = { reached: "named", lastName: "0CNQT", recoveryRecordDamaged: true } as const;
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
