import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { readNodeMembership, withTransaction, writeNodeMembership } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import type { MembershipNode, SignedMembershipDocument } from "@waitron/membership";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mountBoxRetireApi } from "./box-retire.js";
import { mountManagementApi } from "./management-api.js";

// Exercise route authorization, refusal-to-status mapping and success responses over a migrated
// venue database. Retirement semantics are covered by retire.test.ts.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the seeded manager's dashboard password.
const MANAGER_EMAIL = "manager@x.com";

// The box key ring that seals this node's identity private key (node-identity/promote pattern):
// deterministic so the sealed key round-trips within the suite, and the same key the mint unseals.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The carrier that carries the venue forward — named `serving-primary` in the held chart so a fenced
// self document has a carrier (the happy-path shape retireSelf accepts).
const CARRIER_NODE_ID = "88888888-8888-4888-8888-888888888888";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

// One fixed NIF: this suite owns its own venue directory, so nothing else ever writes the `tenants`
// row the uniqueness constraint covers.
const NIF = "72000001K";

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function setupTenant(): Promise<{ nodeId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: NIF,
        legalName: "Deli Test SL",
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
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );

  await withTransaction(suite.db, async (tx) => {
    // Through the table definition, not raw SQL: `persons.id` and `persons.created_at` are
    // `$defaultFn` generators (`packages/identity/src/schema/persons.ts:26,:67`) that an insert
    // statement never reaches, and both columns are NOT NULL.
    await tx.insert(persons).values({
      displayName: "The Manager",
      email: MANAGER_EMAIL,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword(PASSWORD),
      role: "manager",
    });
  });
  return { nodeId: venue.nodeId };
}

/** A Hono app carrying the management API (for its login route) plus the box-retire route under test.
 * Both surfaces share the owner db + tenant, so a cookie minted on one resolves on the other. */
function buildApp(nodeId: string): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    () => {},
  );
  mountBoxRetireApi(
    app,
    {
      appDb: suite.db,
      ring: RING,
      nodeId,
    },
    () => {},
  );
  return app;
}

/** Log in over HTTP by `email`, returning just the `waitron_management_session=…` cookie pair. */
async function login(app: Hono, email: string): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** A held membership document (design §3/§5) at `term` naming the given nodes. Written through the
 * plain-upsert setter (the read is unverified), so the placeholder signature is fine. */
function membershipDoc(term: number, nodes: readonly MembershipNode[]): SignedMembershipDocument {
  return {
    body: { term, nodes },
    signerNodeId: nodes[0]!.nodeId,
    signature: "self-placeholder-sig",
    endorsements: [],
  };
}

describe("POST /api/box/retire", () => {
  let nodeId: string;
  let managerCookie: string;

  beforeAll(async () => {
    ({ nodeId } = await setupTenant());
    // Establish the node identity so the mint on the happy path has a key to sign with; harmless to
    // the refusal paths, which return before any mint.
    await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, nodeId);
    managerCookie = await login(buildApp(nodeId), MANAGER_EMAIL);
  });

  it("401s without a management session", async () => {
    // A serving-primary self-doc so nothing about the state matters — the gate 401s before any DB work.
    await writeNodeMembership(
      suite.db,
      membershipDoc(5, [{ nodeId, contactUrl: "", standing: "serving-primary" }]),
    );
    const app = buildApp(nodeId);
    const res = await app.request("/api/box/retire", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
  });

  it("409 node.retire_not_fenced for an authenticated manager on a serving node", async () => {
    // This node is serving-primary (not fenced), so retireSelf refuses BEFORE any mint. Proves the auth
    // gate passes and the STATUS map maps the refusal to 409 (an unmapped AppError would be 400).
    await writeNodeMembership(
      suite.db,
      membershipDoc(5, [{ nodeId, contactUrl: "", standing: "serving-primary" }]),
    );
    const app = buildApp(nodeId);
    const res = await app.request("/api/box/retire", {
      method: "POST",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "node.retire_not_fenced" } });
  });

  it("200 evicts a fenced node with a carrier and flips self to evicted", async () => {
    // A held term-5 chart marking THIS node sell-only (the fence) AND the carrier serving-primary —
    // retireSelf mints the eviction and persists it term-guarded.
    await writeNodeMembership(
      suite.db,
      membershipDoc(5, [
        { nodeId, contactUrl: "", standing: "sell-only" },
        { nodeId: CARRIER_NODE_ID, contactUrl: "https://carrier", standing: "serving-primary" },
      ]),
    );
    const app = buildApp(nodeId);
    const res = await app.request("/api/box/retire", {
      method: "POST",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ evicted: true, term: 6 }); // held term 5 → minted 6

    // The persist landed: self now reads `evicted` in the held chart.
    const held = await readNodeMembership(suite.db);
    const self = held!.body.nodes.find((n) => n.nodeId === nodeId);
    expect(self?.standing).toBe("evicted");
  });
});
