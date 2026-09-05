import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureError, pgErrorCode, pgErrorMessage, type Database } from "@waitron/db";
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

// SP-3a apply gate (design §6/§7). Proves the fiscal-record lane makes a mirror a VERBATIM copy of the
// immutable ledger — the correctness heart of the slice. Real Postgres, two `manifest` clones (source
// + target), driven over a real Hono `app.request` wire exactly like sync-e2e.rls.test.ts, whose
// two-clone + syncPullOnce shape this file follows. PGlite would be a false pass (CLAUDE.md §4): the
// apply role is a non-superuser under FORCE RLS, the immutability guards are grant + trigger, and
// PGlite connects as a superuser that bypasses both.
//
// Three properties, each proven-by-deletion (receipts in the task report):
//   A. VERBATIM   — a captured registro lands byte-identical on the mirror: huella, the four
//                   anterior_* pointers and OUR entorno metadata copy as opaque bytes; nothing
//                   recomputes a hash. Distinguished from a changed copy by a documented scratch
//                   control that mutates the payload's entorno between capture and apply.
//   B. IDEMPOTENT — re-delivering the same seq is a clean no-op (insert-only ON CONFLICT (id) DO
//                   NOTHING); the row count stays exactly 1.
//   C. IMMUTABLE ON MIRROR — the mirror table carries BOTH guards: the apply role holds no
//                   UPDATE/DELETE/TRUNCATE grant (42501), and the append-only + block-truncate
//                   triggers are active even against a privilege-bypassing superuser (WT001) —
//                   while the apply INSERT path (A) is unobstructed.
//
// This suite lives in apps/server, the composition root: it drives the apply lane through
// `mountSyncApi` + the assembled `ALL_SYNC_ENROLMENTS`, which live only here, and `fiscal-verifactu`
// cannot import `apps/server` (dependency inversion) — that, not english-only, is why it is here.
// Spanish fiscal table/column names appear verbatim because apps/* is english-only-exempt, an aside
// that does not discriminate (packages/fiscal-verifactu is exempt too).
const log: Logger = () => {};

const source = useTemplateDb({ template: "manifest" });
const target = useTemplateDb({ template: "manifest" });

// A fixed subscriber id (the target's node id half of the cursor key). Each test uses a FRESH origin
// node id, so its (subscriber, origin, ordered) cursor is fresh and the tests never interfere.
const SUBSCRIBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let targetApplier: Database; // sync_applier: app_user (apply INSERT) + sync_tailer (cursor)
let sourceReader: Database; // the mounted source's serve pool (sync_applier: app_user + sync_tailer)
let sourceWriter: Database; // app_login: the app writer whose insert the capture trigger sees
let sourcePeerToken: string;

/** Stamp a database's singleton deployment.environment (applyBatch reads it — apply.ts:170). */
async function stampEnv(db: Database, environment: "production" | "preproduction"): Promise<void> {
  await db.execute(sql`insert into deployment (id, environment) values (1, ${environment})
    on conflict (id) do update set environment = excluded.environment`);
}

/** The HTTP seam: a real Hono app.request against a source mounting the SAME assembled enrolment set.
 * `tenantId` is the tenant the source serves under — `/sync-api/log` reads sync_log inside
 * `withTenant(db, tenantId)` (sync-api.ts:150), so under FORCE RLS only rows of THIS tenant are
 * streamed. Each test uses its own tenant, so the mounted source is built per-pull with it. */
function sourceHttp(environment: "production" | "preproduction", tenantId: string): HttpClient {
  const app = new Hono();
  mountSyncApi(
    app,
    {
      db: sourceReader,
      tenantId,
      nodeId: "00000000-0000-4000-8000-000000000000", // /log filters by the peer's ?originId= query arg, not this
      environment,
      enrolments: ALL_SYNC_ENROLMENTS,
      moduleVersions: {},
    },
    log,
  );
  return (url, init) => Promise.resolve(app.request(url, { headers: init.headers }));
}

/** The pull deps for an ordered-lane pull of `tenantId`'s tail into the target, the brief shape. The
 * origin is carried on the `peer` (peer.nodeId); this node is a fixed subscriber against any origin. */
function depsFor(tenantId: string) {
  return {
    localDb: targetApplier,
    subscriberId: SUBSCRIBER,
    tenantId,
    localEnvironment: "production",
    http: sourceHttp("production", tenantId),
    batchLimit: 500,
    enrolments: ALL_SYNC_ENROLMENTS,
    moduleVersions: {},
    moduleByTable: new Map<string, string>(),
  } as const;
}

/** Seed the SAME FK closure on both databases so a captured source registro's FKs resolve on apply. */
async function seedBothSides(): Promise<FiscalIds> {
  const ids = freshFiscalIds();
  await seedFiscalParents(source.admin, { ids });
  await seedFiscalParents(target.admin, { ids });
  return ids;
}

