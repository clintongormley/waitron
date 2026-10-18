import { afterEach, expect, it } from "vitest";
import { SetupApi } from "./api/client.js";
import type { FirstSetupInspection, FirstSetupState } from "./api/first-setup-types.js";
import { FirstSetupSession, FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial } from "../test/first-setup-browser.js";

const sessions: FirstSetupSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
const snapshot = { inspectionId: "a".repeat(64), revision: 1, ownerGeneration: 1 };
async function fixture(
  options: {
    status?: FirstSetupState["status"];
    inspection?: Partial<FirstSetupInspection>;
    result?: unknown;
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
    await expect(session.retireMissingDatabase()).resolves.toEqual({ restarting: true });
    expect(requests.map((r) => r.path)).toEqual([
      "/setup-api/first-setup/resolution/recover",
      "/setup-api/first-setup/resolution",
      "/setup-api/first-setup/resolution/start-again",
    ]);
    expect(requests[2]!.body).toEqual({
      inspectionId: "b".repeat(64),
      revision: 2,
      ownerGeneration: 2,
    });
    expect(requests[2]!.headers.get("X-Waitron-Setup-Owner")).toBe("B".repeat(43));
    await session.refresh();
    await expect(session.retireMissingDatabase()).rejects.toMatchObject({
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
  await expect(session.retireMissingDatabase()).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(session.recoveryRequired).toBe(true);
  expect(requests.some((r) => r.path.endsWith("/start-again"))).toBe(false);
});
it.each(["activation-started", "committed", "publication", "complete", "uncertain"] as const)(
  "refuses %s work before inspection",
  async (status) => {
    const { session, requests } = await fixture({ status });
    await expect(session.retireMissingDatabase()).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(requests.map((r) => r.path)).toEqual(["/setup-api/first-setup/resolution/recover"]);
  },
);
it.each([{ restarting: false }, {}])(
  "does not accept an incomplete restart answer %j",
  async (result) => {
    const { session } = await fixture({ result });
    await expect(session.retireMissingDatabase()).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(session.recoveryRequired).toBe(true);
  },
);
it.each(["inspection", "retirement"] as const)(
  "ignores a late %s answer after disposal",
  async (stage) => {
    let answer!: (value: Response) => void;
    const { session, requests } = await fixture({
      intercept(path) {
        if (path.endsWith(stage === "inspection" ? "/resolution" : "/start-again"))
          return new Promise<Response>((resolve) => {
            answer = resolve;
          });
      },
    });
    const operation = session.retireMissingDatabase();
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
          : { restarting: true },
      ),
    );
    await expect(operation).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    expect(session.state).toBeUndefined();
    expect(requests.filter((r) => r.path.endsWith("/start-again"))).toHaveLength(
      stage === "inspection" ? 0 : 1,
    );
  },
);
