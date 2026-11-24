// A main box and a joining box started in this process, as `spare-join.e2e.test.ts` starts them,
// but with no bucket copy: which environment the joining box ends up in when its WAITRON_ENV is
// unset, empty or set, and that Finish joining still answers when its setup record is written
// slowly.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startServer } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { parseEnvFile } from "./env-file.js";
import { BOOT_MS, boundedStart } from "./testing/spare-join-scenario.js";
import { JoinPairs } from "./testing/spare-join-pair.js";
import type { BoxDirs } from "./testing/stream-box.js";

const UNTIMED_MS = 60_000;
const ADOPT_TIMEOUT_MS = 3 * BOOT_MS + UNTIMED_MS;
// S starts for setup, once after joining and once more; M starts once.
const RESTART_TIMEOUT_MS = 4 * BOOT_MS + UNTIMED_MS;
// S starts for setup, once refused, once after the join stopped, once after the reset was asked
// for and once after it ran; M starts once.
const STOPPED_JOIN_TIMEOUT_MS = 6 * BOOT_MS + UNTIMED_MS;

/**
 * State folders whose join's last setup-record write first waits `ms`, and how many writes did.
 * `ms` is longer than the grace a restart gives open connections before cutting them
 * (`DEFAULT_GRACE_MS`, close-listener.ts).
 */
const slowRecord = vi.hoisted(() => ({ ms: 850, stateDirs: new Set<string>(), delayed: 0 }));
vi.mock("./setup-operation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./setup-operation.js")>();
  return {
    ...actual,
    createSetupOperationStore: (...args: Parameters<typeof actual.createSetupOperationStore>) => {
      const store = actual.createSetupOperationStore(...args);
      const [stateDir] = args;
      return {
        ...store,
        run: (kind, requestHash, fn, hold) =>
          store.run(
            kind,
            requestHash,
            (operation) => {
              if (kind === "adopt" && slowRecord.stateDirs.has(stateDir)) {
                // In place: the store updates this object's phase after each write.
                const complete = operation.complete;
                operation.complete = async (data) => {
                  slowRecord.delayed += 1;
                  await sleep(slowRecord.ms);
                  await complete(data);
                };
              }
              return fn(operation);
            },
            hold,
          ),
      } satisfies ReturnType<typeof actual.createSetupOperationStore>;
    },
  };
});

