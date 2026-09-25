import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  nodes,
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
  endorseKey,
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

// No case races concurrent adopts: writers are serialised on this engine, so the chart-write retry
// is driven by triggers that refuse updates of the held chart instead.
const LOCALE = "es-ES";
const ADMIN_PASSWORD = "dashPass123";
const STAFF_PASSWORD = "staffPass123";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// A real key, so the endorsement's signature can be verified.
const STANDBY_PUB = generateNodeKeyPair().publicKey;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// `tenants_country_tax_id_uq` is unique, so each provisioned venue needs its own NIF.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(81_000_000 + nifCounter).padStart(8, "0")}K`;
}

let stateDir: string;
let db: Database;

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
  await establishNodeIdentity({ ownerDb: db, ring: RING }, designated.nodeId);
  const primaryPublicKey = (await readMembershipTrustSet(db))[designated.nodeId]!;
  const adminPersonId = await withTransaction(db, async (tx) => {
    const r = await tx.execute<{ id: string }>(sql`select id from persons where role = 'admin'`);
    return r.rows[0]!.id;
  });
  return { designated, adminPersonId, primaryPublicKey };
}

async function seedStaff(): Promise<string> {
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
  stateDir = await mkdtemp(join(tmpdir(), "waitron-mirror-bundle-api-state-"));
  await mkdir(join(stateDir, "tls"), { recursive: true });
  await writeFile(
    join(stateDir, "tls", "ca.crt"),
    mintSelfSignedServerCert({ hostnames: ["waitron.local"], ipAddresses: [], now: new Date() })
      .caCertPem,
  );

  db = suite.db;
}, 180_000);

// The per-test reset wipes the deployment stamp.
beforeEach(async () => {
  await stampDeployment(db, "preproduction");
});

afterAll(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});

