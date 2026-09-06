import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { enrolPeer, syncPullOnce, type HttpClient } from "@waitron/sync";
import type { Logger } from "./logger.js";
import { mountSyncApi } from "./sync-api.js";
import { ALL_SYNC_ENROLMENTS } from "./modules.js";
import {
  captureFiscalRegistro,
  freshFiscalIds,
  seedFiscalParents,
  type FiscalIds,
} from "./testing/fiscal-fixtures.js";

// SP-3a apply gate, Task 7 — mutable-table upsert NON-REGRESSION for the five MUTABLE fiscal tables
// (registro_sif, cadenas, envios, envio_flujo, acks). The immutable ledger's verbatim/idempotent/
// immutable properties are Task 6 (fiscal-apply.test.ts); this file proves the OTHER half of the
// lane: when the source mutates a row, the mirror converges on the NEWER state and a late OLDER image
// NEVER regresses it. Same harness as Task 6 — two `manifest` clones (source + target) driven over a
// real Hono `app.request` wire, applied as the non-superuser `sync_applier`. PGlite
// would be a false pass (CLAUDE.md §4): the apply role is non-superuser and the watermark/seq guards
// are what is under test.
//
// Two non-regression MECHANISMS are exercised, one per enrolment shape (apply-sql.ts):
//   - WATERMARK guard (cadenas, watermarkColumn = actualizado_en): the apply is
//     `… DO UPDATE SET … WHERE excluded.actualizado_en > cadenas.actualizado_en`, so an older/equal
//     image is a row-level no-op even when re-fetched.
//   - SEQ CURSOR (registro_sif / envios / envio_flujo / acks, watermarkColumn = null): the apply is an
//     UNCONDITIONAL `DO UPDATE SET` (acks also DELETEs); non-regression rests on ascending-seq apply +
//     the monotonic cursor, since the source stamps the newest write with the highest seq.
//
// Each test re-delivers the whole origin tail (cursor reset to 0, re-pull) and asserts `fetched`
// reflects the re-delivery — so the test SELF-PROVES it exercised the apply path rather than a cursor
// no-op that fetched nothing (the observability gap the Task 6 review flagged). The §1 out-of-seq
// control (a stale image stamped with a HIGHER seq regresses the mirror, so the assertion catches it)
// is a documented scratch run in the task report, not a committed assertion.
//
// This suite lives in apps/server, the composition root: it drives the apply lane through `mountSyncApi`
// + the assembled `ALL_SYNC_ENROLMENTS`, which live only here, and `fiscal-verifactu` cannot import
// `apps/server` (dependency inversion) — that, not english-only, is why it is here. Spanish fiscal names
// ride verbatim because apps/* is english-only-exempt, a non-discriminating aside (packages/
// fiscal-verifactu is exempt too).
const log: Logger = () => {};

const source = useTemplateDb({ template: "manifest" });
const target = useTemplateDb({ template: "manifest" });

// A fixed subscriber id (the target's half of the cursor key). Each test uses a FRESH origin node id,
// so its (subscriber, origin, ordered) cursor is fresh and the tests never interfere.
const SUBSCRIBER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let targetApplier: Database; // sync_applier: app_user grants for apply and cursor writes
let sourceReader: Database; // the mounted source's serve pool (sync_applier)
let sourceWriter: Database; // app_login: the app writer whose writes the capture triggers see
let sourcePeerToken: string;

// registro_sif carries a partial UNIQUE (tenant_id, node_id) WHERE revocado_en IS NULL and a global
// UNIQUE (nif, id_sistema_informatico, numero_instalacion). A distinct nif + numero per SIF-under-test
// keeps every seeded/tested SIF collision-free across the file's shared clones.
let sifSeq = 0;

async function stampEnv(db: Database, environment: "production" | "preproduction"): Promise<void> {
  await db.execute(sql`insert into deployment (id, environment) values (1, ${environment})
    on conflict (id) do update set environment = excluded.environment`);
}