describe("a joining box's environment", () => {
  const pairs = new JoinPairs();

  beforeAll(() => pairs.open("waitron-join-env-"));

  afterAll(async () => {
    await pairs.close("join environment teardown failed");
  });

  const setupStatus = async (url: string, via: RequestInit): Promise<unknown> => {
    const answer = await fetch(`${url}/setup-api/status`, via);
    expect(answer.status).toBe(200);
    return answer.json();
  };

  const tradingEnv = async (dirs: BoxDirs) =>
    parseEnvFile(await readFile(join(dirs.state, "trading.env"), "utf8"));

  it(
    "a box with WAITRON_ENV unset joins a production main box and starts again as production",
    async () => {
      const pair = await pairs.start("unset", "production", undefined);
      const joined = await pair.adopt();
      expect(joined.status, JSON.stringify(joined.body)).toBe(200);
      expect(joined.body).toMatchObject({ adopted: true, restarting: true });
      expect((await tradingEnv(pair.dirsS)).WAITRON_ENV).toBe("production");
      // Every start compares the database's stamp with the box's environment
      // (`assertDeploymentMatches`), so a joined box left in preproduction fails here.
      await pair.boxS.restartNow();
      expect(pair.boxS.restarts).toBe(2);
    },
    RESTART_TIMEOUT_MS,
  );

  it(
    "a box with WAITRON_ENV unset whose join's setup record is written slowly still answers Finish joining, then restarts",
    async () => {
      const pair = await pairs.start("slow-record", "production", undefined);
      slowRecord.stateDirs.add(pair.dirsS.state);
      const joined = await pair.adopt();
      expect(joined.status, JSON.stringify(joined.body)).toBe(200);
      expect(joined.body).toMatchObject({ adopted: true, restarting: true });
      expect(slowRecord.delayed).toBe(1);
      expect((await tradingEnv(pair.dirsS)).WAITRON_ENV).toBe("production");
      await pair.boxS.restartNow();
      expect(pair.boxS.restarts).toBe(2);
    },
    RESTART_TIMEOUT_MS + slowRecord.ms,
  );

  it.each([
    { name: "both-production", main: "production", joining: "production" },
    { name: "preproduction-unset", main: "preproduction", joining: undefined },
    { name: "empty", main: "production", joining: "" },
  ] as const)(
    "joins when main is $main and the joining box's WAITRON_ENV is $joining",
    async ({ name, main, joining }) => {
      const pair = await pairs.start(name, main, joining);
      const joined = await pair.adopt();
      expect(joined.status, JSON.stringify(joined.body)).toBe(200);
      expect((await tradingEnv(pair.dirsS)).WAITRON_ENV).toBe(main);
    },
    ADOPT_TIMEOUT_MS,
  );

  it.each([
    { name: "set-preproduction", joining: "preproduction" },
    { name: "set-dev", joining: "dev" },
  ] as const)(
    "refuses a box whose WAITRON_ENV is $joining joining a production main box",
    async ({ name, joining }) => {
      const pair = await pairs.start(name, "production", joining);
      const refused = await pair.adopt();
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body).toEqual({
        error: {
          code: "mirror.environment_mismatch",
          params: { expected: "preproduction", actual: "production" },
        },
      });
      expect(existsSync(join(pair.dirsS.state, "trading.env"))).toBe(false);
    },
    ADOPT_TIMEOUT_MS,
  );

  it(
    "refuses a box with WAITRON_ENV unset joining a production main box when it could not start in production",
    async () => {
      const pair = await pairs.start("no-rp-id", "production", undefined, {
        leftOut: ["WAITRON_MANAGEMENT_RP_ID"],
      });
      const refused = await pair.adopt();
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body).toEqual({
        error: {
          code: "server.config_missing",
          params: { variable: "WAITRON_MANAGEMENT_RP_ID" },
        },
      });
      expect(existsSync(join(pair.dirsS.state, "trading.env"))).toBe(false);
      const status = await setupStatus(pair.urlS, await pairs.viaNow(pair.dirsS));
      expect(status).toMatchObject({ environment: "preproduction" });
      expect(status).not.toHaveProperty("operation");
    },
    ADOPT_TIMEOUT_MS,
  );

  it(
    "refuses a box with WAITRON_ENV unset joining a production main box when its build carries no release version",
    async () => {
      const pair = await pairs.start("unreleased", "production", undefined, {
        seams: { builtRelease: { bundled: true, version: null } },
      });
      const refused = await pair.adopt();
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body).toEqual({ error: { code: "server.unreleased_build", params: {} } });
      expect(existsSync(join(pair.dirsS.state, "trading.env"))).toBe(false);
    },
    ADOPT_TIMEOUT_MS,
  );

  it(
    "refuses a box with WAITRON_ENV unset joining a production main box when a setting it holds is refused in production",
    async () => {
      const pair = await pairs.start("prepare-intent", "production", undefined, {
        set: { WAITRON_ONBOARDING_INTENT: "prepare" },
      });
      const refused = await pair.adopt();
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body).toEqual({
        error: {
          code: "server.config_invalid",
          params: { variable: "WAITRON_ONBOARDING_INTENT", reason: "intent_environment_mismatch" },
        },
      });
      expect(existsSync(join(pair.dirsS.state, "trading.env"))).toBe(false);
    },
    ADOPT_TIMEOUT_MS,
  );

  it(
    "a box with WAITRON_ENV unset whose join stops after its database is stamped starts again in setup and can be reset",
    async () => {
      const pair = await pairs.start("stopped", "production", undefined);
      // The join's last write fails, after its stamp.
      const stopped = await pair.stopJoin();
      expect(stopped.status, JSON.stringify(stopped.body)).toBe(500);

      // Set to preproduction, the same box still refuses the database its join stamped.
      const refused = startServer(
        await loadBoxEnv({ ...pair.envS, WAITRON_ENV: "preproduction" }, pair.dirsS.state),
      ).then(async (server) => {
        await server.close();
        return "started";
      });
      await expect(refused).rejects.toMatchObject({ code: "deployment.environment_mismatch" });

      await boundedStart(pair.boxS.start(), "S's start after its join stopped");
      const viaJoined = await pairs.viaNow(pair.dirsS);
      expect(await setupStatus(pair.urlS, viaJoined)).toMatchObject({
        environment: "production",
        operation: { kind: "adopt", phase: "venue_committed" },
      });
      await pair.resetStoppedJoin(viaJoined);
      // The reset took the main box's authority away, so S minted its own again.
      const fresh = await setupStatus(pair.urlS, await pairs.viaNow(pair.dirsS));
      expect(fresh).toMatchObject({ provisioned: false, environment: "preproduction" });
      expect(fresh).not.toHaveProperty("operation");
    },
    STOPPED_JOIN_TIMEOUT_MS,
  );
});
