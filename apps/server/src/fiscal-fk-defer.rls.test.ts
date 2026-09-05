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
  insertFiscalRegistro,
  insertFiscalSale,
  seedFiscalParents,
} from "./testing/fiscal-fixtures.js";

// SP-3a apply gate, Task 8 — the ORDERING and COEXISTENCE half of the fiscal-record lane, over the same
// real-Postgres two-clone harness as fiscal-apply.rls.test.ts (Task 6) and fiscal-upsert.rls.test.ts
// (Task 7): two `manifest` clones (source + target) driven over a real Hono `app.request` wire, applied
// as the non-superuser `sync_applier` under FORCE RLS. PGlite would be a false pass (CLAUDE.md §4).
//
// Two properties, each measured where the working and broken answers VISIBLY DIFFER (CLAUDE.md §1):
//
//   1. FK-ORDER 23503 DEFER — a `registros_facturacion` row delivered before its FK parent has reached
//      the mirror PARKS (23503, self-healing across sweeps), it is NOT rejected. The park is proven by
//      the RESULT COUNTS, not merely the final state: sweep 1 reports `deferred:1, applied:0` and the
//      row is absent; a second sweep with the parent STILL absent stays parked (so nothing but the
//      parent's arrival can clear it — no grant is widened, no constraint dropped); only once the parent
//      lands on the mirror does the next sweep report `applied:1, deferred:0` and the row appears. Both
//      the NOT-NULL `sale_id → sales` FK and the NULLABLE `cadenas.ultimo_registro_id →
//      registros_facturacion` FK are exercised. An immediate-reject implementation would show `rejected`
//      (or a throw) on sweep 1 and the row would never appear — a different count, which is the point.
//
//   2. RESERVED-SIF (R2) COEXISTENCE — a standby seeded at adopt (memory: reserved-sif-seeded-at-join)
//      carries its OWN dormant fiscal identity keyed to its OWN nodeId. Applying the PRIMARY's
//      node-keyed identity onto such a mirror must not collide, because the activo/PK constraints are
//      node-keyed: `registro_sif_activo_uq (tenant_id, node_id) WHERE revocado_en IS NULL` (0013) and
//      `cadenas` PK `(tenant_id, node_id)` (0013). The measurement is placed exactly where a node-keyed
//      constraint and a non-node-keyed one DIFFER: `registro_sif_instalacion_uq (nif,
//      id_sistema_informatico, numero_instalacion)` is NOT node-keyed, so the reserved SIF is given a
//      DISTINCT numero_instalacion — the negative control below applies a primary SIF whose numero
//      EQUALS the reserved one and gets a real 23505, proving the coexistence in the positive case rests
//      on the node-keyed constraints and the distinct numero, not on luck.
//
// apps/server is english-only-EXEMPT (apps/* is out of scope), so the Spanish fiscal names ride verbatim.
const log: Logger = () => {};

const source = useTemplateDb({ template: "manifest" });
const target = useTemplateDb({ template: "manifest" });

// A fixed subscriber id (the target's half of the cursor key). Each test uses a FRESH origin node id, so
// its (subscriber, origin, ordered) cursor is fresh and the tests never interfere.
const SUBSCRIBER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// registro_sif_instalacion_uq is GLOBAL on (nif, id_sistema_informatico, numero_instalacion), and every
// seedFiscalParents SIF shares nif '89890001K' + id_sistema 'WAITRON01' — so numero_instalacion must be
// globally unique across the whole file, except where the negative control collides on purpose. The
// reserved-SIF tests pin explicit high numbers (the auto counter stays small), spaced so nothing clashes.
const PRIMARY_NUM = 900_001;
const RESERVED_NUM = 900_002;
const COLLIDE_NUM = 900_003;

let targetApplier: Database; // sync_applier: app_user (apply) + sync_tailer (cursor)
let sourceReader: Database; // the mounted source's serve pool (sync_applier)
let sourceWriter: Database; // app_login: the app writer whose writes the capture triggers see
let sourcePeerToken: string;

async function stampEnv(db: Database, environment: "production" | "preproduction"): Promise<void> {
  await db.execute(sql`insert into deployment (id, environment) values (1, ${environment})
    on conflict (id) do update set environment = excluded.environment`);
}