/**
 * Mount the source for this test's tenant configuration. The source reads sync_log through
 * withTenant, which adds no tenant filter; the suite has a separate source database and selects
 * captured rows by origin when pulling.
 */
function sourceHttp(tenantId: string): HttpClient {
  const app = new Hono();
  mountSyncApi(
    app,
    {
      db: sourceReader,
      tenantId,
      nodeId: "00000000-0000-4000-8000-000000000000", // /log filters by the peer's ?originId=, not this
      environment: "production",
      enrolments: ALL_SYNC_ENROLMENTS,
      moduleVersions: {},
    },
    log,
  );
  return (url, init) => Promise.resolve(app.request(url, { headers: init.headers }));
}

/** The ordered-lane pull deps for `tenantId`'s tail into the target (Task 6 shape). */
function depsFor(tenantId: string) {
  return {
    localDb: targetApplier,
    subscriberId: SUBSCRIBER,
    tenantId,
    localEnvironment: "production",
    http: sourceHttp(tenantId),
    batchLimit: 500,
    enrolments: ALL_SYNC_ENROLMENTS,
    moduleVersions: {},
    moduleByTable: new Map<string, string>(),
  } as const;
}

/** Seed the SAME FK closure on both databases so a captured source row's FKs resolve on apply. */
async function seedBothSides(): Promise<FiscalIds> {
  const ids = freshFiscalIds();
  await seedFiscalParents(source.admin, { ids });
  await seedFiscalParents(target.admin, { ids });
  return ids;
}

/**
 * Run one write on the SOURCE as the app writer so the fiscal capture trigger fires and the row
 * lands in sync_log under origin = `originNodeId` (the pull's ?originId=). `app.node_id` (capture
 * origin) is bound transaction-locally by `withTenant`.
 */
async function captureWrite(
  tenantId: string,
  originNodeId: string,
  statement: Parameters<Database["execute"]>[0],
): Promise<void> {
  await withTenant(sourceWriter, tenantId, (tx) => tx.execute(statement), { nodeId: originNodeId });
}

/** Reset this subscriber's cursor for `originId` to 0, so the next pull re-fetches the WHOLE origin
 * tail — the re-delivery under test. The (subscriber, origin) pair holds one ordered-lane cursor row. */
async function rewindCursor(originId: string): Promise<void> {
  await targetApplier.execute(
    sql`update sync_cursor set last_applied_seq = 0
        where subscriber_id = ${SUBSCRIBER} and origin_id = ${originId}::uuid and lane = 'ordered'`,
  );
}

/** Read one scalar off the MIRROR (superuser) — the observed post-apply state. */
async function mirror<T>(query: Parameters<Database["execute"]>[0]): Promise<T | undefined> {
  const r = await target.admin.execute<{ v: T }>(query);
  return r.rows[0]?.v;
}

beforeAll(async () => {
  await stampEnv(target.admin, "production");
  targetApplier = await target.pg.connectAs("sync_applier", "ap");
  sourceReader = await source.pg.connectAs("sync_applier", "ap");
  sourceWriter = await source.pg.connectAs("app_login", "app_pw");
  sourcePeerToken = (await enrolPeer(source.admin, { subscriberId: "sp3a-upsert", name: "sp3a-u" }))
    .token;
});

afterAll(async () => {
  // Only the connectAs handles are closed here; the two admin connections and both clones are owned by
  // the two useTemplateDb calls (CLAUDE.md §4: never double-close a helper-owned connection).
  if (sourceWriter !== undefined) await sourceWriter.close();
  if (sourceReader !== undefined) await sourceReader.close();
  if (targetApplier !== undefined) await targetApplier.close();
});

