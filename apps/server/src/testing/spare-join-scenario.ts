// A main box M and a spare S, both started in this process: M is provisioned as the stream loop
// provisions its box, and S starts from an empty state folder, so it boots in setup mode.
// `spare-join.e2e.test.ts` runs it against versitygw.
import { X509Certificate } from "node:crypto";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import type { BucketConfig } from "@waitron/stream";
import { BOX_HOSTNAME, ownContactUrl } from "../box-name.js";
import { loadBoxEnv } from "../box-env.js";
import { startServer, type StartServerSeams, type StartedServer } from "../boot.js";
import type { BoxLookup } from "../mirror-bundle-fetch.js";
import { ALL_MODULES } from "../modules.js";
import { POLL_INTERVAL_MS, POLL_TRIES, fetchHealthOk, httpsVia } from "./boot-harness.js";
import { freePorts } from "./free-ports.js";
import { stageClock, type StageEvent } from "./scenario-stages.js";
import { boxDirs, provisionStreamBox, type BoxDirs } from "./stream-box.js";

const RECOVERY_KEY = "spare-join-e2e-recovery-key";
const MODULES_M = { modules: { "fiscal-verifactu": false } };
/** A taxpayer whose territory selects `fiscal-none`, the one fiscal module `MODULES_M` leaves on. */
const VENUE_M = {
  country: "GB",
  taxId: "GB100000001",
  legalName: "Spare Join Ltd",
  fiscalTerritory: "GB-vat",
  invoiceLocales: ["en-GB"],
  operationDescription: "Sale on premises",
  addressLine1: "1 High Street",
  postalCode: "EC1A 1AA",
  city: "London",
  province: "London",
  timeZone: "Europe/London",
};

// A caller's timeout adds this sum (CLAUDE.md §4). BOOT_MS, per start, and UNTIMED_MS, for
// migrations, provisioning and closes, are budgets nothing here enforces; the health wait is
// `fetchHealthOk`'s poll budget.
const BOOT_MS = 30_000;
const HEALTH_MS = POLL_TRIES * POLL_INTERVAL_MS;
const UNTIMED_MS = 60_000;
export const SPARE_JOIN_SCENARIO_MS = 2 * BOOT_MS + HEALTH_MS + UNTIMED_MS;

export const SPARE_JOIN_PHASES = ["probe"] as const;
export type SpareJoinPhase = (typeof SPARE_JOIN_PHASES)[number];
export type SpareJoinEvent = StageEvent<SpareJoinPhase>;

export interface SpareJoinFixture {
  bucket: BucketConfig;
  /** An existing folder the scenario may fill; the caller removes it. */
  scratch: string;
  litestreamBin: string;
  versitygwBin: string;
  /** Aborting it closes both servers at once and ends the scenario at its next phase. */
  signal?: AbortSignal;
  record?(event: SpareJoinEvent): void;
}

/** Every `.local` name is this process's loopback: both boxes listen on 127.0.0.1. */
const loopbackLookup: BoxLookup = async (hostname) => {
  if (!hostname.endsWith(".local")) throw new Error(`no test address for ${hostname}`);
  return { addresses: ["127.0.0.1"], remembered: false };
};

/**
 * One box's server, started again in place whenever it asks to restart: the `restart` seam closes
 * it and starts it on the same folders and environment.
 */
class TestBox {
  server: StartedServer | undefined;
  private restarting: Promise<void> | undefined;
  private restartFailure: unknown;

  constructor(
    readonly dirs: BoxDirs,
    readonly port: number,
    private readonly env: NodeJS.ProcessEnv,
    private readonly seams: StartServerSeams,
  ) {}

  get origin(): string {
    return `https://${BOX_HOSTNAME}:${this.port}`;
  }

  async start(): Promise<void> {
    this.server = await startServer(
      await loadBoxEnv(this.env, this.dirs.state),
      {},
      {
        ...this.seams,
        boxLookup: loopbackLookup,
        restart: () => this.restart(),
      },
    );
  }

  private restart(): void {
    const previous = this.restarting ?? Promise.resolve();
    this.restarting = previous.then(async () => {
      const server = this.server;
      this.server = undefined;
      try {
        await server?.close();
        await this.start();
      } catch (error) {
        this.restartFailure ??= error;
      }
    });
  }

