// Imported first: its `vi.mock` of the internet clock must be in place before any fiscal module loads.
import { archiveHost, clock, key, root } from "./hour-recovery-host.js";
import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql, eq, and } from "drizzle-orm";
import { afterEach, expect } from "vitest";
import { invoiceSeries, openVenueDatabase, withTransaction } from "@waitron/db";
import { applyMigrationSet } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { parseModuleConfig } from "@waitron/module";
import { loadKeyRing } from "@waitron/credentials";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";
import { recordSale } from "@waitron/core";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { nodeId, seriesId } from "@waitron/shared";
import { VerifactuBackend } from "@waitron/fiscal-verifactu/src/backend.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { hourFirstFiscalFixture } from "./hour-first-fiscal.js";
import { keepHourRecoveryDocument } from "./hour-recovery-delivery.js";
import { MODULE, PASSWORD } from "./first-fiscal.js";
import { createFirstSetupBackupRecovery } from "../src/first-setup-backup-recovery.js";
import { encryptArtifact, decryptArtifact } from "../src/artifact-cipher.js";
import { packArchive, unpackArchive } from "../src/backup-archive.js";
import { establishNodeIdentity } from "../src/node-identity.js";
import { seedTermZeroMembership } from "../src/membership-seed.js";
import { publicFirstSetupState } from "../src/first-setup-owner.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "../src/provision.js";
import { mountSetup, type SetupDeps } from "../src/setup-api.js";
import { writeTradingEnv } from "../src/trading-config.js";

export interface HeldSetupOptions {
  /** Invoice records written through the fiscal module's own write path after activation. */
  invoices?: number;
  /** `committed`: publication fails after activation; `complete`: publication succeeds. */
  status?: "committed" | "complete";
  /** Publication writes `<state>/trading.env` before it fails or completes. */
  tradingSettings?: boolean;
  /** One committed row left in `venue.db-wal` and not in `venue.db`. */
  pendingWal?: boolean;
  /** `false`: no backup recovery is started beside the held database. */
  recovery?: boolean;
}

type BackupRecovery = ReturnType<typeof createFirstSetupBackupRecovery>;
interface HeldSetup {
  roots: { stateDir: string; venueDir: string };
  host: Awaited<ReturnType<typeof hourFirstFiscalFixture>>["host"];
  workspace: ReturnType<typeof createFirstSetupBackupWorkspace>;
  service: BackupRecovery | undefined;
  signIn(): Promise<{
    owner: { attemptId: string; revision: number; ownerGeneration: number; capability: string };
    ids: { inspectionId: string; revision: number; ownerGeneration: number };
  }>;
  installationName: string;
  /** `archiveHost()`'s backup. A wipe deletes its hour choice, so a restore after one chooses again. */
  archive: Awaited<ReturnType<typeof archiveHost>>;
}

const services: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
});

const ACCOUNT_KEY = Buffer.alloc(32, 8).toString("base64");

/**
 * A first setup activated for real into `<venue>/venue.db` with every module, then a backup
 * recovery opened, prepared and stopped beside it.
 * Call it once per test: it reuses `archiveHost()`'s single root. Importing this file brings in
 * `hour-recovery-host.ts`'s database suite, hooks and mocks.
 */