describe("POST /management-api/mirror-bundle (primary endpoint)", () => {
  it("returns a bundle carrying the venue identity for an authorised admin credential", async () => {
    const { designated, adminPersonId } = await setupVenue();
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
    expect(bundle.primaryNode.name).toBe("Sala principal");
    expect(bundle.relayUrl).toBe("https://relay.example:9000/");
    expect(bundle.boxHostname).toBe("waitron.local");
    for (const line of lines) {
      expect(line).not.toContain(ADMIN_PASSWORD);
    }
  });

  it("appends the standby to the membership document with its contactUrl, term bumped, signed by the primary", async () => {
    const { designated, adminPersonId, primaryPublicKey } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");
    const standbyNodeId = crypto.randomUUID();

    // The survival assertions below mean something only over a non-empty held chart.
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
    expect(after?.body.nodes).toContainEqual({
      nodeId: standbyNodeId,
      contactUrl: "https://cloud.deli.test",
      standing: "serving-secondary",
    });
    // Appended, not replaced: minting from an empty list would pass every other assertion here.
    for (const node of before?.body.nodes ?? []) {
      expect(after?.body.nodes).toContainEqual(node);
    }
    expect(after?.signerNodeId).toBe(designated.nodeId);
    expect(after?.endorsements).toEqual([]);
    expect(verifyMembershipDocument(after!, { [designated.nodeId]: primaryPublicKey }).valid).toBe(
      true,
    );

    // A re-adopt of the same node refreshes its entry in place rather than adding a second.
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

  // A primary that began as a mirror is trusted by a peer that holds only the endorser's key through
  // the endorsement of its key that adopt stored on its node row.
  it("carries the primary's stored endorsement, so a peer trusting only the endorser accepts the appended chart", async () => {
    const { designated, adminPersonId, primaryPublicKey } = await setupVenue();
    const endorserNodeId = crypto.randomUUID();
    const endorser = generateNodeKeyPair();
    const endorsement = endorseKey(
      designated.nodeId,
      primaryPublicKey,
      endorserNodeId,
      endorser.privateKey,
    );
    await db.update(nodes).set({ endorsement }).where(eq(nodes.id, designated.nodeId));
    const app = mountApp(designated, "https://relay.example:9000/");

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      ...validStandby(),
    });
    expect(res.status).toBe(200);

    const after = (await readNodeMembership(db))!;
    expect(after.endorsements).toEqual([endorsement]);
    const byEndorser = verifyMembershipDocument(after, { [endorserNodeId]: endorser.publicKey });
    expect(byEndorser.valid ? "valid" : byEndorser.reason).toBe("valid");
    const direct = verifyMembershipDocument(after, { [designated.nodeId]: primaryPublicKey });
    expect(direct.valid ? "valid" : direct.reason).toBe("valid");
  });

  it("signs a retried chart write with the endorsement stored when that round reads, not the first round's", async () => {
    const { designated, adminPersonId, primaryPublicKey } = await setupVenue();
    const oldEndorserNodeId = crypto.randomUUID();
    const oldEndorsement = endorseKey(
      designated.nodeId,
      primaryPublicKey,
      oldEndorserNodeId,
      generateNodeKeyPair().privateKey,
    );
    const newEndorserNodeId = crypto.randomUUID();
    const newEndorser = generateNodeKeyPair();
    const newEndorsement = endorseKey(
      designated.nodeId,
      primaryPublicKey,
      newEndorserNodeId,
      newEndorser.privateKey,
    );
    await db
      .update(nodes)
      .set({ endorsement: oldEndorsement })
      .where(eq(nodes.id, designated.nodeId));
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
        ],
      }),
    );
    // Only while the old endorsement is stored: the first chart write replaces it and loses its
    // round, and every later round goes through.
    const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
    await db.execute(
      sql.raw(
        `create trigger test_node_membership_endorsement_moves before update on node_membership
         when (select json_extract(endorsement, '$.endorsedBy') from nodes where id = ${quote(designated.nodeId)}) = ${quote(oldEndorserNodeId)}
         begin
           update nodes set endorsement = ${quote(JSON.stringify(newEndorsement))} where id = ${quote(designated.nodeId)};
           select raise(ignore);
         end`,
      ),
    );
    try {
      const app = mountApp(designated, "https://relay.example:9000/");
      const res = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...validStandby(),
      });
      expect(res.status).toBe(200);
    } finally {
      await db.execute(sql.raw("drop trigger test_node_membership_endorsement_moves"));
    }

    const after = (await readNodeMembership(db))!;
    expect(after.body.term).toBe(seedTerm + 1);
    expect(after.endorsements).toEqual([newEndorsement]);
    const byNewEndorser = verifyMembershipDocument(after, {
      [newEndorserNodeId]: newEndorser.publicKey,
    });
    expect(byNewEndorser.valid ? "valid" : byNewEndorser.reason).toBe("valid");
  });

  it("gives up with 503 membership.write_contended when every chart write loses its term guard", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");
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
        ],
      }),
    );
    // Every update of the held chart is silently skipped, so each round's guarded write is refused.
    await db.execute(
      sql.raw(
        "create trigger test_node_membership_contended before update on node_membership begin select raise(ignore); end",
      ),
    );
    try {
      const res = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...validStandby(),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: { code: "membership.write_contended", params: { attempts: 8 } },
      });
    } finally {
      await db.execute(sql.raw("drop trigger test_node_membership_contended"));
    }
    expect((await readNodeMembership(db))?.body.term).toBe(seedTerm);
  });

  it("refuses a non-admin (staff) credential with 403", async () => {
    const { designated } = await setupVenue();
    const staffPersonId = await seedStaff();
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
    expect(fiscal.numeroInstalacion).toBeGreaterThan(0);
    expect(typeof fiscal.nif).toBe("string");
    expect(fiscal.idSistemaInformatico).toBe("W1");
    expect(r.series.map((s) => s.code).sort()).toEqual(
      [`FA-${fiscal.numeroInstalacion}`, `RF-${fiscal.numeroInstalacion}`].sort(),
    );
    const byCode = new Map(r.series.map((s) => [s.code, s.purpose]));
    expect(byCode.get(`FA-${fiscal.numeroInstalacion}`)).toBe("standard");
    expect(byCode.get(`RF-${fiscal.numeroInstalacion}`)).toBe("rectificative");
    expect(r.endorsement.nodeId).toBe(standby.nodeId);
    expect(r.endorsement.publicKey).toBe(standby.publicKey);
    expect(r.endorsement.endorsedBy).toBe(designated.nodeId);
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

    const res = await post(app, { personId: adminPersonId, password: ADMIN_PASSWORD });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("mirror.standby_invalid");

    // Every field but the one under test is well-formed; `""` is a valid contact URL.
    const res2 = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: "not-a-uuid",
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "",
    });
    expect(res2.status).toBe(400);
    expect((await res2.json()).error.code).toBe("mirror.standby_invalid");

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

    // Not a bare origin: tills concatenate paths onto it.
    const slash = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "https://cloud.deli.test/",
    });
    expect(slash.status).toBe(400);
    expect(await slash.json()).toEqual({ error: { code: "mirror.standby_invalid", params: {} } });

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

    // Every other `""` row here fails for a different field; this is the accept path.
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