/** A source serve mounted for `tenantId`: `/sync-api/log` reads sync_log inside `withTenant(tenantId)`
 * under FORCE RLS (sync-api.ts), so it MUST be mounted for the captured rows' tenant or it streams
 * nothing. Each test uses its own tenant, so the source is mounted per-pull with it (Task 6/7 shape). */
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

/** The ordered-lane pull deps for `tenantId`'s tail into the target (Task 6/7 shape). */
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

/** Run one write on the SOURCE as the app writer so the fiscal capture trigger fires and the row lands in
 * sync_log under origin = `originNodeId`. Both `app.tenant_id` (RLS) and `app.node_id` (capture origin)
 * are bound transaction-locally by `withTenant` (Task 7's `captureWrite`). */
async function captureWrite(
  tenantId: string,
  originNodeId: string,
  statement: Parameters<Database["execute"]>[0],
): Promise<void> {
  await withTenant(sourceWriter, tenantId, (tx) => tx.execute(statement), { nodeId: originNodeId });
}

/** Insert a `nodes` row (the mirror's reserved node) on `db` — plain admin setup, no capture. */
async function insertNode(
  db: Database,
  nodeId: string,
  tenantId: string,
  locationId: string,
): Promise<void> {
  await db.execute(sql`insert into nodes (id, tenant_id, location_id, name)
    values (${nodeId}, ${tenantId}, ${locationId}, 'Mirror node')`);
}

/** Read a scalar off the MIRROR as the superuser (RLS-bypassing) — the observed post-apply state. */
async function mirror<T>(query: Parameters<Database["execute"]>[0]): Promise<T | undefined> {
  const r = await target.admin.execute<{ v: T }>(query);
  return r.rows[0]?.v;
}

const captureError = async (fn: () => Promise<unknown>) =>
  fn()
    .then(() => undefined)
    .catch(
      (e: unknown) =>
        e as { code?: string; message?: string; cause?: { code?: string; message?: string } },
    );

beforeAll(async () => {
  await stampEnv(target.admin, "production");
  targetApplier = await target.pg.connectAs("sync_applier", "ap");
  sourceReader = await source.pg.connectAs("sync_applier", "ap");
  sourceWriter = await source.pg.connectAs("app_login", "app_pw");
  sourcePeerToken = (
    await enrolPeer(source.admin, { subscriberId: "sp3a-fkdefer", name: "sp3a-fk" })
  ).token;
});

afterAll(async () => {
  // Only the connectAs handles are closed here; the two admin connections and both clones are owned by
  // the two useTemplateDb calls (CLAUDE.md §4: never double-close a helper-owned connection).
  if (sourceWriter !== undefined) await sourceWriter.close();
  if (sourceReader !== undefined) await sourceReader.close();
  if (targetApplier !== undefined) await targetApplier.close();
});

