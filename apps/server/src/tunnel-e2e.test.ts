import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { enrolPeer, syncPullOnce, type PullPeer, type SyncPullDeps } from "@waitron/sync";
import { runTunnelClient } from "@waitron/tunnel";
import { createRelayStandin } from "@waitron/tunnel/testing/relay.js";
import type { Logger } from "./logger.js";
import { realSleep } from "./loop.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { mountSyncApi } from "./sync-api.js";
import { ALL_SYNC_ENROLMENTS } from "./modules.js";
import { tunnelHttpClient } from "./tunnel-http.js";

// The headline end-to-end (sub-project B): the CLOUD pulls a box's sync data THROUGH the outbound
// tunnel, and the relay in the middle stays BLIND. It composes every part of the transport slice into
// the faithful production topology, all on loopback:
//
//   cloud pull (tunnelHttpClient, TLS to box.test)
//        │  https://127.0.0.1:<relay.clientPort>/…
//        ▼
//   relay stand-in  ── splices raw bytes, records the client→box direction, never terminates TLS ──┐
//        ▲ box dials OUT (runTunnelClient) — NAT-friendly, no inbound port                          │
//        └───────────────────────────────────────────────────────────────────────────────────────┘
//        ▼  127.0.0.1:<httpsPort>
//   the box's own HTTPS sync-api (node:https + a box.test self-signed cert), mounted on real Postgres
//
// Two REAL manifest-migrated databases in the shared container (`source` = the box, `mirror` =
// the cloud), each a `useTemplateDb` clone, are the minimum that proves a genuine cross-DB apply
// as the non-superuser sync roles using app_user grants (PGlite would be a false pass, CLAUDE.md
// §4). What makes THIS test more than `sync-e2e.test.ts` is that the HTTP seam is not a Hono
// `app.request` — it is a real TLS connection over a real relay, so the byte-blindness of the
// relay is observable. See the task-8 brief and design §5.
const syncLog: Logger = () => {};

// Sync node ids (origin marker + cursor keys) — distinct from the FK-parent `nodes` row below.
const NODE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // the source (box, producer)
const SUB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // the cloud mirror subscriber

// Fixed FK-parent ids seeded identically on BOTH databases so a source sale applies against real
// parents on the mirror (in real active-active these rows sync too; here they are seeded directly).
const TENANT = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const TILL = "33333333-3333-4333-8333-333333333333";
const NODE = "44444444-4444-4444-8444-444444444444";
const SERIES = "55555555-5555-4555-8555-555555555555";

// A handful of sales captured on the source → a handful of ordered-lane sync_log rows to drain.
const SALE_IDS = [
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
];

// The peer's subscriber_id at the SOURCE — the identity the source resolves the Bearer token to and
// stamps its OWN sync_cursor under when the mirror reports its cursor (spec §3.1). Distinct from the
// mirror's own `SUB` (the mirror-side cursor key): they live in two different databases.
const PEER_SUBSCRIBER = "e2e-mirror";

const source = useTemplateDb({ template: "manifest" });
const mirror = useTemplateDb({ template: "manifest" });

let mirrorAdmin: Database;
let mirrorApplier: Database;
let sourceReader: Database;
let sourceWriter: Database;
let sourcePeerToken: string;

/** Seed the FK parents (tenant, location, till, node, series) with the fixed ids on one database.
 * None of these tables is enrolled, so this captures no sync_log rows. */