describe("fiscal upsert gate — mutable-table non-regression", () => {
  it("registro_sif: revocation wins, and a re-delivered active image never un-revokes it (seq cursor)", async () => {
    // FAILING CASE: an apply that dropped the seq-cursor skip (or applied a stale image last) would
    // leave the mirror SIF active after a revocation — a revoked identity reading as live. The re-
    // delivery below re-feeds the OLD active image; the mirror must stay revoked. `fetched === 2`
    // proves both images were re-fetched (not a cursor no-op), so the assertion actually exercised the
    // upsert path. Out-of-seq §1 control: report §"out-of-seq control".
    const ids = await seedBothSides();
    // A FRESH node for the SIF under test: the seeded closure already holds an ACTIVE SIF on
    // ids.nodeId, and registro_sif_activo_uq forbids a second active SIF on the same (tenant, node).
    const originNode = randomUUID();
    for (const db of [source.admin, target.admin]) {
      await db.execute(
        sql`insert into nodes (id, tenant_id, location_id, name)
            values (${originNode}, ${ids.tenantId}, ${ids.locationId}, 'SIF node')`,
      );
    }
    const sifId = randomUUID();
    const n = sifSeq++;
    const nif = `SIFU${String(n).padStart(6, "0")}`;
    const numero = 700000 + n;
    const peer = { nodeId: originNode, url: "", token: sourcePeerToken };
    const byId = sql`from registro_sif where id = ${sifId}`;

    // Delivery 1 — the ACTIVE SIF (revocado_en NULL).
    await captureWrite(
      ids.tenantId,
      originNode,
      sql`insert into registro_sif (id, tenant_id, node_id, nif, id_sistema_informatico, numero_instalacion)
          values (${sifId}, ${ids.tenantId}, ${originNode}, ${nif}, 'WAITRON01', ${numero})`,
    );
    const d1 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d1.fetched).toBe(1);
    expect(d1.applied).toBe(1);
    expect(await mirror(sql`select revocado_en as v ${byId}`)).toBeNull(); // active on the mirror

    // Delivery 2 — the SAME SIF revoked in place (revocado_en set) — the NEWER image.
    const revocadoEn = "2026-07-21T09:00:00+00:00";
    await captureWrite(
      ids.tenantId,
      originNode,
      sql`update registro_sif set revocado_en = ${revocadoEn} where id = ${sifId}`,
    );
    const d2 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d2.fetched).toBe(1);
    expect(d2.applied).toBe(1);
    expect(await mirror(sql`select revocado_en as v ${byId}`)).not.toBeNull(); // revoked wins

    // Re-deliver the whole tail (active image first, then the revoke) — the OLD active image is re-fed.
    await rewindCursor(originNode);
    const d3 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d3.fetched).toBe(2); // BOTH images re-fetched — the re-delivery genuinely happened
    expect(d3.applied).toBe(2); // both re-applied (unconditional DO UPDATE SET)
    expect(await mirror(sql`select revocado_en as v ${byId}`)).not.toBeNull(); // STILL revoked
  });

  it("cadenas: the actualizado_en watermark drops a re-delivered older chain head", async () => {
    // FAILING CASE: without the `WHERE excluded.actualizado_en > cadenas.actualizado_en` guard, re-
    // delivering the secuencia=1/t1 image would overwrite the mirror's secuencia=2/t2 head — a chain
    // head regressed to a stale predecessor pointer. Here the watermark makes the re-delivery a pure
    // no-op: `d3.applied === 0` even though `d3.fetched === 3`, so the guard (not an empty fetch) is
    // what held the line.
    const ids = await seedBothSides();
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };
    const t1 = "2026-07-20T10:00:00+00:00";
    const t2 = "2026-07-20T11:00:00+00:00";
    const key = sql`from cadenas where tenant_id = ${ids.tenantId} and node_id = ${ids.nodeId}`;

    // The chain head points at a real registro (ultimo_registro_id FK) — capture + deliver it so the
    // mirror carries the SAME id its cadenas row references.
    const reg = await captureFiscalRegistro(sourceWriter, ids, { secuencia: 1 });
    expect((await syncPullOnce(depsFor(ids.tenantId), peer)).applied).toBe(1);

    // Delivery 1 — head at secuencia=1, actualizado_en=t1.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`insert into cadenas (tenant_id, node_id, secuencia, ultimo_registro_id, ultima_huella, actualizado_en)
          values (${ids.tenantId}, ${ids.nodeId}, 1, ${reg.registroId}, ${reg.huella}, ${t1})`,
    );
    const d1 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d1.fetched).toBe(1);
    expect(d1.applied).toBe(1);
    expect(await mirror(sql`select secuencia as v ${key}`)).toBe(1);

    // Delivery 2 — advance to secuencia=2, actualizado_en=t2 (> t1) — the NEWER head.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`update cadenas set secuencia = 2, actualizado_en = ${t2}
          where tenant_id = ${ids.tenantId} and node_id = ${ids.nodeId}`,
    );
    const d2 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d2.applied).toBe(1);
    expect(await mirror(sql`select secuencia as v ${key}`)).toBe(2);

    // Re-deliver the whole tail: the registro (ON CONFLICT DO NOTHING) + BOTH cadenas images. The
    // watermark drops the t1 AND the t2 image (neither exceeds the mirror's t2), so nothing regresses.
    await rewindCursor(ids.nodeId);
    const d3 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d3.fetched).toBe(3); // registro + cadenas insert + cadenas update, all re-fetched
    expect(d3.applied).toBe(0); // the watermark + insert-only guards made every re-delivery a no-op
    expect(await mirror(sql`select secuencia as v ${key}`)).toBe(2); // STILL at 2
  });

  it("envios: estado converges on aceptado and a re-delivered pendiente never regresses it (seq cursor)", async () => {
    // FAILING CASE: a stale 'pendiente' image applied after 'aceptado' would drag an accepted
    // submission back to pending. Ascending-seq apply lands the newer estado last; `fetched === 3`
    // proves the pendiente image was actually re-fetched on re-delivery.
    const ids = await seedBothSides();
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };
    const reg = await captureFiscalRegistro(sourceWriter, ids, { secuencia: 1 });
    expect((await syncPullOnce(depsFor(ids.tenantId), peer)).applied).toBe(1);
    const byReg = sql`from envios where registro_id = ${reg.registroId}`;

    // Delivery 1 — the sidecar in 'pendiente'.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`insert into envios (registro_id, tenant_id, estado) values (${reg.registroId}, ${ids.tenantId}, 'pendiente')`,
    );
    const d1 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d1.fetched).toBe(1);
    expect(d1.applied).toBe(1);
    expect(await mirror(sql`select estado as v ${byReg}`)).toBe("pendiente");

    // Delivery 2 — 'aceptado' — the NEWER estado.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`update envios set estado = 'aceptado' where registro_id = ${reg.registroId}`,
    );
    const d2 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d2.applied).toBe(1);
    expect(await mirror(sql`select estado as v ${byReg}`)).toBe("aceptado");

    // Re-deliver the whole tail: registro (DO NOTHING) + 'pendiente' + 'aceptado'. Seq order applies
    // 'pendiente' then 'aceptado', so the mirror ends aceptado despite the stale image being re-fed.
    await rewindCursor(ids.nodeId);
    const d3 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d3.fetched).toBe(3); // registro + both envios images re-fetched
    expect(d3.applied).toBe(2); // both envios images re-applied (unconditional upsert)
    expect(await mirror(sql`select estado as v ${byReg}`)).toBe("aceptado"); // STILL aceptado
  });

  it("envio_flujo: a re-delivered older proximo_envio_en never regresses the newer (seq cursor)", async () => {
    // FAILING CASE: the per-tenant flow-control window rolled back to an earlier time would let this
    // obligado send before AEAT's supplied wait elapsed. Newer proximo_envio_en wins; the re-delivery's
    // `fetched === 2` proves the older window was re-fetched.
    const ids = await seedBothSides();
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };
    const p1 = "2026-07-20T10:00:00+00:00";
    const p2 = "2026-07-20T12:00:00+00:00";
    const key = sql`from envio_flujo where tenant_id = ${ids.tenantId}`;
    const epoch = sql`extract(epoch from proximo_envio_en)::bigint::text as v`;

    // Delivery 1 — the flow-control row at p1.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`insert into envio_flujo (tenant_id, proximo_envio_en, tiempo_espera_seg)
          values (${ids.tenantId}, ${p1}, 60)`,
    );
    const d1 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d1.fetched).toBe(1);
    expect(d1.applied).toBe(1);
    expect(await mirror<string>(sql`select ${epoch} ${key}`)).toBe(String(Date.parse(p1) / 1000));

    // Delivery 2 — advance the window to p2 (> p1) — the NEWER value.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`update envio_flujo set proximo_envio_en = ${p2}, tiempo_espera_seg = 120 where tenant_id = ${ids.tenantId}`,
    );
    const d2 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d2.applied).toBe(1);
    expect(await mirror<string>(sql`select ${epoch} ${key}`)).toBe(String(Date.parse(p2) / 1000));

    // Re-deliver the whole tail: p1 then p2, seq-ordered, so the mirror ends at p2.
    await rewindCursor(ids.nodeId);
    const d3 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d3.fetched).toBe(2); // both envio_flujo images re-fetched
    expect(d3.applied).toBe(2);
    expect(await mirror<string>(sql`select ${epoch} ${key}`)).toBe(String(Date.parse(p2) / 1000)); // STILL p2
  });

  it("acks: a delete propagates, and re-delivering the older insert never resurrects the row (seq cursor)", async () => {
    // FAILING CASE: an apply that dropped the delete op would leave a pruned ack lingering on the
    // mirror; one that resurrected it on re-delivery would undo the prune. The terminal DELETE (highest
    // seq) wins; `fetched === 4` proves the whole insert/update/delete tail was re-fetched.
    const ids = await seedBothSides();
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };
    const reg = await captureFiscalRegistro(sourceWriter, ids, { secuencia: 1 });
    expect((await syncPullOnce(depsFor(ids.tenantId), peer)).applied).toBe(1);
    const count = sql`select count(*)::int as v from acks where registro_id = ${reg.registroId}`;
    const state = sql`select state as v from acks where registro_id = ${reg.registroId}`;

    // Delivery 1 — the ack in 'accepted'.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`insert into acks (registro_id, tenant_id, submitted_at, csv, state)
          values (${reg.registroId}, ${ids.tenantId}, '2026-07-20T19:25:00+01:00', 'CSV-1', 'accepted')`,
    );
    const d1 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d1.fetched).toBe(1);
    expect(d1.applied).toBe(1);
    expect(await mirror(state)).toBe("accepted");

    // Delivery 2 — state mutates to 'rejected'.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`update acks set state = 'rejected' where registro_id = ${reg.registroId}`,
    );
    const d2 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d2.applied).toBe(1);
    expect(await mirror(state)).toBe("rejected");

    // Delivery 3 — the ack is pruned (DELETE) — the terminal op.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`delete from acks where registro_id = ${reg.registroId}`,
    );
    const d3 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d3.fetched).toBe(1);
    expect(d3.applied).toBe(1); // the delete applied
    expect(await mirror(count)).toBe(0); // row gone on the mirror

    // Re-deliver the whole tail: registro + ack insert + update + delete. The insert re-creates the ack
    // momentarily, but the terminal delete (highest seq) applies last, so the mirror ends with it gone.
    await rewindCursor(ids.nodeId);
    const d4 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(d4.fetched).toBe(4); // registro + 3 acks images re-fetched
    expect(await mirror(count)).toBe(0); // STILL gone — the delete was not undone
  });
});
