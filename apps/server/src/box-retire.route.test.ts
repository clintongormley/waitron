import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, readNodeMembership, withTenant, writeNodeMembership } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import type { MembershipNode, SignedMembershipDocument } from "@waitron/membership";
import type { DrainProgress } from "@waitron/sync";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mountBoxRetireApi } from "./box-retire.js";
import { mountManagementApi } from "./management-api.js";

// Exercise route authorization, refusal-to-status mapping and success responses on PostgreSQL.
// Retirement semantics are covered by retire.test.ts.
const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // ≥ MIN_PASSWORD_LENGTH; the seeded manager's dashboard password.
const MANAGER_EMAIL = "manager@x.com";

// The box key ring that seals this node's identity private key (node-identity/promote pattern):
// deterministic so the sealed key round-trips within the suite, and the same key the mint unseals.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The carrier a fenced node drains onto — named `serving-primary` in the held chart so a fenced self
// document has a carrier (the happy-path shape retireSelf accepts).
const CARRIER_NODE_ID = "88888888-8888-4888-8888-888888888888";

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the same per-suite counter the sibling suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(72_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Provision a venue as owner and seed the people and sessions this route fixture needs. */
async function setupTenant(): Promise<{ tenantId: string; nodeId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
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
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );

  await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    await tx.execute(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (${venue.tenantId}, 'The Manager', ${MANAGER_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')`);
  });
  return { tenantId: venue.tenantId, nodeId: venue.nodeId };
}

/** A Hono app carrying the management API (for its login route) plus the box-retire route under test.
 * Both surfaces share the owner db + tenant, so a cookie minted on one resolves on the other. */
function buildApp(
  tenantId: string,
  nodeId: string,
  readDrainProgress: (() => Promise<DrainProgress>) | undefined,
  // The boot carrier retireSelf checks the fresh held chart against; matches the seeded serving-primary
  // on the happy path, `undefined` (bound to `readDrainProgress`) on the refusal-before-carrier paths.
  carrierNodeId: string | undefined = undefined,
): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId, nodeId },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    () => {},
  );
  mountBoxRetireApi(
    app,
    { appDb: suite.admin, ring: RING, tenantId, nodeId, readDrainProgress, carrierNodeId },
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

describe("POST /api/box/retire (real postgres)", () => {
  let tenantId: string;
  let nodeId: string;
  let managerCookie: string;

  beforeAll(async () => {
    ({ tenantId, nodeId } = await setupTenant());
    // Establish the node identity so the mint on the happy path has a key to sign with; harmless to
    // the refusal paths, which return before any mint.
    await establishNodeIdentity({ ownerDb: suite.admin, ring: RING }, tenantId, nodeId);
    managerCookie = await login(buildApp(tenantId, nodeId, undefined), MANAGER_EMAIL);
  });

  it("401s without a management session", async () => {
    // A serving-primary self-doc so nothing about the state matters — the gate 401s before any DB work.
    await writeNodeMembership(
      suite.admin,
      membershipDoc(5, [{ nodeId, contactUrl: "", standing: "serving-primary" }]),
    );
    const app = buildApp(tenantId, nodeId, undefined);
    const res = await app.request("/api/box/retire", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
  });

  it("409 node.retire_not_fenced for an authenticated manager on a serving node", async () => {
    // This node is serving-primary (not fenced), so retireSelf refuses BEFORE any mint. Proves the auth
    // gate passes and the STATUS map maps the refusal to 409 (an unmapped AppError would be 400).
    await writeNodeMembership(
      suite.admin,
      membershipDoc(5, [{ nodeId, contactUrl: "", standing: "serving-primary" }]),
    );
    const app = buildApp(tenantId, nodeId, undefined);
    const res = await app.request("/api/box/retire", {
      method: "POST",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "node.retire_not_fenced" } });
  });

  it("200 evicts a fully-drained fenced node and flips self to evicted", async () => {
    // A held term-5 chart marking THIS node sell-only (the fence) AND the carrier serving-primary. With
    // an injected `drained:true` progress, retireSelf mints the eviction and persists it term-guarded.
    await writeNodeMembership(
      suite.admin,
      membershipDoc(5, [
        { nodeId, contactUrl: "", standing: "sell-only" },
        { nodeId: CARRIER_NODE_ID, contactUrl: "https://carrier", standing: "serving-primary" },
      ]),
    );
    const app = buildApp(
      tenantId,
      nodeId,
      () => Promise.resolve({ drained: true, ownTailSeq: 5n, carrierAppliedSeq: 5n }),
      CARRIER_NODE_ID, // the boot carrier matches the held serving-primary → freshness guard passes
    );
    const res = await app.request("/api/box/retire", {
      method: "POST",
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ evicted: true, term: 6 }); // held term 5 → minted 6

    // The persist landed: self now reads `evicted` in the held chart.
    const held = await readNodeMembership(suite.admin);
    const self = held!.body.nodes.find((n) => n.nodeId === nodeId);
    expect(self?.standing).toBe("evicted");
  });
});