async function seedParents(admin: Database): Promise<void> {
  await admin.execute(sql`insert into tenants (id, country, tax_id, legal_name)
    values (${TENANT}, 'ES', '90111111K', 'Tunnel E2E SL') on conflict do nothing`);
  await admin.execute(sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${LOCATION}, ${TENANT}, 'Loc', array['en']::text[], 'Hospitality') on conflict do nothing`);
  await admin.execute(sql`insert into tills (id, tenant_id, location_id, name)
    values (${TILL}, ${TENANT}, ${LOCATION}, 'Till') on conflict do nothing`);
  await admin.execute(sql`insert into nodes (id, tenant_id, location_id, name)
    values (${NODE}, ${TENANT}, ${LOCATION}, 'Node') on conflict do nothing`);
  await admin.execute(sql`insert into invoice_series (id, tenant_id, node_id, code)
    values (${SERIES}, ${TENANT}, ${NODE}, 'A') on conflict do nothing`);
}

/** Stamp a database's singleton deployment.environment — applyBatch refuses a mirror with no stamp. */
async function stampEnv(db: Database, environment: "production" | "preproduction"): Promise<void> {
  await db.execute(sql`insert into deployment (id, environment) values (1, ${environment})
    on conflict (id) do update set environment = excluded.environment`);
}

/** Capture a sale on the SOURCE under withTenant{nodeId: NODE_A} — sync_capture writes it to
 * source.sync_log with origin_id = NODE_A. vat_breakdown carries a jsonb NUMBER 1.50 (scale preserved)
 * so byte-identity is observable end-to-end (a JS re-parse would collapse it to 1.5). */
async function captureSaleOnSource(saleId: string, invoiceNumber: number): Promise<void> {
  await withTenant(
    sourceWriter,
    TENANT,
    (tx) =>
      tx.execute(sql`insert into sales
        (id, tenant_id, till_id, series_id, node_id, invoice_number, issued_at,
         issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
         fiscal_backend, fiscal_state)
        values (${saleId}, ${TENANT}, ${TILL}, ${SERIES}, ${NODE}, ${invoiceNumber},
                '2026-08-11T10:00:00+00:00', 60, '10.00', '[1.50]'::jsonb, 'en', array['en']::text[],
                'fake', 'not_applicable')`),
    { nodeId: NODE_A },
  );
}

beforeAll(async () => {
  await seedParents(source.admin);
  mirrorAdmin = mirror.admin;
  await seedParents(mirrorAdmin); // the SAME parents on the mirror so the applied sales' FKs resolve
  await stampEnv(mirrorAdmin, "production"); // a mirror must be environment-stamped before it applies
  mirrorApplier = await mirror.pg.connectAs("sync_applier", "ap");
  // The source serve pool matches production (boot.ts:1053): a app_user member, since /hello now
  // also reads node_membership (app_user's SELECT); sync_reader alone would 500 there.
  sourceReader = await source.pg.connectAs("sync_applier", "ap");
  sourceWriter = await source.pg.connectAs("app_login", "app_pw");
  // Mint the mirror's Bearer token on the SOURCE (enrolPeer runs as the superuser admin — setup
  // bypasses grants). The mounted source resolves this token to the `e2e-mirror` peer on each call.
  sourcePeerToken = (
    await enrolPeer(source.admin, { subscriberId: PEER_SUBSCRIBER, name: "tunnel-e2e" })
  ).token;
});

afterAll(async () => {
  // Only the `connectAs` handles this suite opened are closed here; the two admin connections and both
  // clone databases are owned and torn down by the two `useTemplateDb` calls. `mirrorAdmin` is
  // `mirror.admin`, so it must NOT be closed here (that would double-close).
  if (sourceWriter !== undefined) await sourceWriter.close();
  if (sourceReader !== undefined) await sourceReader.close();
  if (mirrorApplier !== undefined) await mirrorApplier.close();
});

describe("headline e2e — the cloud pulls through the outbound tunnel and the relay stays blind", () => {
  it("applies the box's sync_log into the mirror over TLS while the relay sees only ciphertext", async () => {
    // ── Box: capture a handful of sales, then serve its sync-api over HTTPS for `box.test` ──────────
    for (let i = 0; i < SALE_IDS.length; i += 1) await captureSaleOnSource(SALE_IDS[i]!, i + 1);

    const { caCertPem, serverCertPem, serverKeyPem } = mintSelfSignedServerCert({
      hostnames: ["box.test"], // SAN = box.test ONLY — the cloud must authenticate the box hostname…
      ipAddresses: [], // …never a 127.0.0.1 IP-SAN shortcut (the tunnel-http.ts servername path)
      now: new Date("2026-08-27T00:00:00Z"),
    });
    const app = new Hono();
    mountSyncApi(
      app,
      {
        db: sourceReader,
        tenantId: TENANT,
        nodeId: NODE_A,
        environment: "production",
        enrolments: ALL_SYNC_ENROLMENTS,
        moduleVersions: {},
      },
      syncLog,
    );
    // A real node:https listener bridging the Hono app (getRequestListener is @hono/node-server's own
    // request adaptor) — the same server node:https gives tunnel-http.test.ts, but serving the real
    // sync-api rather than a stub. TLS terminates HERE, against the cloud, end-to-end.
    const httpsServer: HttpsServer = createHttpsServer(
      { key: serverKeyPem, cert: serverCertPem },
      getRequestListener(app.fetch),
    );
    await new Promise<void>((resolve) => httpsServer.listen(0, "127.0.0.1", () => resolve()));
    const httpsPort = (httpsServer.address() as AddressInfo).port;

    // ── Relay + box tunnel client: the box dials OUT and parks idle connections at the relay ────────
    const relay = await createRelayStandin({ verifyToken: () => true });
    const ac = new AbortController();
    // Wait until the box has registered at least one idle connection before the cloud dials, so the
    // pull never races the pool warm-up. The relay would also hold a client up to waitForBoxMs, but
    // gating on the real `tunnel.connection_registered` log removes the timing question entirely.
    let markRegistered!: () => void;
    const registered = new Promise<void>((resolve) => {
      markRegistered = resolve;
    });
    const tunnelLog: Logger = (_level, event) => {
      if (event === "tunnel.connection_registered") markRegistered();
    };
    const tunnelWorker = runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: relay.boxPort,
      boxId: "box.test",
      token: "t", // the box↔relay registration token; verifyToken accepts any here
      localPort: httpsPort, // a paired connection is spliced to the box's OWN HTTPS listener
      sleep: realSleep, // a real abort-aware sleep (the boot.ts wiring), so abort tears it down promptly
      signal: ac.signal,
      log: tunnelLog,
    });

    // ── Cloud: the tunnel-aware HTTP client — TLS to box.test, trusting the box CA, dialing the relay ─
    const http = tunnelHttpClient({ ca: caCertPem, servername: "box.test" });
    const peerUrl = `https://127.0.0.1:${relay.clientPort}/`;

    try {
      await registered;

      const deps: SyncPullDeps = {
        localDb: mirrorApplier,
        subscriberId: SUB,
        tenantId: TENANT,
        localEnvironment: "production",
        http,
        batchLimit: 500,
        enrolments: ALL_SYNC_ENROLMENTS,
        moduleVersions: {},
        moduleByTable: new Map<string, string>(),
      };
      const peer: PullPeer = { nodeId: NODE_A, url: peerUrl, token: sourcePeerToken };

      // Pull the ordered lane through the tunnel: GET /hello (env handshake) + GET /log, then apply.
      const result = await syncPullOnce(deps, peer);
      expect(result.applied).toBe(SALE_IDS.length);

      // Every seeded sale landed on the mirror, byte-identical: total is numeric(12,2) and vat_breakdown
      // is jsonb stored verbatim — 1.50 survives, never JS-collapsed to 1.5 across the wire.
      for (const id of SALE_IDS) {
        const row = await mirrorAdmin.execute<{ total: string; vat0: string }>(
          sql`select total::text as total, vat_breakdown->>0 as vat0 from sales where id = ${id}`,
        );
        expect(row.rows[0]!.total).toBe("10.00");
        expect(row.rows[0]!.vat0).toBe("1.50");
      }

      // The mirror's (subscriber, origin, lane) cursor advanced to the source's max seq for NODE_A.
      const sourceMax = await source.admin.execute<{ seq: string }>(
        sql`select max(seq)::text as seq from sync_log where origin_id = ${NODE_A}::uuid`,
      );
      const mirrorCursor = await mirrorApplier.execute<{ seq: string }>(
        sql`select last_applied_seq::text as seq from sync_cursor
            where subscriber_id = ${SUB} and origin_id = ${NODE_A}::uuid and lane = 'ordered'`,
      );
      expect(mirrorCursor.rows[0]!.seq).toBe(sourceMax.rows[0]!.seq);

      // POST /sync-api/cursor succeeds through the tunnel — the mirror reports how far it has applied
      // and the SOURCE records it into its OWN sync_cursor (origin=self, subscriber from the token), so
      // retention can hold the log at the min across every subscriber (spec §3.1).
      const reported = await http(`${peerUrl}sync-api/cursor`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sourcePeerToken}`, "content-type": "application/json" },
        body: JSON.stringify({ lane: "ordered", lastAppliedSeq: mirrorCursor.rows[0]!.seq }),
      });
      expect(reported.status).toBe(200);
      const sourceCursor = await source.admin.execute<{ seq: string }>(
        sql`select last_applied_seq::text as seq from sync_cursor
            where subscriber_id = ${PEER_SUBSCRIBER} and origin_id = ${NODE_A}::uuid and lane = 'ordered'`,
      );
      expect(sourceCursor.rows[0]!.seq).toBe(mirrorCursor.rows[0]!.seq);

      // ── Blindness: the relay copied bytes it could not read ─────────────────────────────────────
      // Everything the cloud sent the box passed through the relay's `bytesSeen()` recorder. Not one
      // plaintext HTTP token appears in it, and every recorded buffer begins on a TLS record boundary
      // (content-type 0x14 ChangeCipherSpec … 0x17 ApplicationData) — the relay only ever saw TLS.
      const seen = relay.bytesSeen();
      expect(seen.length).toBeGreaterThan(0);
      const wire = Buffer.concat(seen).toString("latin1");
      expect(wire).not.toContain("GET "); // no request line
      expect(wire).not.toContain("POST ");
      expect(wire).not.toContain("HTTP/1."); // no status/request version
      expect(wire).not.toContain("sync-api"); // no path
      expect(wire).not.toContain("Bearer"); // no Authorization scheme
      expect(wire.includes(sourcePeerToken)).toBe(false); // no per-peer token, anywhere
      // SECONDARY, corroborating check only. The plaintext-substring-absence assertions ABOVE are the
      // robust primary blindness proof. This per-buffer first-byte test assumes each recorded buffer
      // begins on a TLS record boundary, which TCP framing does NOT guarantee for multi-record payloads
      // (a chunk could start mid-record). So if this loop ever flakes, drop THIS loop — not the
      // substring assertions above, which do not depend on record alignment.
      for (const buf of seen) {
        expect(buf.length).toBeGreaterThan(0);
        expect(buf[0]!).toBeGreaterThanOrEqual(0x14); // a TLS content-type: 0x14–0x17…
        expect(buf[0]!).toBeLessThanOrEqual(0x17); // …and nothing else, so never a plaintext byte
      }
    } finally {
      // Order-independent teardown — the tunnel's undici Agent keep-alives and many live sockets hang
      // the suite to the 180s hookTimeout if any leaks. Abort the box client and await it (it resolves
      // on abort, destroying every socket it owns); close the relay (destroys the paired/parked
      // sockets, which the undici keep-alive socket observes and drops); then closeAllConnections()
      // BEFORE close() on the HTTPS server, since the Agent otherwise keeps its box-side socket alive
      // and close() would wait on it. tunnelHttpClient owns its undici Agent internally and exposes no
      // dispatcher to dispose — the socket teardown above is what releases it.
      ac.abort();
      await tunnelWorker;
      await relay.close();
      httpsServer.closeAllConnections();
      await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    }
  });
});
