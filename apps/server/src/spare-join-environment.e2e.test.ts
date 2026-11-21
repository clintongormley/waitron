// A main box and a joining box started in this process, as `spare-join.e2e.test.ts` starts them,
// but with no bucket copy: which environment the joining box ends up in when its WAITRON_ENV is
// unset, empty or set.
import { mkdir, readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import type { DeploymentEnvironment } from "@waitron/db";
import { startServer, type StartServerSeams } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { BOX_HOSTNAME, ownContactUrl } from "./box-name.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { ALL_MODULES } from "./modules.js";
import { runStagedReset } from "./reset-request.js";
import { fetchHealthOk, httpsVia, poll } from "./testing/boot-harness.js";
import { freePort } from "./testing/free-ports.js";
import { adoptRetainedListeners } from "./testing/retained-http-adoption.mjs";
import { retainHttpListener, type RetainedHttpListener } from "./testing/retained-http-listener.js";
import {
  BOOT_MS,
  MODULES_M,
  TestBox,
  VENUE_M,
  WAIT_POLL_MS,
  adoptFrom,
  boundedStart,
  closeBoxes,
} from "./testing/spare-join-scenario.js";
import {
  bootEnv,
  boxDirs,
  copyMigrations,
  provisionStreamBox,
  type BoxDirs,
} from "./testing/stream-box.js";
import { waitUntil } from "./testing/scenario-stages.js";
import { synchronisedBoxHost } from "./testing/synchronised-box-host.js";

const UNTIMED_MS = 60_000;
const ADOPT_TIMEOUT_MS = 3 * BOOT_MS + UNTIMED_MS;
// S starts for setup, once after joining and once more; M starts once.
const RESTART_TIMEOUT_MS = 4 * BOOT_MS + UNTIMED_MS;
// S starts for setup, once refused, once after the join stopped, once after the reset was asked
// for and once after it ran; M starts once.
const STOPPED_JOIN_TIMEOUT_MS = 6 * BOOT_MS + UNTIMED_MS;

interface Pair {
  boxS: TestBox;
  dirsS: BoxDirs;
  envS: NodeJS.ProcessEnv;
  urlS: string;
  adopt: () => Promise<{ status: number; body: unknown }>;
}

describe("a joining box's environment", () => {
  let scratch: string | undefined;
  let migrationsRoot: string;
  const boxes: TestBox[] = [];
  const retained: RetainedHttpListener[] = [];
  const closers: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "waitron-join-env-"));
    migrationsRoot = await copyMigrations(scratch);
  });

  afterAll(async () => {
    const failures = await closeBoxes(boxes);
    for (const held of retained)
      if (held.server.listening) await held.close().catch((error: unknown) => failures.push(error));
    for (const close of closers) await close().catch(() => {});
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    if (failures.length > 0) throw new AggregateError(failures, "join environment teardown failed");
  });

  /** M provisioned in `main` with a recovery key and no bucket copy, and S's empty folder, both
   * started; S's own WAITRON_ENV is `joining` (undefined leaves it out). `s.leftOut` names
   * variables S's environment leaves out, `s.set` adds to it, and `s.seams` are S's start seams. */
  async function startPair(
    name: string,
    main: DeploymentEnvironment,
    joining: string | undefined,
    s: {
      leftOut?: readonly string[];
      set?: NodeJS.ProcessEnv;
      seams?: StartServerSeams;
    } = {},
  ): Promise<Pair> {
    const root = scratch!;
    const [listenerM, listenerS, storeListener] = await Promise.all([
      retainHttpListener(),
      retainHttpListener(),
      retainHttpListener(),
    ]);
    retained.push(listenerM, listenerS, storeListener);
    // Litestream is never run here: no box has a bucket copy.
    const boxEnv = (dirs: BoxDirs, port: number): NodeJS.ProcessEnv => ({
      ...bootEnv(dirs, port, migrationsRoot, join(root, "no-litestream")),
      WAITRON_MANAGEMENT_ORIGIN: `https://${BOX_HOSTNAME}:${port}`,
      WAITRON_MANAGEMENT_RP_ID: BOX_HOSTNAME,
    });
    const dirsM = await boxDirs(root, `${name}-m`);
    const m = await provisionStreamBox({
      dirs: dirsM,
      advertisedOrigin: `https://${BOX_HOSTNAME}:${listenerM.port}`,
      modulesJson: MODULES_M,
      venue: {
        request: VENUE_M,
        modules: enabledModules(ALL_MODULES, parseModuleConfig(MODULES_M, ALL_MODULES)),
      },
      environment: main,
    });
    await writeFile(
      join(dirsM.state, "backup.env"),
      formatEnvFile({ WAITRON_BACKUP_RECOVERY_KEY: `join-env-${name}` }),
    );
    const boxM = new TestBox(dirsM, listenerM.port, boxEnv(dirsM, listenerM.port), {
      boxHost: synchronisedBoxHost(),
    });
    boxes.push(boxM);
    const dirsS = await boxDirs(root, `${name}-s`);
    const envS: NodeJS.ProcessEnv = {
      ...boxEnv(dirsS, listenerS.port),
      ...(joining === undefined ? {} : { WAITRON_ENV: joining }),
      WAITRON_SPARE_STORE_PORT: String(storeListener.port),
      WAITRON_SPARE_STORE_LOOPBACK_PORT: String(await freePort()),
      ...s.set,
    };
    for (const variable of s.leftOut ?? []) delete envS[variable];
    const boxS = new TestBox(dirsS, listenerS.port, envS, s.seams ?? {});
    boxes.push(boxS);

    const adoption = adoptRetainedListeners([listenerM, listenerS]);
    const starts = [boxM.start(), boxS.start()];
    try {
      const bounded = await Promise.allSettled([
        boundedStart(starts[0]!, `${name}: M's start`),
        boundedStart(starts[1]!, `${name}: S's setup start`),
      ]);
      for (const start of bounded) if (start.status === "rejected") throw start.reason;
      expect(adoption.adopted.size).toBe(2);
      await adoption.bound;
    } finally {
      // Restored only once both starts have settled, so neither binds after the handoff ends.
      await Promise.allSettled(starts);
      adoption.restore();
    }
    const caM = await readFile(join(dirsM.state, "tls", "ca.crt"), "utf8");
    const caS = await readFile(join(dirsS.state, "tls", "ca.crt"), "utf8");
    const { via: viaM, close: closeM } = httpsVia(caM);
    const { via: viaS, close: closeS } = httpsVia(caS);
    closers.push(closeM, closeS);
    await fetchHealthOk(`https://127.0.0.1:${listenerM.port}/health`, viaM);
    const urlS = `https://127.0.0.1:${listenerS.port}`;
    const primaryUrl = ownContactUrl(boxM.origin, m.nodeId);
    expect(existsSync(join(dirsS.state, "trading.env"))).toBe(false);
    return {
      boxS,
      dirsS,
      envS,
      urlS,
      adopt: async () => {
        const store = adoptRetainedListeners([storeListener]);
        try {
          const answer = await adoptFrom(
            { url: urlS, via: viaS },
            { url: `https://127.0.0.1:${listenerM.port}`, via: viaM, origin: boxM.origin },
            primaryUrl,
            (what, ms, probe) => waitUntil(what, ms, probe, undefined, WAIT_POLL_MS),
          );
          // The joined box's restart binds its store port, which this test holds until then.
          if (answer.status === 200)
            await boundedStart(
              store.bound.then(() => {}),
              `${name}: S's store listener`,
            );
          return answer;
        } finally {
          store.restore();
        }
      },
    };
  }

  /** Trusts the authority S serves under now: its own in setup, M's once its join installs it. */
  const viaNow = async (dirs: BoxDirs): Promise<RequestInit> => {
    const { via, close } = httpsVia(await readFile(join(dirs.state, "tls", "ca.crt")));
    closers.push(close);
    return via;
  };

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
      const pair = await startPair("unset", "production", undefined);
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

  it.each([
    { name: "both-production", main: "production", joining: "production" },
    { name: "preproduction-unset", main: "preproduction", joining: undefined },
    { name: "empty", main: "production", joining: "" },
  ] as const)(
    "joins when main is $main and the joining box's WAITRON_ENV is $joining",
    async ({ name, main, joining }) => {
      const pair = await startPair(name, main, joining);
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
      const pair = await startPair(name, "production", joining);
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
      const pair = await startPair("no-rp-id", "production", undefined, {
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
      const status = await setupStatus(pair.urlS, await viaNow(pair.dirsS));
      expect(status).toMatchObject({ environment: "preproduction" });
      expect(status).not.toHaveProperty("operation");
    },
    ADOPT_TIMEOUT_MS,
  );

  it(
    "refuses a box with WAITRON_ENV unset joining a production main box when its build carries no release version",
    async () => {
      const pair = await startPair("unreleased", "production", undefined, {
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
      const pair = await startPair("prepare-intent", "production", undefined, {
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
      const pair = await startPair("stopped", "production", undefined);
      // A folder where `trading.env` goes fails the join's last write, after its stamp.
      const blocker = join(pair.dirsS.state, "trading.env");
      await mkdir(blocker);
      const stopped = await pair.adopt();
      expect(stopped.status, JSON.stringify(stopped.body)).toBe(500);
      await rm(blocker, { recursive: true });
      await pair.boxS.stopForRestart();

      // Set to preproduction, the same box still refuses the database its join stamped.
      const refused = startServer(
        await loadBoxEnv({ ...pair.envS, WAITRON_ENV: "preproduction" }, pair.dirsS.state),
      ).then(async (server) => {
        await server.close();
        return "started";
      });
      await expect(refused).rejects.toMatchObject({ code: "deployment.environment_mismatch" });

      await boundedStart(pair.boxS.start(), "S's start after its join stopped");
      const viaJoined = await viaNow(pair.dirsS);
      expect(await setupStatus(pair.urlS, viaJoined)).toMatchObject({
        environment: "production",
        operation: { kind: "adopt", phase: "venue_committed" },
      });
      const restartsBeforeReset = pair.boxS.restarts;
      const reset = await fetch(`${pair.urlS}/setup-api/reset-incomplete-adopt`, {
        ...viaJoined,
        method: "POST",
      });
      expect(reset.status, await reset.text()).toBe(202);
      expect(await poll(() => (pair.boxS.restarts > restartsBeforeReset ? true : undefined))).toBe(
        true,
      );
      await pair.boxS.stopForRestart();
      // Run as the next start through the entrypoint runs it.
      expect(
        await runStagedReset({
          stateDir: pair.dirsS.state,
          venueDir: pair.dirsS.venue,
          log: () => {},
        }),
      ).toBe(true);
      await boundedStart(pair.boxS.start(), "S's start after the reset");
      // The reset took the main box's authority away, so S minted its own again.
      const fresh = await setupStatus(pair.urlS, await viaNow(pair.dirsS));
      expect(fresh).toMatchObject({ provisioned: false, environment: "preproduction" });
      expect(fresh).not.toHaveProperty("operation");
    },
    STOPPED_JOIN_TIMEOUT_MS,
  );
});
