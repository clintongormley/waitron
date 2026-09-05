import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { captureError, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { enrolPeer, syncPullOnce, type HttpClient } from "@waitron/sync";
import type { Logger } from "./logger.js";
import { mountSyncApi } from "./sync-api.js";
import { ALL_SYNC_ENROLMENTS, MODULE_BY_TABLE } from "./modules.js";
import {
  captureFiscalRegistro,
  freshFiscalIds,
  seedFiscalParents,
  type FiscalIds,
} from "./testing/fiscal-fixtures.js";

// SP-3a apply gate — the two REFUSAL gates that stand in front of the fiscal-record apply loop, both
// on real Postgres over the real Hono `app.request` wire (PGlite would be a false pass, CLAUDE.md §4:
// the apply role is a non-superuser under FORCE RLS). Both are proven with a control in the OTHER
// direction (CLAUDE.md §1), so "nothing landed" is measured against a case where the same registro DOES
// land, never against silence:
//
//   1. ENVIRONMENT HANDSHAKE (apply.ts:171-190, gate 8) — applyBatch reads the target's authoritative
//      deployment.environment stamp and refuses a source advertising a DIFFERENT environment with
//      `sync.peer_environment_mismatch`, applying NOTHING, so a preproduction stream can never seed a
//      production fiscal chain (the unrecoverable burn, CLAUDE.md §5). Proven in BOTH mismatch
//      directions (preproduction target ← production source AND production target ← preproduction
//      source), then a matched pull lands the same registro.
//   2. MODULE-VERSION PARK (SP-2b, apply.ts:236-283) — a fiscal registro whose owning module the SOURCE
//      migrated AHEAD of this subscriber PARKS below the cursor (`versionParked`), never applied and
//      never dropped, until this node reboots and migrates. Distinguished from a DROP by a later
//      equal-version sweep that re-delivers and applies the identical registro, and from an incidental
//      no-apply by an equal-version control that lands a registro with `versionParked === 0`.
//
// apps/server is english-only-EXEMPT (apps/* is out of scope), so the Spanish fiscal names appear
// verbatim. This file reuses the Task 6-8 fiscal fixtures rather than re-seeding by hand.
const log: Logger = () => {};

const source = useTemplateDb({ template: "manifest" });
const target = useTemplateDb({ template: "manifest" });

// A fixed subscriber id (the target's half of every cursor key). Each test uses a FRESH origin node id
// (freshFiscalIds), so its (subscriber, origin, ordered) cursor is fresh and the tests never interfere.
const SUBSCRIBER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Env = "production" | "preproduction";

let targetApplier: Database; // sync_applier: app_user (apply INSERT) + sync_tailer (cursor)
let sourceReader: Database; // the mounted source's serve pool
let sourceWriter: Database; // app_login: the app writer whose insert the capture trigger sees
let sourcePeerToken: string;

/** Stamp the target's singleton deployment.environment (applyBatch reads it — apply.ts:172). */
async function stampEnv(db: Database, environment: Env): Promise<void> {
  await db.execute(sql`insert into deployment (id, environment) values (1, ${environment})
    on conflict (id) do update set environment = excluded.environment`);
}

/** The HTTP seam: a real Hono app.request against a source mounting the SAME assembled enrolment set,
 * advertising `environment` and `moduleVersions` on /hello. `tenantId` scopes the source's /log read
 * (sync-api.ts reads sync_log inside withTenant under FORCE RLS), so each test serves its own tenant. */
function sourceHttp(
  environment: Env,
  tenantId: string,
  moduleVersions: Record<string, number>,
): HttpClient {
  const app = new Hono();
  mountSyncApi(
    app,
    {
      db: sourceReader,
      tenantId,
      nodeId: "00000000-0000-4000-8000-000000000000", // /log filters by the peer's ?originId=, not this
      environment,
      enrolments: ALL_SYNC_ENROLMENTS,
      moduleVersions,
    },
    log,
  );
  return (url, init) => Promise.resolve(app.request(url, { headers: init.headers }));
}

interface DepsOpts {
  /** What the subscriber believes it is (must equal the DB stamp, or applyBatch refuses the CALLER,
   * not the peer — a different, plain-Error guard). Default "production". */
  localEnvironment?: Env;
  /** What the mounted source advertises on /hello. Default "production". */
  sourceEnvironment?: Env;
  /** The source's advertised per-module versions (empty → the version gate is DISABLED). */
  sourceModuleVersions?: Record<string, number>;
  /** THIS subscriber's own per-module versions (the lower side of the gate). */
  subscriberModuleVersions?: Record<string, number>;
  /** table → owning module. Empty for the env test (park gate irrelevant); MODULE_BY_TABLE for park. */
  moduleByTable?: ReadonlyMap<string, string>;
}

/** The pull deps for an ordered-lane pull of `tenantId`'s tail into the target. */
function depsFor(tenantId: string, opts: DepsOpts = {}) {
  return {
    localDb: targetApplier,
    subscriberId: SUBSCRIBER,
    tenantId,
    localEnvironment: opts.localEnvironment ?? "production",
    http: sourceHttp(
      opts.sourceEnvironment ?? "production",
      tenantId,
      opts.sourceModuleVersions ?? {},
    ),
    batchLimit: 500,
    enrolments: ALL_SYNC_ENROLMENTS,
    moduleVersions: opts.subscriberModuleVersions ?? {},
    moduleByTable: opts.moduleByTable ?? new Map<string, string>(),
  } as const;
}

/** Seed the SAME FK closure on both databases so a captured source registro's FKs resolve on apply. */
async function seedBothSides(): Promise<FiscalIds> {
  const ids = freshFiscalIds();
  await seedFiscalParents(source.admin, { ids });
  await seedFiscalParents(target.admin, { ids });
  return ids;
}

/** How many registros_facturacion rows with this id sit on the target (0 = absent, 1 = landed). */
async function targetRegistroCount(registroId: string): Promise<number> {
  const r = await target.admin.execute<{ n: number }>(
    sql`select count(*)::int as n from registros_facturacion where id = ${registroId}`,
  );
  return r.rows[0]!.n;
}

/** The source's max sync_log seq for this origin — the seq a landed pull advances the cursor to. */
async function sourceMaxSeq(originId: string): Promise<bigint> {
  const r = await source.admin.execute<{ seq: string | null }>(
    sql`select max(seq)::text as seq from sync_log where origin_id = ${originId}::uuid`,
  );
  return r.rows[0]?.seq ? BigInt(r.rows[0].seq) : 0n;
}

/** This subscriber's ordered-lane cursor for `originId` (0n when no row exists yet). */
async function targetCursor(originId: string): Promise<bigint> {
  const r = await targetApplier.execute<{ seq: string }>(
    sql`select last_applied_seq::text as seq from sync_cursor
        where subscriber_id = ${SUBSCRIBER} and origin_id = ${originId}::uuid and lane = 'ordered'`,
  );
  return r.rows[0] ? BigInt(r.rows[0].seq) : 0n;
}

beforeAll(async () => {
  await stampEnv(target.admin, "production");
  targetApplier = await target.pg.connectAs("sync_applier", "ap");
  sourceReader = await source.pg.connectAs("sync_applier", "ap");
  sourceWriter = await source.pg.connectAs("app_login", "app_pw");
  sourcePeerToken = (await enrolPeer(source.admin, { subscriberId: "sp3a-park-env", name: "sp3a" }))
    .token;
});

afterAll(async () => {
  // Only the connectAs handles are closed here; the two admin connections and both clones are owned and
  // torn down by the two useTemplateDb calls (CLAUDE.md §4: never double-close a helper-owned conn).
  if (sourceWriter !== undefined) await sourceWriter.close();
  if (sourceReader !== undefined) await sourceReader.close();
  if (targetApplier !== undefined) await targetApplier.close();
});

describe("fiscal apply gate — environment handshake refuses a mismatched peer", () => {
  it("refuses in BOTH mismatch directions before applying anything, then applies once the environment matches", async () => {
    // FAILING CASE this distinguishes: an apply that skipped the handshake would seed the target's
    // fiscal chain from a peer in the WRONG environment — the unrecoverable cross-environment burn
    // (CLAUDE.md §5). The control in the OTHER direction is the matched pull at the end: it lands the
    // SAME registro, so the two mismatch "count === 0" readings measure the refusal, not a registro
    // that could never apply (CLAUDE.md §1, "a measurement taken where both answers look alike").
    const ids = await seedBothSides();
    const seeded = await captureFiscalRegistro(sourceWriter, ids); // a primer registro on the source
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };
    const maxSeq = await sourceMaxSeq(ids.nodeId);
    expect(maxSeq).toBeGreaterThan(0n); // the capture trigger did write a sync_log row to pull

    // Direction 1 — preproduction target ← production source. localEnvironment tracks the stamp (so the
    // guard under test is source-vs-stamp, not the caller-vs-stamp guard), the source advertises the
    // OTHER environment → sync.peer_environment_mismatch, nothing applied.
    await stampEnv(target.admin, "preproduction");
    const mismatchA = await captureError(() =>
      syncPullOnce(
        depsFor(ids.tenantId, {
          localEnvironment: "preproduction",
          sourceEnvironment: "production",
        }),
        peer,
      ),
    );
    expect(mismatchA).toBeInstanceOf(AppError);
    expect((mismatchA as AppError).code).toBe("sync.peer_environment_mismatch");
    expect(await targetRegistroCount(seeded.registroId)).toBe(0); // nothing crossed
    expect(await targetCursor(ids.nodeId)).toBe(0n); // the cursor never moved

    // Direction 2 — production target ← preproduction source. The mirror image, so the refusal is
    // symmetric and not an artefact of which environment is "lower".
    await stampEnv(target.admin, "production");
    const mismatchB = await captureError(() =>
      syncPullOnce(
        depsFor(ids.tenantId, {
          localEnvironment: "production",
          sourceEnvironment: "preproduction",
        }),
        peer,
      ),
    );
    expect(mismatchB).toBeInstanceOf(AppError);
    expect((mismatchB as AppError).code).toBe("sync.peer_environment_mismatch");
    expect(await targetRegistroCount(seeded.registroId)).toBe(0); // still nothing crossed

    // Control (the other direction) — matched environments land the SAME registro over the SAME wire.
    const applied = await syncPullOnce(
      depsFor(ids.tenantId, { localEnvironment: "production", sourceEnvironment: "production" }),
      peer,
    );
    expect(applied.applied).toBe(1);
    expect(await targetRegistroCount(seeded.registroId)).toBe(1); // now on the mirror
    expect(await targetCursor(ids.nodeId)).toBe(maxSeq); // and the cursor advanced to the source tail
  });
});

