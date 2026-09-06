import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  captureError,
  readDeploymentMode,
  readSingletonRole,
  readStandardSeriesId,
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
  withTenant,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import type { Endorsement, SignedMembershipDocument } from "@waitron/membership";
// The same test-only entry point `packages/fiscal-verifactu`'s own drain suites use to seed a due
// `envios` row (boot.test.ts's drain e2e reuses it identically) — no `exports` map restricts either
// package, so the deep import resolves the way a same-package one would.
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { sealMirrorToken } from "./mirror-token.js";
import { parseEnvFile } from "./env-file.js";
import { roleUrl } from "./testing/postgres.js";
import { mintMtlsMaterial } from "./testing/tls.js";

// The headline e2e for the promote action (promote runbook design §8): a booted LOCAL SECONDARY
// (mode='primary', singleton_role='secondary') files NOTHING; an in-process promote flips
// singleton_role live; and the running fiscal pass BEGINS draining on its next tick — with the
// till surface answering 200 throughout (no restart). Real Postgres is mandatory (CLAUDE.md §4):
// it drives the real wall-clock loop, the owner-role `setSingletonRole` write (app_user holds no
// UPDATE on `deployment`), and a till route as the non-superuser `app_login` pool — PGlite cannot
// check the privilege split and serialises every query onto one backend.
//
// `undici`'s `fetch` is module-mocked to REJECT so the AEAT submit the post-promote drain makes fails
// fast: the seeded `envios` row transitions to an OBSERVABLE attempted state (`backoffBatch` sets
// intentos=1, incidencia=true, estado='pendiente') rather than leaving this suite dialling AEAT's real
// preproduction host. Node's OWN global `fetch` (a separate module identity from the `"undici"` npm
// specifier this mock intercepts — see boot.test.ts's header) still serves the `/api/staff` probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() => Promise.reject(new Error("undici fetch disabled in boot.promote.test.ts"))),
  };
});

// The till's fiscal identity — the five WAITRON_TILL_*_ID that put boot into TRADING mode (which is
// what exposes the in-process promote method). Distinct per field. Seeded (tenant + location) in
// `beforeAll` so boot's `readOrderFlow` / `readVenueLocale` reads resolve.
const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// A media dir under this suite's own temp root so boot's `mkdirSync(mediaDir)` never writes into
// `apps/server/src`. Created synchronously so `KEY_ENV` can reference it; torn down in `afterAll`.
const MEDIA_ROOT = mkdtempSync(join(tmpdir(), "waitron-promote-media-"));
// Boot config every production host carries: the credentials key `loadKeyRing` requires (a secondary
// is still a trading boot, so the ring is loaded before the fiscal pass is gated), plus the passkey RP
// id + origin `loadConfig` demands in production. `WAITRON_ENV: "production"` so it agrees with the
// deployment stamp below AND with `seedPendingEnvios`'s default `entorno` ("production") — otherwise
// `claimBatch`'s deployment-environment guard would refuse the seeded row before any submit attempt.
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_MEDIA_DIR: MEDIA_ROOT,
  WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
  WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  WAITRON_ENV: "production",
  ...TILL_ENV,
};

// A clone of the full-manifest template — this suite's own database (each `useTemplateDb` call clones
// afresh), so the deployment stamp + singleton_role flips it performs are isolated to this file.
const suite = useTemplateDb({ template: "manifest" });

let migrationsRoot: string;
// The app pool the running box uses (`app_login`, an `app_user` member — created cluster-wide by
// apps/server's globalSetup), exactly as a real trading box's pool is. The drain writes and the
// till route's queries both resolve through this role. Migrations + the promote's owner write run
// over the SUPERUSER uri (`suite.pg.uri`) instead, so this pool needs no CREATE /
// UPDATE-on-deployment grant.
let appDatabaseUrl: string;

// The box key ring, built from the SAME credentials key boot loads from `KEY_ENV` — so the identity
// this suite seals is the one the in-process promote unseals to sign the minted membership document.
const PROMOTE_RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

