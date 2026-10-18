import { afterEach, expect, it } from "vitest";
import { SetupApi } from "./api/client.js";
import type { FirstSetupInspection, FirstSetupState } from "./api/first-setup-types.js";
import { FirstSetupSession, FIRST_SETUP_SESSION_KEY } from "./first-setup-session.js";
import { initial } from "../test/first-setup-browser.js";

const sessions: FirstSetupSession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.dispose();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
const snapshot = { inspectionId: "a".repeat(64), revision: 1, ownerGeneration: 1 };
async function fixture(
  options: {
    status?: FirstSetupState["status"];
    inspection?: Partial<FirstSetupInspection>;
    intercept?: (path: string) => Response | Promise<Response> | undefined;
  } = {},
) {
  const state: FirstSetupState = {
    ...initial,
    environment: "production",
    revision: 2,
    ownerGeneration: 2,
    status: options.status ?? "committed",
    consumptionIntent: true,
  };
  const requests: { path: string; body: unknown }[] = [];
  const api = new SetupApi("", async (url, init) => {
    const path = String(url);
    requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const result = options.intercept?.(path);
    if (result !== undefined) return result;
    if (path.endsWith("/recover"))
      return Response.json({ state, capability: "B".repeat(43), ownerGeneration: 2 });
    if (path.endsWith("/resolution"))
      return Response.json({
        version: 2,
        inspectionId: "b".repeat(64),
        pair: "valid",
        database: "occupied",
        password: "checkable",
        revision: 2,
        ownerGeneration: 2,
        emptyDatabase: false,
        repairEligible: false,
        artifacts: [],
        ...options.inspection,
      });
    if (path.endsWith("/finish")) return Response.json({ provisioned: true, restarting: true });
    return Response.json({ claimed: true, state });
  });
  const session = new FirstSetupSession(api);
  sessions.push(session);
  await session.open();
  await session.recover(snapshot, "original password");
  return { session, requests, state };
}
it("finishes only with the newly inspected binding and requires a result read afterwards", async () => {
  const { session, requests } = await fixture();
  await expect(session.finish({ mode: "live" })).resolves.toEqual({
    provisioned: true,
    restarting: true,
  });
  expect(requests.map((r) => r.path)).toEqual([
    "/setup-api/first-setup/resolution/recover",
    "/setup-api/first-setup/resolution",
    "/setup-api/first-setup/resolution/finish",
  ]);
  expect(requests[2]!.body).toEqual({
    inspectionId: "b".repeat(64),
    revision: 2,
    ownerGeneration: 2,
    publication: { mode: "live" },
  });
  expect(session.recoveryRequired).toBe(true);
  await expect(session.finish({ mode: "live" })).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect(requests).toHaveLength(3);
});
it.each([
  { revision: 3 },
  { ownerGeneration: 3 },
  { inspectionId: "bad" },
  { pair: "invalid" as const },
  { database: "missing" as const },
  { password: "uncheckable" as const },
])("refuses changed or unusable inspection %j without sending Finish", async (inspection) => {
  const { session, requests } = await fixture({ inspection });
  await expect(session.finish({ mode: "live" })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(requests.some((r) => r.path.endsWith("/finish"))).toBe(false);
});
it.each(["claimed", "consumption-intent", "uncertain", "abandoned", "complete"] as const)(
  "never finishes %s",
  async (status) => {
    const { session, requests } = await fixture({ status });
    await expect(session.finish({ mode: "live" })).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(requests).toHaveLength(1);
  },
);
it("requires another proof after a refused Finish", async () => {
  const { session, requests } = await fixture({
    intercept: (path) =>
      path.endsWith("/finish")
        ? Response.json({ error: { code: "setup.attempt_uncertain", params: {} } }, { status: 409 })
        : undefined,
  });
  await expect(session.finish({ mode: "live" })).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  expect(session.recoveryRequired).toBe(true);
  await expect(session.finish({ mode: "live" })).rejects.toMatchObject({
    code: "setup.owner_required",
  });
  expect(requests.filter((r) => r.path.endsWith("/finish"))).toHaveLength(1);
});
it("does not finish after disposal while inspecting", async () => {
  let resolve!: (r: Response) => void;
  const { session, requests } = await fixture({
    intercept: (path) =>
      path.endsWith("/resolution")
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : undefined,
  });
  const pending = session.finish({ mode: "live" });
  await expect.poll(() => requests.some((r) => r.path.endsWith("/resolution"))).toBe(true);
  await session.dispose();
  resolve(
    Response.json({
      version: 2,
      inspectionId: "b".repeat(64),
      pair: "valid",
      database: "occupied",
      password: "checkable",
      revision: 2,
      ownerGeneration: 2,
    }),
  );
  await expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(requests.some((r) => r.path.endsWith("/finish"))).toBe(false);
});