describe("fiscal apply gate — module-version park (SP-2b) holds a version-ahead registro below the cursor", () => {
  it("parks a registro whose fiscal module the source migrated ahead, never dropping it — a later equal-version sweep re-delivers and applies it", async () => {
    // The gate: isVersionAhead parks the row when sourceModuleVersions[fiscal] > subscriberModuleVersions
    // [fiscal] (apply.ts:236-241), because jsonb_populate_record would SILENTLY drop a column the older
    // subscriber schema lacks — cross-node fiscal corruption. Parking holds it below the cursor.
    //
    // PROVEN BY DELETION (the version wiring): drive the pull with an EMPTY moduleByTable instead of
    // MODULE_BY_TABLE and isVersionAhead returns false for every row (apply.ts:238-239) → the registro
    // applies on the first pull and `versionParked` is 0, failing the assertions below. Confirmed in a
    // scratch run (task report). So this test measures the version gate, not an incidentally-absent row.
    const ids = await seedBothSides();
    const seeded = await captureFiscalRegistro(sourceWriter, ids);
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };
    const maxSeq = await sourceMaxSeq(ids.nodeId);

    // Pull #1 — subscriber fiscal BEHIND the source (1 < 2). The registro parks: counted once, absent
    // on the mirror, and the cursor HELD below the parked seq (apply.ts:301-310) so a later sweep
    // re-delivers it. A park is NOT an apply (applied stays 0) and NOT a drop (the row is redelivered).
    const parked = await syncPullOnce(
      depsFor(ids.tenantId, {
        sourceModuleVersions: { fiscal: 2 },
        subscriberModuleVersions: { fiscal: 1 },
        moduleByTable: MODULE_BY_TABLE,
      }),
      peer,
    );
    expect(parked.versionParked).toBe(1);
    expect(parked.applied).toBe(0);
    expect(await targetRegistroCount(seeded.registroId)).toBe(0); // held off the mirror
    expect(await targetCursor(ids.nodeId)).toBeLessThan(maxSeq); // cursor held below the parked seq
    expect(await targetCursor(ids.nodeId)).toBe(0n); // in fact never advanced (the only row parked)

    // Pull #2 — the equal-version sweep (fiscal 2 == 2), modelling the subscriber having rebooted and
    // migrated. Because the cursor was HELD (not advanced past a dropped row), the SAME seq is re-fetched
    // and now APPLIES — the proof the registro was parked, not dropped. Equal versions never park.
    const swept = await syncPullOnce(
      depsFor(ids.tenantId, {
        sourceModuleVersions: { fiscal: 2 },
        subscriberModuleVersions: { fiscal: 2 },
        moduleByTable: MODULE_BY_TABLE,
      }),
      peer,
    );
    expect(swept.versionParked).toBe(0); // equal versions do not park
    expect(swept.applied).toBe(1); // the previously-parked registro landed on re-delivery
    expect(await targetRegistroCount(seeded.registroId)).toBe(1); // now on the mirror
    expect(await targetCursor(ids.nodeId)).toBe(maxSeq); // cursor advanced to the source tail
  });

  it("equal versions never park — a fresh registro at fiscal 2 == 2 applies on the first pull (versionParked 0)", async () => {
    // The control in the other direction for the park above: a registro pulled with the version gate
    // ACTIVE (populated moduleByTable + source moduleVersions) but versions EQUAL applies immediately
    // and parks nothing. So the park in the first test is driven by the version SKEW, not by fiscal rows
    // being unparkable-by-default nor by the mere presence of MODULE_BY_TABLE.
    const ids = await seedBothSides();
    const seeded = await captureFiscalRegistro(sourceWriter, ids);
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };
    const maxSeq = await sourceMaxSeq(ids.nodeId);

    const result = await syncPullOnce(
      depsFor(ids.tenantId, {
        sourceModuleVersions: { fiscal: 2 },
        subscriberModuleVersions: { fiscal: 2 },
        moduleByTable: MODULE_BY_TABLE,
      }),
      peer,
    );
    expect(result.versionParked).toBe(0);
    expect(result.applied).toBe(1);
    expect(await targetRegistroCount(seeded.registroId)).toBe(1);
    expect(await targetCursor(ids.nodeId)).toBe(maxSeq);
  });
});