  /** Settles a pending restart, then closes; returns what failed, the restart's failure first. */
  async close(): Promise<unknown[]> {
    const failures: unknown[] = [];
    await this.restarting;
    if (this.restartFailure !== undefined) failures.push(this.restartFailure);
    const server = this.server;
    this.server = undefined;
    try {
      await server?.close();
    } catch (error) {
      failures.push(error);
    }
    return failures;
  }
}

export async function runSpareJoinScenario(fixture: SpareJoinFixture): Promise<void> {
  const { bucket, scratch, signal } = fixture;
  const clock = stageClock(fixture.record, signal);
  const boxes: TestBox[] = [];
  const closeAll = async (): Promise<unknown[]> => {
    const failures: unknown[] = [];
    for (const box of boxes.splice(0)) failures.push(...(await box.close()));
    return failures;
  };
  let abortClose: Promise<unknown[]> | undefined;
  const onAbort = (): void => {
    abortClose = closeAll();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const failures: unknown[] = [];
  try {
    clock.begin("probe");
    const migrationsRoot = join(scratch, "migrations");
    const fromSource = migrationOptionsFor(manifestSets(), null);
    for (const [index, set] of manifestSets().entries()) {
      await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    // One draw: M's and S's HTTPS ports, then S's store and its versitygw's loopback port.
    const [portM, portS, storeS, storeLoopbackS] = (await freePorts(4)) as [
      number,
      number,
      number,
      number,
    ];
    const bootEnv = (dirs: BoxDirs, port: number): NodeJS.ProcessEnv => ({
      WAITRON_STATE_DIR: dirs.state,
      WAITRON_VENUE_DIR: dirs.venue,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_LITESTREAM_BIN: fixture.litestreamBin,
      WAITRON_VERSITYGW_BIN: fixture.versitygwBin,
      // The advertised origin: each box puts its own name in place of `waitron.local`.
      WAITRON_MANAGEMENT_ORIGIN: `https://${BOX_HOSTNAME}:${port}`,
      WAITRON_MANAGEMENT_RP_ID: BOX_HOSTNAME,
    });

    const dirsM = await boxDirs(scratch, "box-m");
    const m = await provisionStreamBox({
      dirs: dirsM,
      migrations: fromSource,
      advertisedOrigin: `https://${BOX_HOSTNAME}:${portM}`,
      bucket,
      recoveryKey: RECOVERY_KEY,
      modulesJson: MODULES_M,
      venue: {
        request: VENUE_M,
        modules: enabledModules(ALL_MODULES, parseModuleConfig(MODULES_M, ALL_MODULES)),
      },
    });
    const boxM = new TestBox(dirsM, portM, bootEnv(dirsM, portM), {});
    boxes.push(boxM);
    await boxM.start();
    const caM = await readFile(join(dirsM.state, "tls", "ca.crt"), "utf8");
    const viaM = httpsVia(caM);
    try {
      await fetchHealthOk(`https://127.0.0.1:${portM}/health`, viaM.via);
    } finally {
      await viaM.close();
    }

    const dirsS = await boxDirs(scratch, "box-s");
    const boxS = new TestBox(
      dirsS,
      portS,
      {
        ...bootEnv(dirsS, portS),
        WAITRON_ENV: "preproduction",
        WAITRON_SPARE_STORE_PORT: String(storeS),
        WAITRON_SPARE_STORE_LOOPBACK_PORT: String(storeLoopbackS),
      },
      {},
    );
    boxes.push(boxS);
    await boxS.start();

    // M's address is the one its chart gives it, at its own name; S reaches it through the lookup.
    const addressM = ownContactUrl(boxM.origin, m.nodeId);
    expect(new URL(addressM).hostname).not.toBe(BOX_HOSTNAME);
    const caS = await readFile(join(dirsS.state, "tls", "ca.crt"), "utf8");
    const viaS = httpsVia(caS);
    try {
      const read = await fetch(`https://127.0.0.1:${portS}/setup-api/primary-certificate`, {
        ...viaS.via,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ primaryUrl: addressM }),
      });
      const answer = (await read.json()) as unknown;
      expect(read.status, JSON.stringify(answer)).toBe(200);
      expect(answer).toMatchObject({
        fingerprint256: new X509Certificate(caM).fingerprint256,
      });
    } finally {
      await viaS.close();
    }
    clock.end("ok");
  } catch (error) {
    clock.end("failed");
    failures.push(error);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (abortClose !== undefined) failures.push(...(await abortClose));
    failures.push(...(await closeAll()));
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "spare join failed");
}
