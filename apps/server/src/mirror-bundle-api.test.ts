import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { generateSync } from "otplib";
import {
  canonicalize,
  endorseKey,
  generateNodeKeyPair,
  MAX_NODES,
  verifyBytes,
  verifyMembershipDocument,
  type MembershipNode,
} from "@waitron/membership";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { clearRemovedMachine, removeUnjoinedStandby } from "./membership-removal.js";
import { enrolAuthenticator, wrongTotpCode, TOTP_KEY_RING } from "./testing/authenticator.js";
import { writerBesideRequest } from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

// Pause points for the cases that land a removal part-way through a request. Each runs once and
// clears itself; unset, the wrapped function behaves as the real one.
const pause = vi.hoisted(() => ({
  beforeModuleConfigRead: undefined as (() => Promise<void>) | undefined,
  beforeChartMint: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("./module-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./module-config.js")>();
  return {
    ...actual,
    readModuleConfig: async (stateDir: string) => {
      const hook = pause.beforeModuleConfigRead;
      pause.beforeModuleConfigRead = undefined;
      await hook?.();
      return actual.readModuleConfig(stateDir);
    },
  };
});

vi.mock("./membership-mint.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./membership-mint.js")>();
  return {
    ...actual,
    mintNextMembershipDocument: async (
      ...args: Parameters<typeof actual.mintNextMembershipDocument>
    ) => {
      const hook = pause.beforeChartMint;
      pause.beforeChartMint = undefined;
      await hook?.();
      return actual.mintNextMembershipDocument(...args);
    },
  };
});

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
      credentialKeyRing: TOTP_KEY_RING,
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