export function heldSetup(
  options: HeldSetupOptions & { recovery: false },
): Promise<HeldSetup & { service: undefined }>;
export function heldSetup(
  options?: HeldSetupOptions & { recovery?: true },
): Promise<HeldSetup & { service: BackupRecovery }>;
export async function heldSetup(options: HeldSetupOptions = {}): Promise<HeldSetup> {
  const status = options.status ?? "committed";
  const f = await archiveHost();
  const held = await openVenueDatabase(f.roots.venueDir);
  let open = true;
  try {
    for (const set of TEST_MIGRATIONS) await applyMigrationSet(held.venue, set);
    // A synthetic certificate stands in for the AEAT one, as `first-fiscal-interruption.test.ts` does.
    const modules = ALL_MODULES.map((module) =>
      module.name !== MODULE
        ? module
        : {
            ...module,
            fiscal: {
              ...module.fiscal!,
              provisioningSecret: {
                required: () => true,
                validate: () => {},
                seal: async () => {},
              },
            },
          },
    );
    const setup = await hourFirstFiscalFixture({
      clock,
      database: () => held.venue,
      modules,
      workspace: { root, ...f.roots },
    });
    const host = setup.host;
    const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: ACCOUNT_KEY });
    const deps: SetupDeps = {
      environment: "production",
      db: held.venue,
      ring,
      firstFiscal: host,
      provision: (request, beforeTransaction) =>
        provisionVenue(
          {
            ownerDb: held.venue,
            stateDir: f.roots.stateDir,
            database: "synthetic",
            moduleConfig: venueModuleConfig(
              parseModuleConfig({}, ALL_MODULES),
              request.venue.location.fiscalTerritory,
            ),
            beforeTransaction,
          },
          request,
          host.modules,
        ),
      recoverProvision: (request) => recoverProvisionedVenue(held.venue, request, host.modules),
      seedDemo: async () => {},
      establishIdentity: async (nodeId) => {
        await establishNodeIdentity({ ownerDb: held.venue, ring }, nodeId);
      },
      seedMembership: async (nodeId) => {
        await seedTermZeroMembership({ db: held.venue, ring }, nodeId, "https://test.example");
      },
      persistTrading: async (settings) => {
        if (options.tradingSettings === true)
          await writeTradingEnv(f.roots.stateDir, { ...settings, accountKey: ACCOUNT_KEY });
        if (status === "committed") throw new Error("injected publication failure");
      },
      requestRestart: () => {},
      assertFiscalReady: async () => {},
    };
    const app = new Hono();
    mountSetup(app, deps, () => {});
    const state = publicFirstSetupState((await host.store.read())!);
    const capability = setup.ownerAttempt.capability;
    await keepHourRecoveryDocument(host, { ...state, capability }, PASSWORD);
    const activated = await app.request("/setup-api/provision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitron-Setup-Owner": capability,
        "X-Waitron-Setup-Attempt": state.attemptId,
        "X-Waitron-Setup-Revision": String(state.revision),
        "X-Waitron-Setup-Generation": String(state.ownerGeneration),
      },
      body: JSON.stringify({
        mode: "live",
        aeatCert: { synthetic: true },
        email: {
          server: "smtp.example.test",
          port: 465,
          encryption: "tls",
          user: "test",
          password: "test",
          from: "owner@example.test",
        },
      }),
    });
    expect(activated.status).toBe(status === "committed" ? 500 : 200);
    const attempt = (await host.store.read())!;
    expect(attempt.status).toBe(status);
    const installationName = (
      attempt.inputs[MODULE] as { allocation: { installationIdentity: string } }
    ).allocation.installationIdentity;

    if ((options.invoices ?? 0) > 0) {
      const saleClock = {
        ...steadyClock,
        now: () => ({ ...steadyClock.now(), instant: new Date(), offsetMinutes: 120 }),
      };
      const aeat = createFakeAeat({ serverNow: new Date() });
      const backend = new VerifactuBackend({
        db: held.venue,
        clock: saleClock,
        deploymentEnvironment: attempt.frozen.environment,
        environment: attempt.frozen.environment,
        resolveClient: async () => aeat.client(),
      });
      const [standard] = await held.venue
        .select()
        .from(invoiceSeries)
        .where(
          and(
            eq(invoiceSeries.nodeId, attempt.frozen.nodeId),
            eq(invoiceSeries.code, `A-${installationName}`),
          ),
        );
      for (let sale = 0; sale < options.invoices!; sale++)
        await withTransaction(held.venue, (tx) =>
          recordSale(
            tx,
            backend,
            saleInput({
              nodeId: nodeId(attempt.frozen.nodeId),
              seriesId: seriesId(standard!.id),
              clock: saleClock,
            }),
          ),
        );
    }

    if (options.pendingWal === true) {
      held.venue.all(sql`pragma wal_checkpoint(truncate)`);
      held.venue.run(
        sql`insert into adjustment_settings (id, updated_at) values (1, ${new Date().toISOString()})`,
      );
      // A clean close checkpoints the row into venue.db and deletes the -wal; the copies taken
      // while open are put back so the row stays committed only in the -wal.
      const aside = await mkdtemp(join(tmpdir(), "held-setup-wal-"));
      try {
        for (const name of ["venue.db", "venue.db-wal"])
          await copyFile(join(f.roots.venueDir, name), join(aside, name));
        open = false;
        await held.close();
        for (const name of ["venue.db", "venue.db-wal"])
          await copyFile(join(aside, name), join(f.roots.venueDir, name));
      } finally {
        await rm(aside, { recursive: true, force: true });
      }
    } else {
      open = false;
      await held.close();
    }

    const workspace = createFirstSetupBackupWorkspace(f.roots);
    let service: BackupRecovery | undefined;
    if (options.recovery !== false) {
      const entries = unpackArchive(decryptArtifact(f.restore.artifact, f.restore.recoveryKey));
      entries.push({
        name: "secrets/module-evidence/fiscal-verifactu/hour-history.json",
        bytes: Buffer.from(
          JSON.stringify({ reference: "prepared-hours", complete: true, records: [] }),
        ),
      });
      const artifact = encryptArtifact(packArchive(entries), f.restore.recoveryKey);
      service = createFirstSetupBackupRecovery({
        ...f.roots,
        environment: "preproduction",
        modules: ALL_MODULES,
        host,
        workspace,
        sources: {
          ...f.restore,
          bucket: { litestreamBin: "/unused", now: () => new Date(), log: () => {} },
        },
        log: () => {},
      });
      services.push(service);
      await host.resolution.withVenueExclusion(async () => {});
      const inspected = await host.resolution.inspectFirstSetupResolution();
      const session = await service.open(
        {
          observation: {
            inspectionId: inspected.inspectionId,
            revision: inspected.revision,
            ownerGeneration: inspected.ownerGeneration,
          },
          source: {
            kind: "archive",
            artifact: Uint8Array.from(artifact),
            recoveryKey: f.restore.recoveryKey,
            environment: "preproduction",
          },
          nodeRecoverySecret: key.secret,
          context: { oldBoxGone: true, soleRecovery: true },
        },
        { onBox: false },
      );
      await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
      await service.close(session.sessionId);
    }

    /** The setup owner signed in again with the setup password, and the ids of a fresh inspection. */
    const signIn = async () => {
      const before = await host.resolution.inspectFirstSetupResolution();
      const recovered = await host.owner.recoverFirstSetupOwner({
        inspectionId: before.inspectionId,
        revision: before.revision!,
        ownerGeneration: before.ownerGeneration!,
        clientClaimNonce: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      });
      const current = await host.resolution.inspectFirstSetupResolution();
      return {
        owner: {
          attemptId: recovered.state.attemptId,
          revision: recovered.state.revision,
          ownerGeneration: recovered.state.ownerGeneration,
          capability: recovered.capability,
        },
        ids: {
          inspectionId: current.inspectionId,
          revision: current.revision!,
          ownerGeneration: current.ownerGeneration!,
        },
      };
    };
    return { roots: f.roots, host, workspace, service, signIn, installationName, archive: f };
  } finally {
    if (open) await held.close();
  }
}
