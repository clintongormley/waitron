import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  readMembershipTrustSet,
  readNodeMembership,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import {
  canonicalize,
  generateNodeKeyPair,
  verifyBytes,
  verifyMembershipDocument,
} from "@waitron/membership";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

/**
 * The primary's adopt endpoint, on the engine the box now runs.
 *
 * ## What went with PostgreSQL, and is replaced by nothing
 *
 * `appDb` used to be a second connection opened as `app_login` — a cluster LOGIN role inheriting
 * `app_user`'s grants, created by the now-deleted `apps/server/src/testing/global-setup.ts`. The
 * endpoint authenticates, authorizes and reads the venue's tenant and node identity through it, so
 * that connection is what put all of it behind the grants a real box runs under.
 *
 * **The role is gone and nothing replaces it.** SQLite has no roles, `pg.connectAs` has no
 * counterpart, and `asAppUser` is an inert function (`packages/db/src/testing/roles.ts`). Every call
 * runs on the suite's one handle, so nothing here checks the deployment role's privileges.
 *
 * ## One case is DELETED, because this engine cannot stage the race it existed for
 *
 * `lists EVERY standby under concurrent adopts — the term guard is retried, not last-writer-wins`
 * fired eight adopts at once and checked that all eight reached the org chart. Its value came
 * entirely from the interleaving: its own comment recorded 3 of 8 listed under an unguarded plain
 * upsert, with all eight answered 200.
 *
 * That interleaving no longer happens. Measured here 2026-09-22, by counting the endpoint's calls
 * to `readNodeMembership` (a `vi.mock` wrapper over `@waitron/db`, removed again after the
 * measurement): **eight concurrent adopts produce exactly 8 chart reads, three runs in a row** —
 * one per request, so `appendStandbyToChart`'s retry loop (`./mirror-bundle-api.ts`) never ran a
 * second round and `persistNodeMembershipIfNewer` never once refused a write. Control in the other
 * direction, same probe: ONE adopt produces exactly 1 read, so the counter really was watching the
 * route rather than the suite. The cause is the single write queue — `withTransaction` is
 * `db.withWriteLock` on this engine (`packages/db/src/tenancy.ts:34`), so each request's work
 * completes before the next begins and every mint is built on the winner's chart.
 *
 * So the case would now pass under the very upsert it was written to catch. It is deleted rather
 * than kept green and vacuous, and no replacement is invented here: proving a term guard needs two
 * writers, which one SQLite file does not have.
 */
const LOCALE = "es-ES";
const ADMIN_PASSWORD = "dashPass123";
const STAFF_PASSWORD = "staffPass123";

// The box vault key for `establishNodeIdentity` / `readNodeIdentityKey` — a fixed test ring, exactly
// as node-identity.test.ts uses. The primary seals its identity key under this ring, and the endpoint
// unseals it to endorse the standby's key.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The standby's identity key the primary vouches for — a real Ed25519 SPKI public key so the
// endorsement's signature verifies against the primary's key over canonicalize({nodeId, publicKey}).
const STANDBY_PUB = generateNodeKeyPair().publicKey;

// Reset per test (the default): each test provisions its OWN venue and then mutates the membership
// document (appends standbys, bumps the term, reserves identities). No read here filters by anything
// but id, so two venues left in one database would let a membership/reserved-identity read return the
// wrong row. The reset wipes the deployment stamp, so it is re-applied in beforeEach.
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// `tenants_country_tax_id_uq` is unique, so each provisioned venue needs its own NIF — the
// per-suite counter the sibling suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(81_000_000 + nifCounter).padStart(8, "0")}K`;
}

let stateDir: string;
let db: Database;

/** Provision a fresh venue (as the owner) with standard FA + rectificative RF series and an ESTABLISHED
 * node identity, returning the four designated ids in AdoptResult shape, the seeded admin's person id,
 * and the primary node's public key (the trust anchor its endorsement must verify against).
 * `applyVenue` seeds ONE `role='admin'` person carrying ADMIN_PASSWORD. */
async function setupVenue(): Promise<{
  designated: AdoptResult;
  adminPersonId: string;
  primaryPublicKey: string;
}> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Mirror Bundle API SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "FA",
        rectificativeSeriesCode: "RF",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(ADMIN_PASSWORD),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const designated: AdoptResult = {
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
  // Establish the primary's membership identity (owner-side seal + nodes.public_key stamp), so the
  // endpoint can unseal the private key and endorse the standby. Mirrors node-identity.test.ts.
  await establishNodeIdentity({ ownerDb: db, ring: RING }, designated.nodeId);
  const primaryPublicKey = (await readMembershipTrustSet(db))[designated.nodeId]!;
  // The admin person id.
  const adminPersonId = await withTransaction(db, async (tx) => {
    const r = await tx.execute<{ id: string }>(sql`select id from persons where role = 'admin'`);
    return r.rows[0]!.id;
  });
  return { designated, adminPersonId, primaryPublicKey };
}

