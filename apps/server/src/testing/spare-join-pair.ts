// A main box M with a recovery key and no bucket copy, and a joining box S from an empty folder,
// both started in this process as `spare-join-scenario.ts` starts them. Litestream is never run:
// no box has a bucket copy.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { DeploymentEnvironment } from "@waitron/db";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import type { StartServerSeams } from "../boot.js";
import { BOX_HOSTNAME, ownContactUrl } from "../box-name.js";
import { formatEnvFile } from "../env-file.js";
import { ALL_MODULES } from "../modules.js";
import { runStagedReset } from "../reset-request.js";
import { fetchHealthOk, httpsVia, poll } from "./boot-harness.js";
import { freePort } from "./free-ports.js";
import { adoptRetainedListeners } from "./retained-http-adoption.mjs";
import { retainHttpListener, type RetainedHttpListener } from "./retained-http-listener.js";
import { waitUntil } from "./scenario-stages.js";
import {
  MODULES_M,
  TestBox,
  VENUE_M,
  WAIT_POLL_MS,
  adoptFrom,
  boundedStart,
  closeBoxes,
} from "./spare-join-scenario.js";
import {
  bootEnv,
  boxDirs,
  copyMigrations,
  provisionStreamBox,
  type BoxDirs,
  type StreamBox,
} from "./stream-box.js";
import { synchronisedBoxHost } from "./synchronised-box-host.js";

type Via = ReturnType<typeof httpsVia>["via"];

export interface JoinPair {
  boxM: TestBox;
  dirsM: BoxDirs;
  m: StreamBox;
  urlM: string;
  viaM: Via;
  boxS: TestBox;
  dirsS: BoxDirs;
  envS: NodeJS.ProcessEnv;
  urlS: string;
  /** M's contact address, as its chart gives it. */
  primaryUrl: string;
  /** Join, Check, tap and Finish joining (`adoptFrom`), with S joining M at `primaryUrl`. */
  adopt: (primaryUrl?: string) => Promise<{ status: number; body: unknown }>;
  /**
   * `adopt` with a folder where S's `trading.env` goes, so the join's last write fails after M
   * approved it and S collected the bundle; answers Finish joining's answer, with S stopped.
   */
  stopJoin: () => Promise<{ status: number; body: unknown }>;
  /**
   * On S started after a stopped join: asks for the reset (trusting S through `via`), runs it as
   * the next start through the entrypoint runs it, and starts S again.
   */
  resetStoppedJoin: (via: RequestInit) => Promise<void>;
}

/** Every pair a suite starts, in one scratch folder, closed together by `close`. */
export class JoinPairs {
  private scratch: string | undefined;
  private migrationsRoot = "";
  private readonly boxes: TestBox[] = [];
  private readonly retained: RetainedHttpListener[] = [];
  private readonly closers: (() => Promise<void>)[] = [];

  async open(prefix: string): Promise<void> {
    this.scratch = await mkdtemp(join(tmpdir(), prefix));
    this.migrationsRoot = await copyMigrations(this.scratch);
  }

  /** Closes every box and client, removes the scratch folder, and answers what failed. */
  async close(): Promise<unknown[]> {
    const failures = await closeBoxes(this.boxes);
    for (const held of this.retained)
      if (held.server.listening) await held.close().catch((error: unknown) => failures.push(error));
    for (const close of this.closers) await close().catch(() => {});
    if (this.scratch !== undefined) await rm(this.scratch, { recursive: true, force: true });
    return failures;
  }

  /** An HTTPS client trusting `ca`, closed with the suite. */
  via(ca: string | Buffer): Via {
    const { via, close } = httpsVia(ca);
    this.closers.push(close);
    return via;
  }

  /** Trusts the authority the box on `dirs` serves under now. */
  async viaNow(dirs: BoxDirs): Promise<Via> {
    return this.via(await readFile(join(dirs.state, "tls", "ca.crt")));
  }

  /** M provisioned in `main` and S's empty folder, both started; S's own WAITRON_ENV is `joining`
   * (undefined leaves it out). `s.leftOut` names variables S's environment leaves out, `s.set`
   * adds to it, and `s.seams` are S's start seams. */
  async start(
    name: string,
    main: DeploymentEnvironment,
    joining: string | undefined,
    s: {
      leftOut?: readonly string[];
      set?: NodeJS.ProcessEnv;
      seams?: StartServerSeams;
    } = {},
  ): Promise<JoinPair> {
    const root = this.scratch!;
    const [listenerM, listenerS, storeListener] = await Promise.all([
      retainHttpListener(),
      retainHttpListener(),
      retainHttpListener(),
    ]);
    this.retained.push(listenerM, listenerS, storeListener);
    const boxEnv = (dirs: BoxDirs, port: number): NodeJS.ProcessEnv => ({
      ...bootEnv(dirs, port, this.migrationsRoot, join(root, "no-litestream")),
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
    this.boxes.push(boxM);
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
    this.boxes.push(boxS);

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
    const viaM = await this.viaNow(dirsM);
    const viaS = await this.viaNow(dirsS);
    const urlM = `https://127.0.0.1:${listenerM.port}`;
    await fetchHealthOk(`${urlM}/health`, viaM);
    const urlS = `https://127.0.0.1:${listenerS.port}`;
    const primaryUrl = ownContactUrl(boxM.origin, m.nodeId);
    expect(existsSync(join(dirsS.state, "trading.env"))).toBe(false);
    const adopt = async (joinAt = primaryUrl) => {
      const store = adoptRetainedListeners([storeListener]);
      try {
        const answer = await adoptFrom(
          { url: urlS, via: viaS },
          { url: urlM, via: viaM, origin: boxM.origin },
          joinAt,
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
    };
    return {
      boxM,
      dirsM,
      m,
      urlM,
      viaM,
      boxS,
      dirsS,
      envS,
      urlS,
      primaryUrl,
      adopt,
      stopJoin: async () => {
        const blocker = join(dirsS.state, "trading.env");
        await mkdir(blocker);
        const stopped = await adopt();
        await rm(blocker, { recursive: true });
        await boxS.stopForRestart();
        return stopped;
      },
      resetStoppedJoin: async (via) => {
        const restartsBeforeReset = boxS.restarts;
        const reset = await fetch(`${urlS}/setup-api/reset-incomplete-adopt`, {
          ...via,
          method: "POST",
        });
        expect(reset.status, await reset.text()).toBe(202);
        expect(await poll(() => (boxS.restarts > restartsBeforeReset ? true : undefined))).toBe(
          true,
        );
        await boxS.stopForRestart();
        expect(
          await runStagedReset({ stateDir: dirsS.state, venueDir: dirsS.venue, log: () => {} }),
        ).toBe(true);
        await boundedStart(boxS.start(), `${name}: S's start after the reset`);
      },
    };
  }
}
