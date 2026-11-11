// Imported first: its `vi.mock` of the internet clock must be in place before any fiscal module loads.
import { archiveHost, clock, root } from "./hour-recovery-host.js";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql, eq, and } from "drizzle-orm";
import { expect } from "vitest";
import { invoiceSeries, openVenueDatabase, withTransaction } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { parseModuleConfig } from "@waitron/module";
import { loadKeyRing } from "@waitron/credentials";
import { recordSale } from "@waitron/core";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { nodeId, seriesId } from "@waitron/shared";
import { SCRATCH_DIR } from "@waitron/store";
import { VerifactuBackend } from "@waitron/fiscal-verifactu/src/backend.js";
import { saleInput, steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { makeAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { hourFirstFiscalFixture } from "./hour-first-fiscal.js";
import { migratedTemplate } from "./migrated-template.js";
import { keepHourRecoveryDocument } from "./hour-recovery-delivery.js";
import { MODULE, PASSWORD } from "./first-fiscal.js";
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
  /** One committed row left in `venue.db-wal` and not in `venue.db`, with the `-shm` beside them. */
  pendingWal?: boolean;
  /**
   * `venue.db`, its `-wal` and its `-shm` as copied while the database was open: rows of about
   * `databaseBytes` checkpointed into `venue.db`, then rows of about `walBytes` written to
   * `catalogues` in one transaction, then `invoices` invoice records. Past SQLite's 1000-page
   * automatic checkpoint a commit also copies its pages into `venue.db`.
   * `checkpointed` then moves every page into `venue.db` and empties the `-wal`.
   */
  crash?: { databaseBytes?: number; walBytes: number; invoices?: number; checkpointed?: boolean };
  /** Activation installs a real certificate through the fiscal module's own secret seat. */
  certificate?: boolean;
}

interface HeldSetup {
  roots: { stateDir: string; venueDir: string };
  host: Awaited<ReturnType<typeof hourFirstFiscalFixture>>["host"];
  installationName: string;
  /** `archiveHost()`'s backup. A wipe deletes its hour choice, so a restore after one chooses again. */
  archive: Awaited<ReturnType<typeof archiveHost>>;
}

const CRASH_FILES = ["venue.db", "venue.db-wal", "venue.db-shm"];
const ACCOUNT_KEY = Buffer.alloc(32, 8).toString("base64");

const heldTemplate = migratedTemplate("held-setup-template-", TEST_MIGRATIONS);

/**
 * A first setup activated for real into `<venue>/venue.db` with every module.
 * Call it once per test: it reuses `archiveHost()`'s single root. Importing this file brings in
 * `hour-recovery-host.ts`'s database suite, hooks and mocks.
 */
export async function heldSetup(options: HeldSetupOptions = {}): Promise<HeldSetup> {
  const status = options.status ?? "committed";
  const f = await archiveHost();
  await mkdir(join(f.roots.stateDir, SCRATCH_DIR), { recursive: true });
  const migrated = await heldTemplate();
  await Promise.all(
    ["venue.db", "node.db"].map((name) =>
      copyFile(join(migrated, name), join(f.roots.venueDir, name)),
    ),
  );
  const held = await openVenueDatabase(f.roots.venueDir);
  let open = true;
  try {
    const modules = ALL_MODULES.map((module) =>
      module.name !== MODULE || options.certificate === true
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
      node: held.node,
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
              request.venue.fiscalTerritory,
            ),
            beforeTransaction,
          },
          request,
          host.modules,
        ),
      recoverProvision: (request) => recoverProvisionedVenue(held.venue, request, host.modules),
      seedDemo: async () => {},
      establishIdentity: async (nodeId) => {
        await establishNodeIdentity({ ownerDb: held.venue, node: held.node, ring }, nodeId);
      },
      seedMembership: async (nodeId) => {
        await seedTermZeroMembership(
          { db: held.venue, node: held.node, ring },
          nodeId,
          "https://test.example",
        );
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
    const issued = options.certificate === true ? makeAuthority().issue() : undefined;
    const certificate =
      issued === undefined
        ? { synthetic: true }
        : {
            pfxBase64: issued.pfx.toString("base64"),
            passphrase: issued.passphrase,
            certKind: "sello",
          };
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
        aeatCert: certificate,
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

    const writeInvoices = async (count: number) => {
      if (count === 0) return;
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
      for (let sale = 0; sale < count; sale++)
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
    };
    await writeInvoices(options.invoices ?? 0);

    const crash = options.crash;
    if (options.pendingWal === true || crash !== undefined) {
      held.venue.all(sql`pragma wal_checkpoint(truncate)`);
      if (options.pendingWal === true)
        held.venue.run(
          sql`insert into settings (module, version, revision, doc, updated_at) values ('adjustments', 1, 1, '{}', ${new Date().toISOString()})`,
        );
      if (crash !== undefined) {
        const name = "x".repeat(4000);
        const at = new Date().toISOString();
        let row = 0;
        const write = (bytes: number) =>
          withTransaction(held.venue, async (tx) => {
            for (const end = row + Math.ceil(bytes / name.length); row < end; row++)
              await tx.run(
                sql`insert into catalogues (id, name, created_at, updated_at) values (${`crash-${row}`}, ${name}, ${at}, ${at})`,
              );
          });
        await write(crash.databaseBytes ?? 0);
        held.venue.all(sql`pragma wal_checkpoint(truncate)`);
        await write(crash.walBytes);
        await writeInvoices(crash.invoices ?? 0);
        if (crash.checkpointed === true) held.venue.all(sql`pragma wal_checkpoint(truncate)`);
      }
      // A clean close checkpoints the -wal into venue.db and deletes it; the copies taken while
      // open are put back.
      const aside = await mkdtemp(join(tmpdir(), "held-setup-wal-"));
      try {
        for (const name of CRASH_FILES)
          await copyFile(join(f.roots.venueDir, name), join(aside, name));
        open = false;
        await held.close();
        for (const name of CRASH_FILES)
          await copyFile(join(aside, name), join(f.roots.venueDir, name));
      } finally {
        await rm(aside, { recursive: true, force: true });
      }
    } else {
      open = false;
      await held.close();
    }

    return { roots: f.roots, host, installationName, archive: f };
  } finally {
    if (open) await held.close();
  }
}