/** Insert a second, NON-admin (staff) person carrying a dashboard password, returning its id. Staff
 * lacks `mirror.create` (admin-only), so it authenticates but fails authorization → 403. */
async function seedStaff(): Promise<string> {
  // Seeded through the table definition rather than as raw SQL: `persons.id` and `persons.created_at`
  // are `$defaultFn` generators on this engine, which a raw insert never reaches while both columns
  // are NOT NULL.
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .insert(persons)
      .values({
        displayName: "Cajera",
        pinHash: hashPin("4321"),
        passwordHash: hashPassword(STAFF_PASSWORD),
        role: "staff",
      })
      .returning({ id: persons.id });
    return row!.id;
  });
}

/** Mount the endpoint on a fresh Hono app with the given relay wiring and (optional) logger. */
function mountApp(designated: AdoptResult, relayUrl: string | undefined, log?: Logger): Hono {
  const app = new Hono();
  mountMirrorBundleApi(
    app,
    {
      appDb: db,
      ring: RING,
      stateDir,
      relayUrl,
      boxHostname: "waitron.local",
      designated,
      accountKey: Buffer.alloc(32, 9).toString("base64"),
    },
    log,
  );
  return app;
}

/** A well-formed standby identity — a fresh nodeId, the real STANDBY_PUB, and the address the standby
 * advertises — required in every request now (the primary reserves this standby's identity, endorses
 * this key, and records the address in the membership document). */
function validStandby(): {
  standbyNodeId: string;
  standbyPublicKey: string;
  standbyContactUrl: string;
} {
  return {
    standbyNodeId: crypto.randomUUID(),
    standbyPublicKey: STANDBY_PUB,
    standbyContactUrl: "https://cloud.deli.test",
  };
}

async function post(app: Hono, body: unknown): Promise<Response> {
  return app.request("/management-api/mirror-bundle", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeAll(async () => {
  // The bundle's stateDir must carry tls/ca.crt (the box CA path caCertPath resolves to). Mint a real
  // self-signed CA and write it there so boxCaPem reads back a genuine PEM.
  stateDir = await mkdtemp(join(tmpdir(), "waitron-mirror-bundle-api-state-"));
  await mkdir(join(stateDir, "tls"), { recursive: true });
  await writeFile(
    join(stateDir, "tls", "ca.crt"),
    mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now: new Date() })
      .caCertPem,
  );

  db = suite.db;
}, 180_000);

// The per-test reset (afterEach) truncates the deployment stamp along with the data, so re-stamp
// before each test — every test needs its database provisioned `preproduction`.
beforeEach(async () => {
  await stampDeployment(db, "preproduction");
});

afterAll(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});