/** Read a full registros_facturacion row (every column) as jsonb, from one database, by id. */
async function fullRow(db: Database, registroId: string): Promise<Record<string, unknown> | null> {
  const r = await db.execute<{ j: Record<string, unknown> }>(
    sql`select to_jsonb(t.*) as j from registros_facturacion t where id = ${registroId}`,
  );
  return r.rows[0]?.j ?? null;
}

beforeAll(async () => {
  await stampEnv(target.admin, "production");
  targetApplier = await target.pg.connectAs("sync_applier", "ap");
  sourceReader = await source.pg.connectAs("sync_applier", "ap");
  sourceWriter = await source.pg.connectAs("app_login", "app_pw");
  sourcePeerToken = (await enrolPeer(source.admin, { subscriberId: "sp3a-mirror", name: "sp3a" }))
    .token;
});

afterAll(async () => {
  // Only the connectAs handles are closed here; the two admin connections and both clones are owned
  // and torn down by the two useTemplateDb calls (CLAUDE.md §4: never double-close a helper-owned conn).
  if (sourceWriter !== undefined) await sourceWriter.close();
  if (sourceReader !== undefined) await sourceReader.close();
  if (targetApplier !== undefined) await targetApplier.close();
});

describe("fiscal apply gate — verbatim replication of the immutable ledger", () => {
  it("A. applies a captured registro byte-identically onto the mirror (huella, anterior_*, entorno)", async () => {
    // FAILING CASE this distinguishes: apply that recomputes or drops any field — a re-hashed huella, a
    // dropped anterior_* pointer, or OUR entorno metadata stripped — leaves the mirror row differing
    // from the source. The full-row jsonb equality below fires on any such divergence; the documented
    // scratch control (report §A: mutate the payload's entorno between capture and apply) confirms the
    // equality actually catches a changed copy, so this is a measurement where the two answers differ
    // (CLAUDE.md §1), not one where both look alike.
    const ids = await seedBothSides();
    // A NON-primer registro so the four anterior_* pointers carry REAL bytes (not four NULLs): the
    // registros_encadenamiento_ck "all four set" branch. entorno is preproduction (≠ the default) so
    // its verbatim copy is observable, not accidentally-equal to a hardcoded default anywhere.
    const anterior = {
      idEmisorFactura: "89890001K",
      numSerieFactura: "A/0",
      fechaExpedicionFactura: "2026-07-19",
      huella: "A".repeat(64),
    };
    const seeded = await captureFiscalRegistro(sourceWriter, ids, {
      entorno: "preproduction",
      huella: "B".repeat(64),
      secuencia: 2,
      numSerie: "A/2",
      anterior,
    });

    const result = await syncPullOnce(depsFor(ids.tenantId), {
      nodeId: ids.nodeId,
      url: "",
      token: sourcePeerToken,
    });
    expect(result.applied).toBe(1); // exactly the one captured registro applied

    const src = await fullRow(source.admin, seeded.registroId);
    const dst = await fullRow(target.admin, seeded.registroId);
    expect(dst).not.toBeNull(); // it landed on the mirror
    // The whole row is byte-identical — creado_en, id, every column — not merely the fields spelled out.
    expect(dst).toEqual(src);

    // And the fiscal-critical fields explicitly (the brief's list), read off the MIRROR row.
    expect(dst!.huella).toBe("B".repeat(64));
    expect(dst!.entorno).toBe("preproduction"); // OUR metadata rode across (never hashed, but carried)
    expect(dst!.anterior_id_emisor_factura).toBe(anterior.idEmisorFactura);
    expect(dst!.anterior_num_serie_factura).toBe(anterior.numSerieFactura);
    expect(dst!.anterior_fecha_expedicion_factura).toBe(anterior.fechaExpedicionFactura);
    expect(dst!.anterior_huella).toBe(anterior.huella);
  });

  it("B. re-delivering the same seq is an idempotent no-op — the mirror keeps exactly one row", async () => {
    // FAILING CASE: an apply that is not ON CONFLICT (id) DO NOTHING would either duplicate the row on
    // re-delivery or issue an UPDATE the append-only trigger (WT001) rejects — a stalled mirror. The
    // control in the other direction is the FIRST pull landing the row (applied:1); the second, re-
    // delivering the identical seq range, must land nothing and leave the count at exactly 1.
    const ids = await seedBothSides();
    const seeded = await captureFiscalRegistro(sourceWriter, ids, { secuencia: 1 });
    const peer = { nodeId: ids.nodeId, url: "", token: sourcePeerToken };

    const first = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(first.applied).toBe(1);

    // Re-deliver the SAME range from seq 0 by resetting this origin's cursor to 0, so the second pull
    // re-fetches and re-applies the identical seq — the exact ON CONFLICT (id) DO NOTHING path.
    await targetApplier.execute(
      sql`update sync_cursor set last_applied_seq = 0
          where subscriber_id = ${SUBSCRIBER} and origin_id = ${ids.nodeId}::uuid and lane = 'ordered'`,
    );
    const second = await syncPullOnce(depsFor(ids.tenantId), peer);
    expect(second.applied).toBe(0); // re-delivery applied nothing

    const count = await target.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from registros_facturacion where id = ${seeded.registroId}`,
    );
    expect(count.rows[0]!.n).toBe(1); // exactly one row, never duplicated
  });

  it("C. the mirror ledger is immutable: applier refused (42501), triggers active vs superuser (WT001), apply INSERT unobstructed", async () => {
    // Proven-by-deletion is INHERENT here — the guards ARE the grant and the triggers; each assertion
    // fails the moment its guard is absent. Two enforcement layers, both proven on the RESTORED/MIRRORED
    // table (measured 2026-09-05, receipts in the report):
    //   1. GRANT (the front-line protection): the apply role holds only SELECT,INSERT on
    //      registros_facturacion (0001_registros_inmutables.sql), so a direct UPDATE or TRUNCATE is
    //      refused at the privilege check — SQLSTATE 42501, BEFORE any trigger fires. This is what
    //      actually stops the apply worker tampering with the ledger.
    //   2. TRIGGER (the backstop): a privilege-bypassing SUPERUSER still trips the append-only trigger
    //      on UPDATE (WT001) and the block-truncate trigger on TRUNCATE ... CASCADE (WT001) — proving
    //      the triggers are ACTIVE on the mirror table, not merely present.
    // NOTE (CLAUDE.md §1 correction): the task brief said the applier UPDATE/TRUNCATE "throws WT001".
    // Measured, it does not — the applier holds no such grant, so it is refused with 42501 before the
    // trigger is reached; only a superuser (who bypasses REVOKE ALL but not the trigger) reaches WT001.
    // A plain (non-CASCADE) superuser TRUNCATE is refused earlier still with 0A000 (registros_facturacion
    // is FK-referenced by cadenas/envios/acks), so CASCADE is what carries the statement to the trigger.
    const ids = await seedBothSides();
    const seeded = await captureFiscalRegistro(sourceWriter, ids, { secuencia: 1 });

    // The apply INSERT path is UNOBSTRUCTED — the row lands on the mirror despite the REVOKE ALL.
    const applied = await syncPullOnce(depsFor(ids.tenantId), {
      nodeId: ids.nodeId,
      url: "",
      token: sourcePeerToken,
    });
    expect(applied.applied).toBe(1);
    const landed = await target.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from registros_facturacion where id = ${seeded.registroId}`,
    );
    expect(landed.rows[0]!.n).toBe(1);

    // Layer 1 — the apply role cannot mutate the ledger: no UPDATE / TRUNCATE grant → 42501.
    // captureError throws if the statement SUCCEEDS, so reaching the assertion is itself the proof it
    // was rejected (the message the old `.toBeDefined()` carried is now captureError's own throw text).
    const applierUpdate = await captureError(() =>
      targetApplier.execute(
        sql`update registros_facturacion set huella = ${"E".repeat(64)} where id = ${seeded.registroId}`,
      ),
    );
    expect(pgErrorCode(applierUpdate)).toBe("42501");

    const applierTruncate = await captureError(() =>
      targetApplier.execute(sql.raw(`truncate registros_facturacion cascade`)),
    );
    expect(pgErrorCode(applierTruncate)).toBe("42501");

    // Layer 2 — the triggers are ACTIVE on the mirror table. A superuser bypasses the grant but not the
    // trigger, so the statement reaches it and trips it (mirrors pg-restore.test.ts's positive control).
    const superUpdate = await captureError(() =>
      target.admin.execute(
        sql`update registros_facturacion set huella = ${"E".repeat(64)} where id = ${seeded.registroId}`,
      ),
    );
    expect(pgErrorCode(superUpdate)).toBe("WT001"); // append-only trigger fired (not merely present)
    expect(pgErrorMessage(superUpdate)).toMatch(/is append-only/i);

    const superTruncate = await captureError(() =>
      target.admin.execute(sql.raw(`truncate registros_facturacion cascade`)),
    );
    expect(pgErrorCode(superTruncate)).toBe("WT001"); // block-truncate trigger fired

    // The ledger row survived every rejected mutation (each statement rolled back).
    const survived = await target.admin.execute<{ huella: string; n: number }>(
      sql`select huella, count(*) over ()::int as n from registros_facturacion where id = ${seeded.registroId}`,
    );
    expect(survived.rows[0]!.n).toBe(1);
    expect(survived.rows[0]!.huella).toBe("F".repeat(64)); // the applied value, untouched
  });
});