describe("fiscal FK-order apply gate — 23503 defer, resolved only by the parent arriving", () => {
  it("a registro delivered before its sale_id parent parks (deferred), then lands once the sale arrives", async () => {
    // NOT-NULL FK: registros_facturacion.sale_id → sales. The mirror is seeded with the whole closure
    // EXCEPT the sale, so the delivered registro can park on exactly that one FK.
    const ids = freshFiscalIds();
    await seedFiscalParents(source.admin, { ids }); // full closure on the source (the registro's FKs)
    await seedFiscalParents(target.admin, { ids, skipSale: true }); // mirror missing ONLY the sale
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };

    // Capture the registro on the source → it lands in sync_log under origin = ids.nodeId.
    const seeded = await captureFiscalRegistro(sourceWriter, ids, { secuencia: 1 });
    const exists = sql`select count(*)::int as v from registros_facturacion where id = ${seeded.registroId}`;

    // Sweep 1 — the sale parent is absent on the mirror → the registro PARKS on 23503. The counts are
    // what distinguish a defer from an immediate reject: deferred:1 (not rejected:1), applied:0, and the
    // cursor is NOT advanced (advanced:false) so the parked row is re-delivered next sweep.
    const s1 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(s1.fetched).toBe(1);
    expect(s1.deferred).toBe(1);
    expect(s1.applied).toBe(0);
    expect(s1.rejected).toBe(0);
    expect(s1.advanced).toBe(false); // cursor held below the parked seq
    expect(await mirror<number>(exists)).toBe(0); // never inserted

    // Sweep 2 — NOTHING has changed (the sale is still absent, no grant widened, no constraint dropped):
    // the registro is re-fetched and parks AGAIN. This is the control that proves only the parent's
    // arrival can clear the park — a re-pull on its own does not.
    const s2 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(s2.fetched).toBe(1); // re-delivered (cursor still at 0)
    expect(s2.deferred).toBe(1);
    expect(s2.applied).toBe(0);
    expect(await mirror<number>(exists)).toBe(0); // still absent

    // The ONLY intervention: the parent arrives on the mirror (a plain insert of the sale row).
    await insertFiscalSale(target.admin, ids);

    // Sweep 3 — the registro is re-delivered, its sale_id FK now resolves, and it APPLIES: deferred→
    // applied. The row appears byte-for-byte (huella carried verbatim, not recomputed).
    const s3 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(s3.fetched).toBe(1);
    expect(s3.applied).toBe(1);
    expect(s3.deferred).toBe(0);
    expect(s3.advanced).toBe(true); // cursor now advances past the applied seq
    expect(await mirror<number>(exists)).toBe(1); // landed
    expect(
      await mirror<string>(
        sql`select huella as v from registros_facturacion where id = ${seeded.registroId}`,
      ),
    ).toBe(seeded.huella);
  });

  it("a cadenas head delivered before its ultimo_registro_id parks (nullable FK), then lands once the registro arrives", async () => {
    // NULLABLE FK: cadenas.ultimo_registro_id → registros_facturacion. A populated head (both pointer
    // columns non-null, so the FK is checked) is delivered before its referenced registro exists on the
    // mirror. The registro can only reach the mirror by DIRECT insert with a matching id — the ledger is
    // append-only, so it cannot be re-captured under its own id after the fact.
    const ids = freshFiscalIds();
    await seedFiscalParents(source.admin, { ids }); // full closure on the source
    await seedFiscalParents(target.admin, { ids }); // full closure on the mirror EXCEPT the registro
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };

    // The head must point at a real registro on the SOURCE (its own FK), inserted DIRECTLY so it is NOT
    // captured — only the cadenas head enters sync_log, so the head is delivered while the mirror lacks
    // the registro it names.
    const registroId = randomUUID();
    const huella = "C".repeat(64);
    await insertFiscalRegistro(source.admin, ids, { id: registroId, huella, secuencia: 1 });
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`insert into cadenas (tenant_id, node_id, secuencia, ultimo_registro_id, ultima_huella)
          values (${ids.tenantId}, ${ids.nodeId}, 1, ${registroId}, ${huella})`,
    );
    const headSeq = sql`select secuencia as v from cadenas where tenant_id = ${ids.tenantId} and node_id = ${ids.nodeId}`;
    const headCount = sql`select count(*)::int as v from cadenas where tenant_id = ${ids.tenantId} and node_id = ${ids.nodeId}`;

    // Sweep 1 — the registro the head references is absent → the head PARKS on 23503.
    const s1 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(s1.fetched).toBe(1);
    expect(s1.deferred).toBe(1);
    expect(s1.applied).toBe(0);
    expect(s1.rejected).toBe(0);
    expect(s1.advanced).toBe(false);
    expect(await mirror<number>(headCount)).toBe(0); // head never inserted

    // Sweep 2 — still no registro: the head parks again (re-pull alone does not clear it).
    const s2 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(s2.fetched).toBe(1);
    expect(s2.deferred).toBe(1);
    expect(s2.applied).toBe(0);
    expect(await mirror<number>(headCount)).toBe(0);

    // The ONLY intervention: the referenced registro arrives on the mirror, under the SAME id.
    await insertFiscalRegistro(target.admin, ids, { id: registroId, huella, secuencia: 1 });

    // Sweep 3 — the head is re-delivered, its ultimo_registro_id FK now resolves, and it APPLIES.
    const s3 = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(s3.fetched).toBe(1);
    expect(s3.applied).toBe(1);
    expect(s3.deferred).toBe(0);
    expect(s3.advanced).toBe(true);
    expect(await mirror<number>(headCount)).toBe(1); // landed
    expect(await mirror<number>(headSeq)).toBe(1);
  });
});