describe("POST /management-api/mirror-bundle (primary endpoint)", () => {
  it("returns a bundle carrying the venue identity for an authorised admin credential", async () => {
    const { designated, adminPersonId } = await setupVenue();
    // A log spy: the credential must NEVER reach the log (the no-secret discipline).
    const lines: string[] = [];
    const log: Logger = (level, event, fields) =>
      lines.push(JSON.stringify({ level, event, fields }));
    const app = mountApp(designated, "https://relay.example:9000/", log);

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      ...validStandby(),
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      tenant: { country: string; taxId: string };
      primaryNode: { name: string };
      relayUrl: string;
      boxHostname: string;
    };
    expect(bundle.tenant.taxId).toMatch(/^\d{8}K$/);
    // Provisioning names the node after the LOCATION (venue-plan `create-node`).
    expect(bundle.primaryNode.name).toBe("Sala principal");
    // The relay coordinates round-trip verbatim as a FULL https URL.
    expect(bundle.relayUrl).toBe("https://relay.example:9000/");
    expect(bundle.boxHostname).toBe("waitron.local");
    // The credential never appears in any log line.
    for (const line of lines) {
      expect(line).not.toContain(ADMIN_PASSWORD);
    }
  });

  it("appends the standby to the membership document with its contactUrl, term bumped, signed by the primary", async () => {
    const { designated, adminPersonId, primaryPublicKey } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");
    const standbyNodeId = crypto.randomUUID();

    // The "everyone else survives" assertions below are only worth anything over a NON-EMPTY held
    // chart, so this test seeds its own rather than inherit whatever a sibling left behind (CLAUDE.md
    // §4: order-independent). `node_membership` is a whole-database singleton, so the seed is minted
    // one past whatever term is held rather than at a fixed 0.
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    await writeNodeMembership(
      db,
      signedMembershipDoc(seedTerm, {
        signerNodeId: designated.nodeId,
        nodes: [
          {
            nodeId: designated.nodeId,
            contactUrl: "https://box.deli.test",
            standing: "serving-primary",
          },
          {
            nodeId: crypto.randomUUID(),
            contactUrl: "https://spare.deli.test",
            standing: "sell-only",
          },
        ],
      }),
    );
    const before = await readNodeMembership(db);
    // Non-vacuity: the seed above is what makes the survival loops mean anything, so a seed that
    // silently wrote nothing fails loudly here rather than turning them into no-ops.
    expect(before?.body.nodes.length ?? 0).toBeGreaterThan(0);

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId,
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "https://cloud.deli.test",
    });
    expect(res.status).toBe(200);

    const after = await readNodeMembership(db);
    expect(after?.body.term).toBe((before?.body.term ?? -1) + 1);
    // The joining node is listed as a serving secondary at the address it advertised — the address a
    // till reroutes to after a failover (till-reroute §3.3).
    expect(after?.body.nodes).toContainEqual({
      nodeId: standbyNodeId,
      contactUrl: "https://cloud.deli.test",
      standing: "serving-secondary",
    });
    // APPENDED, not replaced: every node the held chart already carried survives verbatim — standing
    // and contactUrl untouched. Without this, minting from an EMPTY list instead of the held one
    // passes every other assertion here while silently evicting the rest of the venue.
    for (const node of before?.body.nodes ?? []) {
      expect(after?.body.nodes).toContainEqual(node);
    }
    // Signed by THIS primary, and it verifies against the primary's own key — so the document a till
    // later fetches is authentic, not merely present.
    expect(after?.signerNodeId).toBe(designated.nodeId);
    expect(verifyMembershipDocument(after!, { [designated.nodeId]: primaryPublicKey }).valid).toBe(
      true,
    );

    // A RE-ADOPT of the same node (a wiped standby that kept its id, or a moved address): the entry is
    // refreshed IN PLACE — one entry for that nodeId carrying the new url, not a second one — and the
    // term bumps again.
    const res2 = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId,
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "https://cloud2.deli.test",
    });
    expect(res2.status).toBe(200);

    const afterReadopt = await readNodeMembership(db);
    expect(afterReadopt?.body.term).toBe(after!.body.term + 1);
    expect(afterReadopt?.body.nodes.filter((n) => n.nodeId === standbyNodeId)).toEqual([
      {
        nodeId: standbyNodeId,
        contactUrl: "https://cloud2.deli.test",
        standing: "serving-secondary",
      },
    ]);
    for (const node of before?.body.nodes ?? []) {
      expect(afterReadopt?.body.nodes).toContainEqual(node);
    }
  });

  it("refuses a non-admin (staff) credential with 403", async () => {
    const { designated } = await setupVenue();
    const staffPersonId = await seedStaff();
    // No logger passed here — exercises the no-op default (mountMirrorBundleApi's `log?`).
    const app = mountApp(designated, "relay.example:9000");

    const res = await post(app, {
      personId: staffPersonId,
      password: STAFF_PASSWORD,
      ...validStandby(),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("authorization.not_permitted");
  });

  it("refuses a wrong password with 401 before it can authorize", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "relay.example:9000");

    const res = await post(app, { personId: adminPersonId, password: "wrong", ...validStandby() });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });

  it("refuses an invalid credential shape with 401 (the dashboard-login screen)", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated, "relay.example:9000");

    const res = await post(app, { personId: "not-a-uuid" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });

  it("refuses a present non-string totp with 401 (screened before loginManager)", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "relay.example:9000");

    // A well-formed personId + password but a NON-string totp: refused as password.invalid by the body
    // screen (line 81) before it can reach loginManager, the dashboard-login convention.
    const res = await post(app, { personId: adminPersonId, password: ADMIN_PASSWORD, totp: 123 });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });

  it("refuses mirror.no_relay (400) when no relay is configured, AFTER authorizing", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, undefined);

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      ...validStandby(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("mirror.no_relay");
  });

  it("returns a reserved identity: a fresh number, disjoint series, and a valid endorsement", async () => {
    const { designated, adminPersonId, primaryPublicKey } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");
    const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: standby.nodeId,
      standbyPublicKey: standby.publicKey,
      standbyContactUrl: "https://cloud.deli.test",
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      reservedIdentity: {
        modules: {
          "fiscal-verifactu": {
            nif: string;
            idSistemaInformatico: string;
            numeroInstalacion: number;
          };
        };
        series: { code: string; purpose: string }[];
        endorsement: { nodeId: string; publicKey: string; endorsedBy: string; signature: string };
      };
    };
    const r = bundle.reservedIdentity;
    const fiscal = r.modules["fiscal-verifactu"];
    // A fresh installation number the primary reserved (past its own — applyVenue's registerSif took 1).
    expect(fiscal.numeroInstalacion).toBeGreaterThan(0);
    expect(typeof fiscal.nif).toBe("string");
    // The primary's own IdSistemaInformatico — applyVenue registers the SIF under WAITRON_ID_SISTEMA ("W1").
    expect(fiscal.idSistemaInformatico).toBe("W1");
    // Disjoint series: one per primary series (FA + RF), each suffixed with the reserved number.
    expect(r.series.map((s) => s.code).sort()).toEqual(
      [`FA-${fiscal.numeroInstalacion}`, `RF-${fiscal.numeroInstalacion}`].sort(),
    );
    // Purpose is preserved alongside the derived code.
    const byCode = new Map(r.series.map((s) => [s.code, s.purpose]));
    expect(byCode.get(`FA-${fiscal.numeroInstalacion}`)).toBe("standard");
    expect(byCode.get(`RF-${fiscal.numeroInstalacion}`)).toBe("rectificative");
    // The endorsement vouches for THIS standby, by the primary node.
    expect(r.endorsement.nodeId).toBe(standby.nodeId);
    expect(r.endorsement.publicKey).toBe(standby.publicKey);
    expect(r.endorsement.endorsedBy).toBe(designated.nodeId);
    // The signature verifies against the primary's public key over canonicalize({nodeId, publicKey}) —
    // i.e. a trust set {primaryNodeId: primaryPublicKey} would admit this standby key.
    expect(
      verifyBytes(
        canonicalize({ nodeId: standby.nodeId, publicKey: standby.publicKey }),
        r.endorsement.signature,
        primaryPublicKey,
      ),
    ).toBe(true);
  });

  it("rejects a missing/malformed standby identity with 400 mirror.standby_invalid", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");

    // No standby fields at all — a valid admin credential, but the standby identity is required.
    const res = await post(app, { personId: adminPersonId, password: ADMIN_PASSWORD });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("mirror.standby_invalid");

    // A non-UUID standby nodeId is refused the same way. Every field but the one under test is
    // well-formed — `standbyContactUrl: ""` is VALID (a standby that advertises nothing is still a
    // member) — so each sub-case fails for its own reason, not for a second missing field.
    const res2 = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: "not-a-uuid",
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "",
    });
    expect(res2.status).toBe(400);
    expect((await res2.json()).error.code).toBe("mirror.standby_invalid");

    // An empty standby publicKey is refused the same way.
    const res3 = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: "",
      standbyContactUrl: "",
    });
    expect(res3.status).toBe(400);
    expect((await res3.json()).error.code).toBe("mirror.standby_invalid");
  });

  it("refuses a standbyContactUrl that is not a bare origin as mirror.standby_invalid", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");

    // A trailing slash: a well-formed URL, but NOT the bare origin the primary would sign into the
    // chart — tills concatenate paths onto it, and a browser Origin header never carries one.
    const slash = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "https://cloud.deli.test/",
    });
    expect(slash.status).toBe(400);
    expect(await slash.json()).toEqual({ error: { code: "mirror.standby_invalid", params: {} } });

    // A scheme a till must never dial. Refused for the same reason and under the same code — the
    // primary holds this line itself rather than trusting the joiner to have screened its own value.
    const script = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "javascript:alert(1)",
    });
    expect(script.status).toBe(400);
    expect((await script.json()).error.code).toBe("mirror.standby_invalid");
  });

  it("ACCEPTS an empty standbyContactUrl and records the member address-less", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");
    const standbyNodeId = crypto.randomUUID();

    // The documented positive case: a standby that advertises no origin is still a member. Every
    // other `""` row in this file fails for a DIFFERENT field, so without this the accept path is
    // asserted nowhere.
    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId,
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "",
    });
    expect(res.status).toBe(200);
    const after = await readNodeMembership(db);
    expect(after?.body.nodes).toContainEqual({
      nodeId: standbyNodeId,
      contactUrl: "",
      standing: "serving-secondary",
    });
  });

  it("refuses a non-string standbyContactUrl as mirror.standby_invalid", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: 42,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "mirror.standby_invalid", params: {} } });
  });
});