async function installationCounter(): Promise<number[]> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select proximo_numero as n from contadores_instalacion`,
  );
  return rows.map((r) => r.n);
}

async function removalRows(): Promise<Record<string, unknown>[]> {
  const { rows } = await db.execute<Record<string, unknown>>(
    sql`select removed_node_id, term from membership_removals`,
  );
  return rows;
}

/** Holds a chart listing this primary and `standbyNodeId` as a serving standby; returns its term. */
async function holdChartWithStandby(
  designated: AdoptResult,
  standbyNodeId: string,
): Promise<number> {
  const term = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
  const members: MembershipNode[] = [
    { nodeId: designated.nodeId, contactUrl: "https://box.deli.test", standing: "serving-primary" },
    { nodeId: standbyNodeId, contactUrl: "https://cloud.deli.test", standing: "serving-secondary" },
  ];
  await writeNodeMembership(
    db,
    signedMembershipDoc(term, { signerNodeId: designated.nodeId, nodes: members }),
  );
  return term;
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

afterEach(() => {
  pause.beforeModuleConfigRead = undefined;
  pause.beforeChartMint = undefined;
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

  it("signs in an admin with an authenticator who sends a correct current code", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const secret = await enrolAuthenticator(db, adminPersonId, ADMIN_PASSWORD, TOTP_KEY_RING);
    const app = mountApp(designated, "https://relay.example:9000/");

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      totp: generateSync({ secret }),
      ...validStandby(),
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  });

  it("refuses an admin with an authenticator who sends a wrong code with 401 password.invalid", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const secret = await enrolAuthenticator(db, adminPersonId, ADMIN_PASSWORD, TOTP_KEY_RING);
    const app = mountApp(designated, "https://relay.example:9000/");

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      totp: wrongTotpCode(secret),
      ...validStandby(),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
  });

  it("answers every login that fails identically, whatever the cause, and reserves nothing", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const secret = await enrolAuthenticator(db, adminPersonId, ADMIN_PASSWORD, TOTP_KEY_RING);
    const suspendedAdminId = await withTransaction(db, async (tx) => {
      const [row] = await tx
        .insert(persons)
        .values({
          displayName: "Administradora suspendida",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(ADMIN_PASSWORD),
          role: "admin",
          status: "suspended",
        })
        .returning({ id: persons.id });
      return row!.id;
    });
    const app = mountApp(designated, "https://relay.example:9000/");
    const counterBefore = await installationCounter();

    const causes: Record<string, Record<string, unknown>> = {
      unknown: { personId: crypto.randomUUID(), password: ADMIN_PASSWORD },
      // The suspended admin's own password, so only the suspension can be the cause.
      suspended: { personId: suspendedAdminId, password: ADMIN_PASSWORD },
      wrongPassword: { personId: adminPersonId, password: "wrong", totp: generateSync({ secret }) },
      wrongCode: { personId: adminPersonId, password: ADMIN_PASSWORD, totp: wrongTotpCode(secret) },
      missingCode: { personId: adminPersonId, password: ADMIN_PASSWORD },
    };
    const answers: Record<string, unknown> = {};
    for (const [cause, credential] of Object.entries(causes)) {
      const res = await post(app, { ...credential, ...validStandby() });
      answers[cause] = { status: res.status, body: await res.json() };
    }
    const refused = { status: 401, body: { error: { code: "password.invalid", params: {} } } };
    expect(answers).toEqual({
      unknown: refused,
      suspended: refused,
      wrongPassword: refused,
      wrongCode: refused,
      missingCode: refused,
    });
    expect(await installationCounter()).toEqual(counterBefore);
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
      [
        `FA-${fiscal.numeroInstalacion}`,
        `FF-${fiscal.numeroInstalacion}`,
        `RF-${fiscal.numeroInstalacion}`,
      ].sort(),
    );
    const byCode = new Map(r.series.map((s) => [s.code, s.purpose]));
    expect(byCode.get(`FA-${fiscal.numeroInstalacion}`)).toBe("standard");
    expect(byCode.get(`FF-${fiscal.numeroInstalacion}`)).toBe("full");
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

  it("refuses a standby id the held chart lists as evicted with 409 mirror.standby_removed, before reserving anything", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");
    const removedId = crypto.randomUUID();
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
          { nodeId: removedId, contactUrl: "https://cloud.deli.test", standing: "evicted" },
        ],
      }),
    );
    const chartBefore = await readNodeMembership(db);
    const counterBefore = await installationCounter();

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      ...validStandby(),
      standbyNodeId: removedId,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "mirror.standby_removed", params: {} } });
    expect(await installationCounter()).toEqual(counterBefore);
    expect(await readNodeMembership(db)).toEqual(chartBefore);

    // Control: a fresh id through the same app does reserve, so the counter read above can move.
    const fresh = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      ...validStandby(),
    });
    expect(fresh.status).toBe(200);
    expect(await installationCounter()).not.toEqual(counterBefore);
  });

  it("refuses a standby id the held chart has cleared (revoked) with 409 mirror.standby_removed, before reserving anything", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");
    const clearedId = crypto.randomUUID();
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
        revoked: [clearedId],
      }),
    );
    const chartBefore = await readNodeMembership(db);
    const counterBefore = await installationCounter();

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      ...validStandby(),
      standbyNodeId: clearedId,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "mirror.standby_removed", params: {} } });
    expect(await installationCounter()).toEqual(counterBefore);
    expect(await readNodeMembership(db)).toEqual(chartBefore);
  });

  it("refuses 409 membership.revoked_duplicate when the held chart's revoked list names a machine twice, so no chart can be minted", async () => {
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
        revoked: ["gone", "gone"],
      }),
    );
    const chartBefore = await readNodeMembership(db);

    const res = await post(app, {
      personId: adminPersonId,
      password: ADMIN_PASSWORD,
      ...validStandby(),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "membership.revoked_duplicate", params: { nodeId: "gone" } },
    });
    expect(await readNodeMembership(db)).toEqual(chartBefore);
  });

  describe("a held chart already listing MAX_NODES machines", () => {
    /** This primary and MAX_NODES - 1 others, the first of them `evicted`; returns their ids. */
    async function holdFullChart(
      designated: AdoptResult,
    ): Promise<{ term: number; ids: string[] }> {
      const term = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
      const others: MembershipNode[] = Array.from({ length: MAX_NODES - 1 }, (_, i) => ({
        nodeId: crypto.randomUUID(),
        contactUrl: `https://standby-${i}.deli.test`,
        standing: i === 0 ? "evicted" : "serving-secondary",
      }));
      await writeNodeMembership(
        db,
        signedMembershipDoc(term, {
          signerNodeId: designated.nodeId,
          nodes: [
            {
              nodeId: designated.nodeId,
              contactUrl: "https://box.deli.test",
              standing: "serving-primary",
            },
            ...others,
          ],
        }),
      );
      return { term, ids: others.map((n) => n.nodeId) };
    }

    it("refuses a new standby with 409 mirror.membership_full, before reserving anything", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated, "https://relay.example:9000/");
      await holdFullChart(designated);
      const chartBefore = await readNodeMembership(db);
      const counterBefore = await installationCounter();

      const res = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...validStandby(),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.membership_full", params: { limit: MAX_NODES } },
      });
      expect(await installationCounter()).toEqual(counterBefore);
      expect(await readNodeMembership(db)).toEqual(chartBefore);
    });

    it("takes the new standby once an admin clears the removed machine, and still refuses the cleared id", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated, "https://relay.example:9000/");
      const { ids } = await holdFullChart(designated);
      const removed = ids[0]!;
      const newcomer = validStandby();
      const refused = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...newcomer,
      });
      expect(refused.status).toBe(409);

      const clearance = await clearRemovedMachine(
        { db, ring: RING, nodeId: designated.nodeId, log: () => {} },
        { targetNodeId: removed, personId: adminPersonId },
      );
      expect(clearance.cleared).toBe(true);

      const joined = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...newcomer,
      });
      expect(joined.status).toBe(200);
      const after = (await readNodeMembership(db))!;
      expect(after.body.nodes).toHaveLength(MAX_NODES);
      expect(after.body.nodes.map((n) => n.nodeId)).toContain(newcomer.standbyNodeId);
      expect(after.body.revoked).toEqual([removed]);

      const returning = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...validStandby(),
        standbyNodeId: removed,
      });
      expect(returning.status).toBe(409);
      expect(await returning.json()).toEqual({
        error: { code: "mirror.standby_removed", params: {} },
      });
    });

    it("still serves a standby the full chart already lists, which adds no machine", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated, "https://relay.example:9000/");
      const { ids } = await holdFullChart(designated);
      const listed = ids[1]!;

      const res = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...validStandby(),
        standbyNodeId: listed,
      });

      expect(res.status).toBe(200);
      const after = (await readNodeMembership(db))!;
      expect(after.body.nodes).toHaveLength(MAX_NODES);
      expect(after.body.nodes.find((n) => n.nodeId === listed)?.contactUrl).toBe(
        "https://cloud.deli.test",
      );
    });

    it("refuses 409 mirror.membership_full when the chart fills between a chart round's read and its write", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated, "https://relay.example:9000/");
      await holdChartWithStandby(designated, crypto.randomUUID());
      let filledTerm = -1;
      pause.beforeChartMint = async () => {
        filledTerm = (await holdFullChart(designated)).term;
      };

      const res = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...validStandby(),
      });

      expect(pause.beforeChartMint).toBeUndefined();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.membership_full", params: { limit: MAX_NODES } },
      });
      // The request wrote no later chart over the full one.
      expect((await readNodeMembership(db))?.body.term).toBe(filledTerm);
    });
  });

  describe("a removal of the same standby landing part-way through the request", () => {
    const removeDuringRequest =
      (designated: AdoptResult, adminPersonId: string, standbyNodeId: string) =>
      async (): Promise<void> => {
        await removeUnjoinedStandby(
          { db, ring: RING, nodeId: designated.nodeId, log: () => {} },
          { targetNodeId: standbyNodeId, personId: adminPersonId },
        );
      };

    it("refuses 409 mirror.standby_removed when the removal commits before the reservation, which spends nothing", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated, "https://relay.example:9000/");
      const standbyNodeId = crypto.randomUUID();
      const seedTerm = await holdChartWithStandby(designated, standbyNodeId);
      const counterBefore = await installationCounter();
      pause.beforeModuleConfigRead = removeDuringRequest(designated, adminPersonId, standbyNodeId);

      const res = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...validStandby(),
        standbyNodeId,
      });

      expect(pause.beforeModuleConfigRead).toBeUndefined();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: { code: "mirror.standby_removed", params: {} } });
      expect(await installationCounter()).toEqual(counterBefore);
      const after = (await readNodeMembership(db))!;
      expect(after.body.term).toBe(seedTerm + 1);
      expect(after.body.nodes.find((n) => n.nodeId === standbyNodeId)?.standing).toBe("evicted");
      expect(await removalRows()).toEqual([{ removed_node_id: standbyNodeId, term: seedTerm + 1 }]);
    });

    it("refuses 409 mirror.standby_removed when the removal commits between a chart round's read and its write", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated, "https://relay.example:9000/");
      const standbyNodeId = crypto.randomUUID();
      const seedTerm = await holdChartWithStandby(designated, standbyNodeId);
      const counterBefore = await installationCounter();
      pause.beforeChartMint = removeDuringRequest(designated, adminPersonId, standbyNodeId);

      const res = await post(app, {
        personId: adminPersonId,
        password: ADMIN_PASSWORD,
        ...validStandby(),
        standbyNodeId,
      });

      expect(pause.beforeChartMint).toBeUndefined();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: { code: "mirror.standby_removed", params: {} } });
      // The reservation ran before the chart round, so its number is spent.
      expect(await installationCounter()).toEqual(counterBefore.map((n) => n + 1));
      // The removal's chart is the one held: the request wrote no later term over it.
      const after = (await readNodeMembership(db))!;
      expect(after.body.term).toBe(seedTerm + 1);
      expect(after.body.nodes.find((n) => n.nodeId === standbyNodeId)?.standing).toBe("evicted");
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

  it("lets another writer commit while it derives the key", async () => {
    const { designated, adminPersonId } = await setupVenue();
    const app = mountApp(designated, "https://relay.example:9000/");

    const { result, order } = await writerBesideRequest(db, () =>
      post(app, { personId: adminPersonId, password: ADMIN_PASSWORD, ...validStandby() }),
    );

    expect(result.status).toBe(200);
    expect(order.slice(0, 2)).toEqual(["writer", "request's transaction"]);
  });
});