describe("fiscal reserved-SIF (R2) apply gate — node-keyed identities coexist", () => {
  it("applies a primary's node-keyed identity onto a mirror holding a reserved SIF, with no unique conflict", async () => {
    const ids = freshFiscalIds(); // the PRIMARY's closure; ids.nodeId is the primary node
    await seedFiscalParents(source.admin, { ids, numeroInstalacion: PRIMARY_NUM });
    await seedFiscalParents(target.admin, { ids, numeroInstalacion: PRIMARY_NUM });
    // The primary's SIF must ARRIVE via sync (an INSERT onto the mirror), so remove the pre-seeded copy;
    // no registro references it yet, so the delete is clean.
    await target.admin.execute(sql`delete from registro_sif where id = ${ids.sifId}`);

    // The mirror's OWN reserved identity, keyed to its OWN node: an ACTIVE registro_sif (revocado_en
    // NULL) with a DISTINCT numero_instalacion (RESERVED_NUM ≠ PRIMARY_NUM) so registro_sif_instalacion_uq
    // is non-colliding BY CONSTRUCTION, plus an EMPTY cadenas head (secuencia 0, both pointer columns
    // NULL — the "no registros yet" head, satisfying cadenas_puntero_ck).
    const mirrorNode = randomUUID();
    const reservedSif = randomUUID();
    await insertNode(target.admin, mirrorNode, ids.tenantId, ids.locationId);
    await target.admin.execute(sql`
      insert into registro_sif (id, tenant_id, node_id, nif, id_sistema_informatico, numero_instalacion)
      values (${reservedSif}, ${ids.tenantId}, ${mirrorNode}, '89890001K', 'WAITRON01', ${RESERVED_NUM})`);
    await target.admin.execute(sql`
      insert into cadenas (tenant_id, node_id, secuencia, ultimo_registro_id, ultima_huella)
      values (${ids.tenantId}, ${mirrorNode}, 0, null, null)`);

    // Capture the PRIMARY's full identity on the source: SIF (re-emitted into sync_log by a full-image
    // update-capture, the shape Task 7 relies on for registro_sif), then its registro, then its chain
    // head — ascending seq, so on apply the SIF lands before the registro and the registro before the
    // head, no intra-batch FK park.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`update registro_sif set numero_instalacion = ${PRIMARY_NUM} where id = ${ids.sifId}`,
    );
    const reg = await captureFiscalRegistro(sourceWriter, ids, { secuencia: 1 });
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`insert into cadenas (tenant_id, node_id, secuencia, ultimo_registro_id, ultima_huella)
          values (${ids.tenantId}, ${ids.nodeId}, 1, ${reg.registroId}, ${reg.huella})`,
    );

    // Apply — all three rows land with NO unique-constraint conflict: registro_sif_activo_uq and the
    // cadenas PK are (tenant_id, node_id)-keyed, so the primary's node and the mirror's node do not
    // contend; registro_sif_instalacion_uq is cleared by the distinct numero_instalacion.
    const result = await syncPullOnce(depsFor(ids.tenantId), {
      nodeId: ids.nodeId,
      url: "",
      token: sourcePeerToken,
    });
    expect(result.applied).toBe(3); // SIF + registro + cadenas head
    expect(result.deferred).toBe(0);
    expect(result.rejected).toBe(0);

    // BOTH identities remain independently resolvable on the mirror.
    // Two registro_sif rows for the tenant, one per node, BOTH active.
    expect(
      await mirror<number>(
        sql`select count(*)::int as v from registro_sif where tenant_id = ${ids.tenantId}`,
      ),
    ).toBe(2);
    expect(
      await mirror<number>(
        sql`select count(*)::int as v from registro_sif where tenant_id = ${ids.tenantId} and revocado_en is null`,
      ),
    ).toBe(2);
    // The primary SIF: present, active, its own numero.
    expect(
      await mirror<number>(
        sql`select numero_instalacion as v from registro_sif where tenant_id = ${ids.tenantId} and node_id = ${ids.nodeId}`,
      ),
    ).toBe(PRIMARY_NUM);
    // The reserved SIF: untouched by the apply — still present, still active, still its own numero.
    expect(
      await mirror<number>(
        sql`select numero_instalacion as v from registro_sif where id = ${reservedSif}`,
      ),
    ).toBe(RESERVED_NUM);
    expect(
      await mirror<Date | null>(
        sql`select revocado_en as v from registro_sif where id = ${reservedSif}`,
      ),
    ).toBeNull();

    // Two cadenas heads, one per node — the primary's populated head and the mirror's reserved empty head.
    expect(
      await mirror<number>(
        sql`select count(*)::int as v from cadenas where tenant_id = ${ids.tenantId}`,
      ),
    ).toBe(2);
    expect(
      await mirror<number>(
        sql`select secuencia as v from cadenas where tenant_id = ${ids.tenantId} and node_id = ${ids.nodeId}`,
      ),
    ).toBe(1); // primary head advanced to its registro
    expect(
      await mirror<number>(
        sql`select secuencia as v from cadenas where tenant_id = ${ids.tenantId} and node_id = ${mirrorNode}`,
      ),
    ).toBe(0); // reserved head still empty
    // The primary's registro landed.
    expect(
      await mirror<number>(
        sql`select count(*)::int as v from registros_facturacion where id = ${reg.registroId}`,
      ),
    ).toBe(1);
  });

  it("negative control: a primary SIF sharing the reserved SIF's numero_instalacion collides on the NON-node-keyed unique index (23505)", async () => {
    // The measurement in the other direction (CLAUDE.md §1): registro_sif_instalacion_uq is (nif,
    // id_sistema_informatico, numero_instalacion) — NOT node-keyed. If the reserved SIF and the primary
    // SIF share a numero_instalacion (both carry the fixture's fixed nif+id_sistema), applying the
    // primary SIF raises a REAL 23505 even though the nodes differ — so the positive test's coexistence
    // genuinely rests on the distinct numero, not on the two rows never being compared.
    const ids = freshFiscalIds();
    await seedFiscalParents(source.admin, { ids, numeroInstalacion: COLLIDE_NUM });
    await seedFiscalParents(target.admin, { ids, numeroInstalacion: COLLIDE_NUM });
    await target.admin.execute(sql`delete from registro_sif where id = ${ids.sifId}`);

    // The reserved SIF on a DIFFERENT node but the SAME (nif, id_sistema, numero) as the primary's.
    const mirrorNode = randomUUID();
    const reservedSif = randomUUID();
    await insertNode(target.admin, mirrorNode, ids.tenantId, ids.locationId);
    await target.admin.execute(sql`
      insert into registro_sif (id, tenant_id, node_id, nif, id_sistema_informatico, numero_instalacion)
      values (${reservedSif}, ${ids.tenantId}, ${mirrorNode}, '89890001K', 'WAITRON01', ${COLLIDE_NUM})`);

    // Capture ONLY the primary SIF so the throw is unambiguously the SIF's collision.
    await captureWrite(
      ids.tenantId,
      ids.nodeId,
      sql`update registro_sif set numero_instalacion = ${COLLIDE_NUM} where id = ${ids.sifId}`,
    );

    // Apply — the collision is a unique_violation (23505), NOT a 23503 defer, so it propagates out of
    // syncPullOnce rather than being parked.
    const err = await captureError(() =>
      syncPullOnce(depsFor(ids.tenantId), { nodeId: ids.nodeId, url: "", token: sourcePeerToken }),
    );
    expect(err, "colliding numero_instalacion did not raise").toBeDefined();
    expect(err?.code ?? err?.cause?.code).toBe("23505");

    // The primary SIF never landed; the reserved SIF is intact (the apply transaction rolled back).
    expect(
      await mirror<number>(
        sql`select count(*)::int as v from registro_sif where id = ${ids.sifId}`,
      ),
    ).toBe(0);
    expect(
      await mirror<number>(
        sql`select count(*)::int as v from registro_sif where id = ${reservedSif}`,
      ),
    ).toBe(1);
  });
});