/**
 * Seed the boot till's tenant + location + node as the container superuser, so boot's
 * `readOrderFlow` / `readVenueLocale` reads resolve — the same minimal identity boot.test.ts's
 * drain suite seeds — plus a node identity (sealed signing key + stamped `nodes.public_key`) so
 * the promote's membership-document mint has a key to sign with. `order_flow` defaults to
 * `prepay`.
 */
async function seedTillIdentity(admin: Database): Promise<void> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'ES', '90111111H', 'Promote Till SL')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TILL_ENV.WAITRON_TILL_LOCATION_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID}, 'Barra',
            array['en']::text[], 'Hospitality')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into nodes (id, tenant_id, location_id, name)
    values (${TILL_ENV.WAITRON_TILL_NODE_ID}, ${TILL_ENV.WAITRON_TILL_TENANT_ID},
            ${TILL_ENV.WAITRON_TILL_LOCATION_ID}, 'Promote node')
    on conflict do nothing`);
  await establishNodeIdentity(
    { ownerDb: admin, ring: PROMOTE_RING },
    TILL_ENV.WAITRON_TILL_TENANT_ID,
    TILL_ENV.WAITRON_TILL_NODE_ID,
  );
}

beforeAll(async () => {
  // The migrations root, built exactly as boot.test.ts / boot.mirror.test.ts do: boot's
  // from-source default (`apps/server/src/drizzle`) does not exist under source, so
  // `WAITRON_MIGRATIONS_DIR` must point `applyMigrations` at the real journal content per manifest set.
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-promote-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  await seedTillIdentity(suite.admin);

  // Put the deployment into a local-secondary state: stamp production (matching WAITRON_ENV so the boot
  // guard passes; idempotent when the value already matches) then flip singleton_role to 'secondary'.
  // Both are OWNER writes (app_user holds no UPDATE on `deployment`), so they run on the superuser
  // admin. `mode` keeps its column default ('primary'). => (mode=primary, singleton_role=secondary).
  await stampDeployment(suite.admin, "production");
  await setSingletonRole(suite.admin, "secondary");
  expect(await readDeploymentMode(suite.admin)).toBe("primary");
  expect(await readSingletonRole(suite.admin)).toBe("secondary");

  appDatabaseUrl = roleUrl(suite.pg.uri, "app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  if (migrationsRoot !== undefined) await rm(migrationsRoot, { recursive: true, force: true });
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
});

/** An OS-assigned free port, released before use (boot.test.ts's helper — WAITRON_HTTP_PORT rejects
 * "0", so the host cannot bind an ephemeral port itself). */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Polls `predicate` up to ~10s (200 x 50ms) for its first defined value — boot.test.ts's shape. The
 * boot loop uses a real wall clock (not injectable at boot level), so passes are observed by polling. */
async function poll<T>(predicate: () => Promise<T | undefined>): Promise<T | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const value = await predicate();
    if (value !== undefined) return value;
    await delay(50);
  }
  return undefined;
}

/** Waits for the background loop to record at least one pass (proof it is live). */
async function waitForPass(state: { lastPassAt: Date | null }): Promise<void> {
  await poll(async () => state.lastPassAt ?? undefined);
  expect(state.lastPassAt).not.toBeNull();
}

/**
 * Seeds ONE due registro + its `envios` sidecar (estado='pendiente', intentos=0,
 * incidencia=false, due immediately) and seals a usable `fiscal.aeat` credential for that tenant,
 * so the drain ATTEMPTS the row (rather than skipping it for a missing credential) once this node
 * holds the singleton. Seeded against the SUPERUSER connection (as every setup here is).
 */
async function seedFiscalWork(): Promise<{ registroIds: string[]; tenantId: string }> {
  const seeded = await seedPendingEnvios(suite.admin, { count: 1 });
  const material = mintMtlsMaterial();
  await withTenant(suite.admin, seeded.tenantId, (tx) =>
    putCredential(tx, loadKeyRing(KEY_ENV), {
      tenantId: seeded.tenantId,
      purpose: "fiscal.aeat",
      value: {
        pfxBase64: material.clientPfx.toString("base64"),
        passphrase: material.clientPassphrase,
        certKind: "representante",
      },
    }),
  );
  return { registroIds: seeded.registroIds, tenantId: seeded.tenantId };
}

/** Reads the seeded `envios` row's observable columns via the superuser connection. */
async function readEnvio(
  registroId: string,
): Promise<{ estado: string; intentos: number; incidencia: boolean }> {
  const rows = await suite.admin.execute<{ estado: string; intentos: number; incidencia: boolean }>(
    sql`select estado, intentos, incidencia from envios where registro_id = ${registroId}`,
  );
  return rows.rows[0]!;
}

/** Deletes the fiscal sidecar rows a test seeded so the clone stays order-independent (CLAUDE.md §4):
 * `envios` (keyed by registro id) is what makes the tenant perpetually due; `incidents` (keyed by
 * tenant id — it carries no registro_id column, 0007_incidents.sql) is defensive against a failure
 * path that raises one, matching boot.test.ts's own drain-cleanup convention. */
async function cleanupFiscalWork(seeded: {
  registroIds: string[];
  tenantId: string;
}): Promise<void> {
  await suite.admin.execute(sql`delete from envios where registro_id in ${seeded.registroIds}`);
  await suite.admin.execute(sql`delete from incidents where tenant_id = ${seeded.tenantId}`);
}

// Short ticks so both the Phase A empty pass and the post-flip drain pass land inside the poll budget:
// an idle secondary's empty pass returns `nextDueAt: null`, so the loop otherwise sleeps `maxTickMs`
// (loop.ts's `sleepMsFor`). 1000ms is comfortably below drain's staleness budget, so the boot guard
// passes. `skipRetryMs` is set for completeness; the seeded tenant has a credential so it is not hit.
const TICK_ENV = {
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

describe("promote (real Postgres): local secondary → primary, live", () => {
  it("does not file as a secondary, then files on the next tick after a live promote — tills answer throughout", async () => {
    // A fresh (mode=primary, singleton_role=secondary) starting point for this test (a prior test may
    // have flipped the shared clone's singleton_role to 'primary').
    await setSingletonRole(suite.admin, "secondary");
    const seeded = await seedFiscalWork();
    const { registroIds } = seeded;
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      DATABASE_URL: appDatabaseUrl,
      // Superuser: the promote's short-lived owner pool opens from this URL to perform the
      // `setSingletonRole` write, and boot re-runs the (idempotent) migrations over it too.
      WAITRON_MIGRATIONS_DATABASE_URL: suite.pg.uri,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      // Phase A — a secondary. A pass has run (the loop is live), but the singleton-gated fiscal pass
      // is EMPTY for a non-singleton, so the seeded row is untouched.
      await waitForPass(server.health);

      // Mode-gated exposure (R3b): a NON-mirror trading box surfaces the local-secondary promote and
      // NOT the mirror promote — the discriminated dispatch in makeStartedServer picks exactly one.
      expect(server.promoteLocalSecondaryToPrimary).toBeDefined();
      expect(server.promoteMirrorToPrimary).toBeUndefined();
      expect(await readEnvio(registroIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 0,
        incidencia: false,
      });
      // The sale path answers (mode='primary', so no read-only gate; the route is unauthenticated).
      const staffA = await fetch(`${base}/api/staff`);
      expect(staffA.status).toBe(200);
      expect(await staffA.json()).toEqual([]);

      // Promote the running secondary IN-PROCESS — no restart. The single owner write flips
      // singleton_role to 'primary'; the holder refresh flips the running fiscal pass on its next tick.
      const result = await server.promoteLocalSecondaryToPrimary!({ oldNodeNeutralised: true });
      expect(result).toEqual({ alreadyPrimary: false });
      expect(await readSingletonRole(suite.admin)).toBe("primary");

      // Phase B — now the singleton. The next drain pass claims the seeded row and attempts the submit;
      // the mocked `undici` fetch rejects, so `claimBatch` incremented intentos to 1 and `backoffBatch`
      // set incidencia=true and re-queued it 'pendiente'. Poll — the wall-clock loop is not injectable.
      // Poll on `incidencia` (set by `backoffBatch`, the LAST step of a failed attempt), NOT `intentos`
      // (set at CLAIM, when estado is transiently 'enviando'): polling intentos races the assertion below
      // and can catch the row mid-attempt as {estado:'enviando', incidencia:false}.
      await poll(async () => ((await readEnvio(registroIds[0]!)).incidencia ? true : undefined));
      expect(await readEnvio(registroIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 1,
        incidencia: true,
      });

      // The sale path STILL answers across the live flip — the "no restart" claim, hit not asserted.
      const staffB = await fetch(`${base}/api/staff`);
      expect(staffB.status).toBe(200);
      expect(await staffB.json()).toEqual([]);
    } finally {
      await server.close();
      await cleanupFiscalWork(seeded);
    }
  }, 60_000);

  it("refuses an unattested promote and keeps filing off", async () => {
    // A fresh (mode=primary, singleton_role=secondary) starting point and its own seeded work.
    await setSingletonRole(suite.admin, "secondary");
    const seeded = await seedFiscalWork();
    const { registroIds } = seeded;
    const port = await freePort();

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      DATABASE_URL: appDatabaseUrl,
      WAITRON_MIGRATIONS_DATABASE_URL: suite.pg.uri,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    try {
      // A pass has run — the loop is live — but the node is still a secondary, so the seeded row is
      // untouched before the promote is even attempted.
      await waitForPass(server.health);

      // The fence guard refuses a promote whose attestation says the old node is NOT neutralised — a
      // plain throw BEFORE the owner write, so nothing changes. `captureError` + `isAppError` is the
      // repo idiom for asserting a thrown AppError code (`toSatisfy` is unavailable here).
      const error = await captureError(() =>
        server.promoteLocalSecondaryToPrimary!({ oldNodeNeutralised: false }),
      );
      expect(isAppError(error) && error.code).toBe("promotion.fence_not_attested");

      // The refusal left the node exactly as it was: still a secondary, still filing nothing.
      expect(await readSingletonRole(suite.admin)).toBe("secondary");
      expect(await readEnvio(registroIds[0]!)).toEqual({
        estado: "pendiente",
        intentos: 0,
        incidencia: false,
      });
    } finally {
      await server.close();
      await cleanupFiscalWork(seeded);
    }
  }, 60_000);
});

// R3b — the in-process MIRROR→PRIMARY promote wired into boot (spec §4). A booted mirror exposes
// `promoteMirrorToPrimary` (and NOT the local-secondary method); calling it runs the point-of-no-return
// owner transaction (mode+singleton → primary, term-guarded endorsed document), rewrites `trading.env`
// with the cloud's OWN reserved standard series id, and schedules a restart into mode=primary. Real
// Postgres for the owner-role writes + the reserved-SIF reads (CLAUDE.md §4); a SEPARATE clone so the
// mirror stamp + the (primary,primary) flip never leak into the local-secondary suite above.
const mirrorSuite = useTemplateDb({ template: "manifest" });

// The mirror's OWN venue ids, distinct from TILL_ENV so the two clones' seeds never collide. The NODE id
// is the generated standby's own id (filled in at seed time), and WAITRON_TILL_SERIES_ID boots as the
// primary's INERT designated series — the value the promote must OVERWRITE with the cloud's own reserved
// standard series.
const MIRROR_TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MIRROR_LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIRROR_TILL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIRROR_DESIGNATED_SERIES_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // inert, must be overwritten
const MIRROR_ORIGIN_NODE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // the primary this mirror pulls
const MIRROR_NUMERO_INSTALACION = 7;

/** Seed a fresh clone as a read-only mirror holding its OWN dormant identity (R2/R3a): tenant + location,
 * a reserved standby identity (own node + sealed key + endorsement + reserved SIF + reserved standard
 * series), a held term-3 membership chart, the DB-stored mirror connection config + sealed sync token the
 * mirror boot reads, and deployment stamped production then mode='mirror'. Returns the cloud's own nodeId
 * + the reserved standard series id the promote corrects trading.env to. */
async function seedMirrorIdentity(
  admin: Database,
): Promise<{ nodeId: string; standardSeriesId: string }> {
  await admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${MIRROR_TENANT_ID}, 'ES', '90222222H', 'Promote Cloud SL')
    on conflict do nothing`);
  await admin.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${MIRROR_LOCATION_ID}, ${MIRROR_TENANT_ID}, 'Barra', array['en']::text[], 'Hospitality')
    on conflict do nothing`);
  const t = await admin.execute<{ tax_id: string }>(
    sql`select tax_id from tenants where id = ${MIRROR_TENANT_ID}`,
  );
  const nif = t.rows[0]!.tax_id;

  const standby = generateStandbyIdentity();
  // The primary's endorsement of the cloud's own key, stored on the standby's `nodes` row. A placeholder
  // signature is fine here — the promote signer only READS it and attaches it to the minted document; the
  // transitive-trust VERIFICATION of a real endorsement is the adopt e2e's assertion.
  const endorsement: Endorsement = {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    endorsedBy: MIRROR_ORIGIN_NODE_ID,
    signature: "endorsement-sig",
  };
  await establishReservedStandbyIdentity(
    { ownerDb: admin, ring: PROMOTE_RING },
    {
      tenantId: MIRROR_TENANT_ID,
      locationId: MIRROR_LOCATION_ID,
      standby,
      nodeName: "cloud",
      filingModule: "verifactu",
      taxModule: "iva",
      modules: ALL_MODULES,
      reserved: {
        modules: {
          fiscal: {
            nif,
            idSistemaInformatico: "W1",
            numeroInstalacion: MIRROR_NUMERO_INSTALACION,
          },
        },
        series: [{ code: "FA-7", purpose: "standard" }],
        endorsement,
      },
    },
  );

  // A held term-3 chart: the outgoing primary serving, this node secondary — the promote bumps it to 4.
  const held: SignedMembershipDocument = {
    body: {
      term: 3,
      nodes: [
        { nodeId: MIRROR_ORIGIN_NODE_ID, contactUrl: "https://old", standing: "serving-primary" },
        { nodeId: standby.nodeId, contactUrl: "", standing: "serving-secondary" },
      ],
    },
    signerNodeId: MIRROR_ORIGIN_NODE_ID,
    signature: "held-placeholder-sig",
    endorsements: [],
  };
  await writeNodeMembership(admin, held);

  // The mirror's DB-stored connection config + sealed sync token the mirror boot requires (owner writes).
  // The relay is a dead loopback port — the pull/tunnel workers dial it and back off in the background,
  // which never blocks boot and is aborted on close().
  await writeMirrorConfig(admin, {
    relayUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca-pem",
    originNodeId: MIRROR_ORIGIN_NODE_ID,
  });
  await sealMirrorToken(admin, PROMOTE_RING, MIRROR_TENANT_ID, "mirror-sync-token");

  // Deployment: production (matching WAITRON_ENV) then mode='mirror' (co-sets singleton_role='secondary').
  await stampDeployment(admin, "production");
  await setDeploymentMode(admin, "mirror");
  const standardSeriesId = await readStandardSeriesId(admin, MIRROR_TENANT_ID, standby.nodeId);
  return { nodeId: standby.nodeId, standardSeriesId };
}

describe("promote (real Postgres): mirror → primary, in-process, restart-into-primary", () => {
  it("exposes promoteMirrorToPrimary (not the local method), promotes, and rewrites trading.env to the cloud's own series", async () => {
    const seed = await seedMirrorIdentity(mirrorSuite.admin);
    const port = await freePort();
    // A per-test state dir so the corrected `trading.env` lands somewhere isolated we can read back.
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-promote-mirror-state-"));

    const server = await startServer({
      ...KEY_ENV,
      ...TICK_ENV,
      // Override the local-secondary TILL_ENV that KEY_ENV carries with the mirror's own ids; the NODE id
      // is the cloud's OWN reserved id (R3a) and the series is the primary's INERT designated series.
      WAITRON_TILL_TENANT_ID: MIRROR_TENANT_ID,
      WAITRON_TILL_TILL_ID: MIRROR_TILL_ID,
      WAITRON_TILL_NODE_ID: seed.nodeId,
      WAITRON_TILL_SERIES_ID: MIRROR_DESIGNATED_SERIES_ID,
      WAITRON_TILL_LOCATION_ID: MIRROR_LOCATION_ID,
      DATABASE_URL: roleUrl(mirrorSuite.pg.uri, "app_login", "app_pw"),
      WAITRON_MIGRATIONS_DATABASE_URL: mirrorSuite.pg.uri,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      // A mirror boots with its own sync pool (loadMirrorSyncConfig reads this) — a sync_applier role.
      WAITRON_SYNC_DATABASE_URL: roleUrl(mirrorSuite.pg.uri, "sync_applier", "ap"),
      WAITRON_STATE_DIR: stateDir,
    }).catch(async (err: unknown) => {
      // On a boot failure `server` is never assigned, so the finally below never runs — clean up the
      // temp state dir here rather than leaking it.
      await rm(stateDir, { recursive: true, force: true });
      throw err;
    });

    // SAFETY (CLAUDE.md §4): the promote schedules `setTimeout(() => process.kill(pid, "SIGTERM"), 0)`.
    // Spy on process.kill so the restart NEVER fires a real SIGTERM at the vitest process; assert it was
    // scheduled instead. Installed before the promote so the next-tick timer hits the spy, restored below.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      // Mode-gated exposure (R3b): a MIRROR surfaces the mirror promote and NOT the local-secondary one.
      expect(server.promoteMirrorToPrimary).toBeDefined();
      expect(server.promoteLocalSecondaryToPrimary).toBeUndefined();

      const result = await server.promoteMirrorToPrimary!({ oldNodeNeutralised: true });
      expect(result).toEqual({ alreadyPrimary: false, seriesId: seed.standardSeriesId });

      // The point-of-no-return committed: deployment flipped to (primary, primary).
      expect(await readDeploymentMode(mirrorSuite.admin)).toBe("primary");
      expect(await readSingletonRole(mirrorSuite.admin)).toBe("primary");

      // The next-tick restart timer has fired into the spy — never a real SIGTERM.
      await delay(50);
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");

      // trading.env was rewritten: WAITRON_TILL_SERIES_ID is the cloud's OWN reserved standard series
      // (result.seriesId), NOT the inert designated series it booted with; every other id re-emitted.
      const persisted = parseEnvFile(readFileSync(join(stateDir, "trading.env"), "utf8"));
      expect(persisted.WAITRON_TILL_SERIES_ID).toBe(seed.standardSeriesId);
      expect(persisted.WAITRON_TILL_SERIES_ID).not.toBe(MIRROR_DESIGNATED_SERIES_ID);
      expect(persisted.WAITRON_TILL_NODE_ID).toBe(seed.nodeId);
      expect(persisted.WAITRON_TILL_TENANT_ID).toBe(MIRROR_TENANT_ID);
      expect(persisted.WAITRON_ENV).toBe("production");
    } finally {
      await server.close();
      killSpy.mockRestore();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 60_000);
});
