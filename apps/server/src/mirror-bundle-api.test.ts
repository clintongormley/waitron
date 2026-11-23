import { fixturePasswordHash, fixturePinHash } from "./testing/known-secret-hashes.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  nodes,
  readMembershipTrustSet,
  readNodeMembership,
  stampDeployment,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  loadKeyRing,
  readPairSecret,
  setPairLinkStateTx,
  writePairLinkTx,
  type KeyRing,
} from "@waitron/credentials";
import { personIdForLoginEmail } from "@waitron/identity";
import {
  canonicalize,
  endorseKey,
  generateNodeKeyPair,
  MAX_NODES,
  signDocumentBody,
  verifyBytes,
  verifyEndorsement,
  verifyMembershipDocument,
  type MembershipDocumentBody,
  type MembershipNode,
  type NodeKeyPair,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { readPairLink } from "@waitron/node-db";
import { planVenue, type AdoptResult } from "@waitron/provisioning";
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { fiscalReservations } from "@waitron/fiscal-verifactu/src/schema/reservations.js";
import { fiscalAllocations, verifactuIdentities } from "@waitron/fiscal-verifactu";
import type { WaitronModule } from "@waitron/module";
import { AppError, nodeId } from "@waitron/shared";
import {
  standbyContract,
  allocatedStandbyModules,
  prepareStandbyDatabase,
  takenOverSeries,
  withoutActivationMark,
} from "./testing/allocated-contract.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { writeStreamSettings } from "./stream-host.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { clearRemovedMachine, removeStandby } from "./membership-removal.js";
import { boxHostnameFor } from "./box-name.js";
import { holdRecoveryKey } from "./testing/recovery-key.js";
import {
  approveJoin,
  joinAsBundleAnswer,
  joiningBox,
  listedJoin,
  mountBoxJoin,
  pollJoin,
  signedInCookie,
} from "./testing/box-join.js";
import { createBoxJoinRequests, ENDED_KEPT_MS } from "./box-join-requests.js";
import { replaceBackupSettings } from "./backup-env-writer.js";
import { MIN_RECOVERY_KEY_LENGTH } from "./backup-config.js";

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  return { ...actual, ALL_MODULES: [...actual.ALL_MODULES] };
});

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

// Pause points for the cases that land a removal part-way through a request. Each runs once and
// clears itself; unset, the wrapped function behaves as the real one.
const pause = vi.hoisted(() => ({
  beforeModuleConfigRead: undefined as (() => Promise<void>) | undefined,
  beforeChartMint: undefined as (() => Promise<void>) | undefined,
  beforeReserve: undefined as (() => Promise<void>) | undefined,
  moduleConfigReads: 0,
}));

vi.mock("./module-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./module-config.js")>();
  return {
    ...actual,
    readModuleConfig: async (db: Parameters<typeof actual.readModuleConfig>[0]) => {
      pause.moduleConfigReads += 1;
      const hook = pause.beforeModuleConfigRead;
      pause.beforeModuleConfigRead = undefined;
      await hook?.();
      return actual.readModuleConfig(db);
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
const ADMIN_EMAIL = "owner@example.test";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// A real key, so the endorsement's signature can be verified and the joining box can sign.
const STANDBY_KEYS = generateNodeKeyPair();
const STANDBY_PUB = STANDBY_KEYS.publicKey;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const spare = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(81_000_000 + nifCounter).padStart(8, "0")}K`;
}

let stateDir: string;
let db: Database;
// The main box's own key pair, set by `setupVenue`, so each chart it holds is one it signed.
let primaryKeyPair: NodeKeyPair;
const fixtureBoxNames = new Set<string>();

function unusedFixtureNodeId(): string {
  let id = crypto.randomUUID();
  while (fixtureBoxNames.has(boxHostnameFor(id))) id = crypto.randomUUID();
  fixtureBoxNames.add(boxHostnameFor(id));
  return id;
}

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
        name: "Sala principal",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "FA",
        fullSeriesCode: "FF",
        correctiveSeriesCode: "RF",
        fullCorrectiveSeriesCode: "RFF",
        admin: {
          displayName: "Administrator",
          pinHash: fixturePinHash("1234"),
          passwordHash: fixturePasswordHash(ADMIN_PASSWORD),
          email: ADMIN_EMAIL,
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const designated: AdoptResult = {
    nodeId: venue.nodeId,
  };
  fixtureBoxNames.add(boxHostnameFor(designated.nodeId));
  await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, designated.nodeId);
  const primaryPublicKey = (await readMembershipTrustSet(db))[designated.nodeId]!;
  primaryKeyPair = {
    publicKey: primaryPublicKey,
    privateKey: await readNodeIdentityKey(suite.node, RING, designated.nodeId),
  };
  const adminPersonId = await withTransaction(db, async (tx) => {
    const r = await tx.execute<{ id: string }>(
      sql`select id from persons where email = 'owner@example.test'`,
    );
    return r.rows[0]!.id;
  });
  return { designated, adminPersonId, primaryPublicKey };
}

/**
 * The join store's own clock. Each join in this suite stands alone, so the next arrives once the
 * main box has forgotten the last approval, which otherwise holds back a second for 2 minutes.
 */
let joinClock = 0;

function mountApp(
  designated: AdoptResult,
  log?: Logger,
  advertisedOrigin = "https://box.deli.test",
  now?: () => Date,
  wakeSpareJoin: () => void = () => {},
): Hono {
  const app = new Hono();
  mountBoxJoin(app, {
    requests: createBoxJoinRequests({ steadyNow: () => joinClock }),
    appDb: db,
    node: suite.node,
    ring: RING,
    stateDir,
    boxHostname: "waitron.local",
    advertisedOrigin,
    designated,
    wakeSpareJoin,
    now,
    log,
  });
  return app;
}

function validStandby(): {
  standbyNodeId: string;
  standbyPublicKey: string;
  standbyContactUrl: string;
  standbyStoreUrl: string;
  standbyAt: number;
} {
  return {
    standbyNodeId: unusedFixtureNodeId(),
    standbyPublicKey: STANDBY_PUB,
    standbyContactUrl: "https://cloud.deli.test",
    standbyStoreUrl: "https://cloud.deli.test:7443",
    standbyAt: Date.now(),
  };
}

let outsideReservations: unknown[] = [];
async function allocationSnapshot() {
  return {
    allocations: await db.select().from(fiscalAllocations),
    reservations: await db.select().from(fiscalReservations),
    identities: await db.select().from(verifactuIdentities),
    series: await db.select().from(invoiceSeries),
    outsideReservations: structuredClone(outsideReservations),
  };
}

async function removalRows(): Promise<Record<string, unknown>[]> {
  const { rows } = await db.execute<Record<string, unknown>>(
    sql`select subject_id as removed_node_id, json_extract(data, '$.term') as term from activity_log where kind = 'membership.node_removed' order by at, rowid`,
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
    signedMembershipDoc(term, {
      signerNodeId: designated.nodeId,
      keyPair: primaryKeyPair,
      nodes: members,
    }),
  );
  return term;
}

// The fiscal module joins as an unmarked stand-in unless `veriFactu` is set, so the join's
// reservation path, which a module whose series open on activation never takes, stays reachable.
async function withFixtureOperation(
  request: Record<string, unknown>,
  veriFactu: boolean,
  send: (moduleOperation: unknown) => Promise<Response>,
): Promise<Response> {
  if (
    request.moduleOperation !== undefined ||
    typeof request.standbyNodeId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(request.standbyNodeId) ||
    typeof request.email !== "string"
  )
    return send(request.moduleOperation);
  const primary = (await db.select().from(nodes))[0]!;
  const fixture = await standbyContract(
    db,
    { nodeId: nodeId(primary.id) },
    request.standbyNodeId,
    [
      { code: "FA", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "RF", purpose: "corrective" },
      { code: "RFF", purpose: "full_corrective" },
    ],
    await personIdForLoginEmail(db, request.email),
  );
  const held = fixture.request("reserve");
  const original = [...ALL_MODULES];
  const allocated = allocatedStandbyModules(original, fixture).map((module) => {
    if (module.name !== "fiscal-verifactu") return module;
    const standby = module.provisioning!.standby!;
    return {
      ...module,
      provisioning: {
        ...module.provisioning,
        standby: {
          ...standby,
          async reserve(...args: Parameters<typeof standby.reserve>) {
            const hook = pause.beforeReserve;
            pause.beforeReserve = undefined;
            await hook?.();
            const result = await standby.reserve(...args);
            outsideReservations.push(structuredClone(fixture.state));
            return result;
          },
        },
      },
    };
  });
  (ALL_MODULES as WaitronModule[]).splice(
    0,
    ALL_MODULES.length,
    ...(veriFactu ? allocated : withoutActivationMark(allocated)),
  );
  try {
    return await send({ binding: held.binding, input: held.input });
  } finally {
    (ALL_MODULES as WaitronModule[]).splice(0, ALL_MODULES.length, ...original);
  }
}

let joinAddresses = 0;

/**
 * A join reaching `issueMirrorBundle` through the box-join routes: the spare named in `body` asks
 * from an address of its own and says Yes, and the person `body.email` names, signed in afresh,
 * approves.
 * Answers with the bundle or the refusal (`joinAsBundleAnswer`). `plain` sends no module
 * operation.
 */
async function approvedJoin(
  app: Hono,
  body: Record<string, unknown>,
  { veriFactu = false, plain = false }: { veriFactu?: boolean; plain?: boolean } = {},
): Promise<Response> {
  joinAddresses += 1;
  const box = joiningBox(`10.20.${Math.floor(joinAddresses / 250)}.${(joinAddresses % 250) + 1}`, {
    identity: {
      nodeId: body.standbyNodeId as string,
      publicKey: body.standbyPublicKey as string,
      privateKey:
        body.standbyPublicKey === STANDBY_PUB
          ? STANDBY_KEYS.privateKey
          : generateNodeKeyPair().privateKey,
    },
    contactUrl: body.standbyContactUrl as string,
    storeUrl: body.standbyStoreUrl as string,
  });
  const cookie = await signedInCookie(db, await personIdForLoginEmail(db, body.email as string));
  const send = (moduleOperation: unknown) =>
    joinAsBundleAnswer(app, {
      box,
      sent: { cookie },
      moduleOperation,
      at: body.standbyAt as number,
    });
  try {
    return await (plain ? send(undefined) : withFixtureOperation(body, veriFactu, send));
  } finally {
    joinClock += ENDED_KEPT_MS;
  }
}

beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-mirror-bundle-api-state-"));
  await mkdir(join(stateDir, "tls"), { recursive: true });
  const ca = mintSelfSignedServerCert({
    hostnames: ["waitron.local"],
    ipAddresses: [],
    now: new Date(),
  });
  await writeFile(join(stateDir, "tls", "ca.crt"), ca.caCertPem);
  await writeFile(join(stateDir, "tls", "ca.key"), ca.caKeyPem);
  await holdRecoveryKey(stateDir);

  db = suite.db;
}, 180_000);

// The per-test reset wipes the deployment stamp.
beforeEach(async () => {
  outsideReservations = [];
  fixtureBoxNames.clear();
  await stampDeployment(db, "preproduction");
});

afterEach(() => {
  pause.beforeModuleConfigRead = undefined;
  pause.beforeChartMint = undefined;
  pause.beforeReserve = undefined;
});

afterAll(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});

describe("issueMirrorBundle, through the box-join routes", () => {
  it("returns a bundle carrying the venue identity for a join an administrator approved", async () => {
    const { designated } = await setupVenue();
    const lines: string[] = [];
    const log: Logger = (level, event, fields) =>
      lines.push(JSON.stringify({ level, event, fields }));
    const app = mountApp(designated, log);

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      taxpayer: { country: string; taxId: string };
      primaryNode: { name: string };
      boxHostname: string;
    };
    expect(bundle.taxpayer.taxId).toMatch(/^\d{8}K$/);
    expect(bundle.primaryNode.name).toBe("Sala principal");
    expect(bundle.boxHostname).toBe("waitron.local");
    for (const line of lines) {
      expect(line).not.toContain(ADMIN_PASSWORD);
      expect(line).not.toContain(ADMIN_EMAIL);
    }
  });

  it.each([
    ["still names the venue's shared name", "https://waitron.local:8443"],
    ["already names its own address", undefined],
  ])(
    "the chart that adds a spare names both boxes by their own addresses (the signer's row %s)",
    async (_case, heldSignerUrl) => {
      const { designated } = await setupVenue();
      const ownUrl = `https://box-${designated.nodeId.slice(0, 4)}.waitron.local:8443`;
      const app = mountApp(designated, undefined, "https://waitron.local:8443");
      const standbyNodeId = crypto.randomUUID();
      const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
      await writeNodeMembership(
        db,
        signedMembershipDoc(seedTerm, {
          signerNodeId: designated.nodeId,
          keyPair: primaryKeyPair,
          nodes: [
            {
              nodeId: designated.nodeId,
              contactUrl: heldSignerUrl ?? ownUrl,
              standing: "serving-primary",
            },
          ],
        }),
      );

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        standbyNodeId,
        standbyPublicKey: STANDBY_PUB,
        standbyContactUrl: `https://box-${standbyNodeId.slice(0, 4)}.waitron.local:8443`,
        standbyStoreUrl: `https://box-${standbyNodeId.slice(0, 4)}.waitron.local:7443`,
        standbyAt: Date.now(),
      });
      expect(res.status).toBe(200);

      expect((await readNodeMembership(db))?.body.nodes).toEqual([
        { nodeId: designated.nodeId, contactUrl: ownUrl, standing: "serving-primary" },
        {
          nodeId: standbyNodeId,
          contactUrl: `https://box-${standbyNodeId.slice(0, 4)}.waitron.local:8443`,
          standing: "serving-secondary",
        },
      ]);
    },
  );

  it("answers 409 mirror.not_provisioned when this box's database carries no deployment stamp", async () => {
    const { designated } = await setupVenue();
    await db.execute(sql`delete from deployment where id = 1`);
    const res = await approvedJoin(mountApp(designated), {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "mirror.not_provisioned", params: {} } });
  });

  it("answers 500 module.config_invalid when this box's stored module settings are broken", async () => {
    const { designated } = await setupVenue();
    await db.execute(
      sql`insert into settings (module, version, revision, doc, updated_at) values ('modules', 1, 1, '{"modules":{"bookings":"yes"}}', '2026-11-20T12:00:00.000Z') on conflict (module) do update set doc = excluded.doc`,
    );
    const res = await approvedJoin(mountApp(designated), {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "module.config_invalid" } });
  });

  it("reads module settings once for a join", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    pause.moduleConfigReads = 0;

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });

    expect(res.status).toBe(200);
    expect(pause.moduleConfigReads).toBe(1);
  });

  it("appends the standby to the membership document with its contactUrl, term bumped, signed by the primary", async () => {
    const { designated, primaryPublicKey } = await setupVenue();
    const app = mountApp(designated);
    const standbyNodeId = crypto.randomUUID();

    // The survival assertions below mean something only over a non-empty held chart.
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    await writeNodeMembership(
      db,
      signedMembershipDoc(seedTerm, {
        signerNodeId: designated.nodeId,
        keyPair: primaryKeyPair,
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

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      standbyNodeId,
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "https://cloud.deli.test",
      standbyStoreUrl: "https://cloud.deli.test:7443",
      standbyAt: Date.now(),
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
    expect(after?.endorsements).toEqual([
      expect.objectContaining({
        nodeId: standbyNodeId,
        publicKey: STANDBY_PUB,
        endorsedBy: designated.nodeId,
      }),
    ]);
    expect(verifyEndorsement(after!.endorsements[0]!, primaryPublicKey)).toBe(true);
    expect(verifyMembershipDocument(after!, { [designated.nodeId]: primaryPublicKey }).valid).toBe(
      true,
    );

    // A re-adopt of the same node refreshes its entry in place rather than adding a second.
    const res2 = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      standbyNodeId,
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "https://cloud2.deli.test",
      standbyStoreUrl: "https://cloud2.deli.test:7443",
      standbyAt: Date.now(),
    });
    expect(res2.status).toBe(200);

    const afterReadopt = await readNodeMembership(db);
    expect(afterReadopt?.body.term).toBe(after!.body.term + 1);
    expect(afterReadopt?.endorsements).toEqual(after!.endorsements);
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
    const { designated, primaryPublicKey } = await setupVenue();
    const endorserNodeId = crypto.randomUUID();
    const endorser = generateNodeKeyPair();
    const endorsement = endorseKey(
      designated.nodeId,
      primaryPublicKey,
      endorserNodeId,
      endorser.privateKey,
    );
    await db.update(nodes).set({ endorsement }).where(eq(nodes.id, designated.nodeId));
    const app = mountApp(designated);

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });
    expect(res.status).toBe(200);

    const after = (await readNodeMembership(db))!;
    expect(after.endorsements).toEqual([
      expect.objectContaining({ publicKey: STANDBY_PUB, endorsedBy: designated.nodeId }),
      endorsement,
    ]);
    const byEndorser = verifyMembershipDocument(after, { [endorserNodeId]: endorser.publicKey });
    expect(byEndorser.valid ? "valid" : byEndorser.reason).toBe("valid");
    const direct = verifyMembershipDocument(after, { [designated.nodeId]: primaryPublicKey });
    expect(direct.valid ? "valid" : direct.reason).toBe("valid");
  });

  it("signs a retried chart write with the endorsement stored when that round reads, not the first round's", async () => {
    const { designated, primaryPublicKey } = await setupVenue();
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
        keyPair: primaryKeyPair,
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
      const app = mountApp(designated);
      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });
      expect(res.status).toBe(200);
    } finally {
      await db.execute(sql.raw("drop trigger test_node_membership_endorsement_moves"));
    }

    const after = (await readNodeMembership(db))!;
    expect(after.body.term).toBe(seedTerm + 1);
    expect(after.endorsements).toEqual([
      expect.objectContaining({ publicKey: STANDBY_PUB, endorsedBy: designated.nodeId }),
      newEndorsement,
    ]);
    const byNewEndorser = verifyMembershipDocument(after, {
      [newEndorserNodeId]: newEndorser.publicKey,
    });
    expect(byNewEndorser.valid ? "valid" : byNewEndorser.reason).toBe("valid");
  });

  it("gives up with 503 membership.write_contended when every chart write loses its term guard", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    await writeNodeMembership(
      db,
      signedMembershipDoc(seedTerm, {
        signerNodeId: designated.nodeId,
        keyPair: primaryKeyPair,
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
      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
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

  it("reserves once when a join is sent again after membership.write_contended", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const seedTerm = await holdChartWithStandby(designated, crypto.randomUUID());
    const standby = validStandby();
    await db.execute(
      sql.raw(
        "create trigger test_node_membership_contended before update on node_membership begin select raise(ignore); end",
      ),
    );
    try {
      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...standby,
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: { code: "membership.write_contended", params: { attempts: 8 } },
      });
    } finally {
      await db.execute(sql.raw("drop trigger test_node_membership_contended"));
    }
    expect(outsideReservations).toEqual([]);

    const again = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...standby,
    });

    expect(again.status, JSON.stringify(await again.clone().json())).toBe(200);
    expect(outsideReservations).toHaveLength(1);
    expect((await readNodeMembership(db))?.body.term).toBe(seedTerm + 1);
  });

  it("lists nothing in the chart when a module's reserve refuses", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const seedTerm = await holdChartWithStandby(designated, crypto.randomUUID());
    pause.beforeReserve = async () => {
      // The chart round has already written its term in this transaction.
      expect((await readNodeMembership(db))?.body.term).toBe(seedTerm + 1);
      throw new AppError("mirror.not_provisioned", {});
    };

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });

    expect(pause.beforeReserve).toBeUndefined();
    expect(res.status).toBe(409);
    expect((await readNodeMembership(db))?.body.term).toBe(seedTerm);
    expect(await readPairLink(suite.node, designated.nodeId)).toBeNull();
  });

  it("accepts a Veri*Factu venue's join with no module operation, reserving nothing fiscal", async () => {
    const { designated } = await setupVenue();
    const warnings: { event: string; fields: Record<string, unknown> | undefined }[] = [];
    const log: Logger = (level, event, fields) => {
      if (level === "warn") warnings.push({ event, fields });
    };
    const app = mountApp(designated, log);
    const before = await allocationSnapshot();
    const standby = validStandby();

    const res = await approvedJoin(app, { email: ADMIN_EMAIL, ...standby }, { plain: true });

    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const reserved = (await res.json()).reservedIdentity;
    expect({ modules: reserved.modules, series: reserved.series }).toEqual({
      modules: {},
      series: [],
    });
    expect(warnings).toEqual([]);
    expect(await allocationSnapshot()).toEqual(before);
    expect((await readNodeMembership(db))?.body.nodes.map((node) => node.nodeId)).toContain(
      standby.standbyNodeId,
    );
  });

  it("reserves nothing fiscal at a Veri*Factu venue's join that carries a reserve operation", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const before = await allocationSnapshot();

    const res = await approvedJoin(
      app,
      { email: ADMIN_EMAIL, ...validStandby() },
      { veriFactu: true },
    );

    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const reserved = (await res.json()).reservedIdentity;
    expect({ modules: reserved.modules, series: reserved.series }).toEqual({
      modules: {},
      series: [],
    });
    expect(await allocationSnapshot()).toEqual(before);
  });

  describe("the pair's store and its key", () => {
    it("hands out a bundle with no relay, carrying the main box's address and the pair's key", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      const bundle = (await res.json()) as {
        primaryUrl: string;
        store: { accessKeyId: string; secretAccessKey: string; venueId: string };
      };
      expect(bundle.primaryUrl).toBe("https://box.deli.test");
      expect(bundle.store.accessKeyId).toMatch(/^waitron[0-9a-f]{16}$/);
      expect(bundle.store.secretAccessKey).toMatch(/^[0-9a-f]{64}$/);
      expect(bundle.store.venueId).not.toBe("");
      const link = await readPairLink(suite.node, designated.nodeId);
      expect(link).toMatchObject({
        accessKeyId: bundle.store.accessKeyId,
        venueId: bundle.store.venueId,
      });
      expect(await readPairSecret(suite.node, RING, designated.nodeId)).toBe(
        bundle.store.secretAccessKey,
      );
    });

    it("a second join mints a new key", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const keys: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const res = await approvedJoin(app, {
          email: ADMIN_EMAIL,
          ...validStandby(),
        });
        expect(res.status).toBe(200);
        const { store } = (await res.json()) as {
          store: { accessKeyId: string; secretAccessKey: string };
        };
        keys.push(store.accessKeyId, store.secretAccessKey);
      }
      expect(new Set(keys).size).toBe(4);
    });

    it("writes a pending pair link naming the store address the spare sent", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const standby = validStandby();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...standby,
      });

      expect(res.status).toBe(200);
      expect(await readPairLink(suite.node, designated.nodeId)).toMatchObject({
        role: "streams",
        state: "pending",
        peerNodeId: standby.standbyNodeId,
        peerPublicKey: standby.standbyPublicKey,
        storeUrl: "https://cloud.deli.test:7443",
      });
    });

    it("wakes the spare join once its pending link has committed, and not for a refused join", async () => {
      const { designated } = await setupVenue();
      const seen: Promise<string | undefined>[] = [];
      const app = mountApp(designated, undefined, undefined, undefined, () =>
        seen.push(readPairLink(suite.node, designated.nodeId).then((link) => link?.state)),
      );

      const refused = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
        standbyStoreUrl: "http://cloud.deli.test:7443",
      });
      expect(refused.status).toBe(400);
      expect(seen).toHaveLength(0);

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });
      expect(res.status).toBe(200);
      expect(await Promise.all(seen)).toEqual(["pending"]);
    });

    it.each([
      ["at another host than the spare's contact address", "https://other.deli.test:7443"],
      ["over plain http", "http://cloud.deli.test:7443"],
      ["with a path", "https://cloud.deli.test:7443/"],
      ["missing", undefined],
      ["not a string", 7443],
    ])("refuses a store address %s as mirror.standby_invalid", async (_kind, standbyStoreUrl) => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const before = await allocationSnapshot();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
        standbyStoreUrl,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: "mirror.standby_invalid", params: {} } });
      expect(await allocationSnapshot()).toEqual(before);
      expect(await readPairLink(suite.node, designated.nodeId)).toBeNull();
    });

    const joinedLink = () => ({
      role: "streams" as const,
      state: "pending" as const,
      peerNodeId: crypto.randomUUID(),
      peerPublicKey: STANDBY_PUB,
      storeUrl: "https://box-0000.waitron.local:7443",
      venueId: "joined-venue",
      accessKeyId: "waitron0000000000000000",
      secretAccessKey: "joined-secret",
    });

    it("refuses a join whose link another spare's became streaming before its link check, changing neither the chart nor any reservation", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const joined = joinedLink();
      await holdChartWithStandby(designated, joined.peerNodeId);
      const before = {
        chart: await readNodeMembership(db),
        allocation: await allocationSnapshot(),
      };
      // After the request's early refusals and before its reservation: another spare's join
      // finishes and its link is marked streaming.
      pause.beforeModuleConfigRead = async () => {
        await withNodeTransaction(suite.node, async (tx) => {
          await writePairLinkTx(tx, RING, designated.nodeId, joined);
          await setPairLinkStateTx(tx, designated.nodeId, "streaming");
        });
      };

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(pause.beforeModuleConfigRead).toBeUndefined();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.spare_already_joined", params: {} },
      });
      expect({
        chart: await readNodeMembership(db),
        allocation: await allocationSnapshot(),
      }).toEqual(before);
      expect(await readPairLink(suite.node, designated.nodeId)).toMatchObject({
        state: "streaming",
        peerNodeId: joined.peerNodeId,
        storeUrl: joined.storeUrl,
        accessKeyId: joined.accessKeyId,
      });
      expect(await readPairSecret(suite.node, RING, designated.nodeId)).toBe("joined-secret");
    });

    it("holds node.db's write lock from its link check to its link write, so a link marked streaming meanwhile waits and the join is never refused after listing its spare", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const joined = joinedLink();
      // Run from the test's own context, not the request's, so the write queues as another
      // caller's would rather than being refused as the request re-entering its own lock.
      const outsideTheRequest = AsyncLocalStorage.snapshot();
      let marked: Promise<void> | undefined;
      let markedDuringChartWrite: boolean | undefined;
      pause.beforeChartMint = async () => {
        let done = false;
        marked = outsideTheRequest(() =>
          withNodeTransaction(suite.node, async (tx) => {
            await writePairLinkTx(tx, RING, designated.nodeId, joined);
            await setPairLinkStateTx(tx, designated.nodeId, "streaming");
          }),
        ).then(() => {
          done = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        markedDuringChartWrite = done;
      };
      const standby = validStandby();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...standby,
      });

      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      expect(markedDuringChartWrite).toBe(false);
      await marked;
      expect(
        (await readNodeMembership(db))?.body.nodes.map((n) => [n.nodeId, n.standing]),
      ).toContainEqual([standby.standbyNodeId, "serving-secondary"]);
      expect(await readPairLink(suite.node, designated.nodeId)).toMatchObject({
        state: "streaming",
        peerNodeId: joined.peerNodeId,
      });
    });

    /** Holds a chart where the streaming link's peer stands as `peer`, and that link. */
    async function holdRetiredLink(
      designated: AdoptResult,
      peer: "evicted" | "revoked" | "unlisted",
    ) {
      const joined = joinedLink();
      const nodes: MembershipNode[] = [
        {
          nodeId: designated.nodeId,
          contactUrl: "https://box.deli.test",
          standing: "serving-primary",
        },
      ];
      if (peer === "evicted")
        nodes.push({
          nodeId: joined.peerNodeId,
          contactUrl: "https://cloud.deli.test",
          standing: peer,
        });
      await writeNodeMembership(
        db,
        signedMembershipDoc(((await readNodeMembership(db))?.body.term ?? -1) + 1, {
          signerNodeId: designated.nodeId,
          keyPair: primaryKeyPair,
          nodes,
          ...(peer === "revoked" ? { revoked: [joined.peerNodeId] } : {}),
        }),
      );
      await withNodeTransaction(suite.node, async (tx) => {
        await writePairLinkTx(tx, RING, designated.nodeId, joined);
        await setPairLinkStateTx(tx, designated.nodeId, "streaming");
      });
      return joined;
    }

    it.each(["evicted", "revoked"] as const)(
      "admits a replacement over the streaming link of a spare the chart lists %s, writing the new spare's link",
      async (peer) => {
        const { designated } = await setupVenue();
        const app = mountApp(designated);
        await holdRetiredLink(designated, peer);
        const standby = validStandby();

        const res = await approvedJoin(app, {
          email: ADMIN_EMAIL,
          ...standby,
        });

        expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
        expect(await readPairLink(suite.node, designated.nodeId)).toMatchObject({
          state: "pending",
          peerNodeId: standby.standbyNodeId,
        });
      },
    );

    it("refuses 409 mirror.spare_already_joined over the streaming link of a spare the chart does not list, leaving the link", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const joined = await holdRetiredLink(designated, "unlisted");

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.spare_already_joined", params: {} },
      });
      expect(await readPairLink(suite.node, designated.nodeId)).toMatchObject({
        state: "streaming",
        peerNodeId: joined.peerNodeId,
      });
    });
  });

  it("returns a signed dormant allocation and a valid endorsement, activating every purpose at takeover", async () => {
    const { designated, adminPersonId, primaryPublicKey } = await setupVenue();
    const app = mountApp(designated);
    const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };

    const { res, fixture } = await allocatedReply(app, designated, adminPersonId, {
      email: ADMIN_EMAIL,
      standbyNodeId: standby.nodeId,
      standbyPublicKey: standby.publicKey,
      standbyContactUrl: "https://cloud.deli.test",
      standbyStoreUrl: "https://cloud.deli.test:7443",
      standbyAt: Date.now(),
    });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      reservedIdentity: {
        modules: { "fiscal-verifactu": typeof fixture.state };
        series: { code: string; purpose: string }[];
        endorsement: { nodeId: string; publicKey: string; endorsedBy: string; signature: string };
      };
    };
    const r = bundle.reservedIdentity;
    const fiscal = r.modules["fiscal-verifactu"];
    const allocation = fiscal.evidence.block.payload.allocations[0]!;
    expect(allocation.installationIdentity).toBe("P000042");
    expect(typeof allocation.taxpayerNif).toBe("string");
    expect(allocation.softwareId).toBe("W1");
    expect(fiscal).toEqual(fixture.state);
    expect(r.series).toEqual([]);
    expect(allocation.series).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "RF-P000042", purpose: "corrective" },
      { code: "RFF-P000042", purpose: "full_corrective" },
    ]);
    const byCode = new Map(allocation.series.map((s) => [s.code, s.purpose]));
    expect(byCode.get("FA-P000042")).toBe("standard");
    expect(byCode.get("FF-P000042")).toBe("full");
    expect(byCode.get("RF-P000042")).toBe("corrective");
    const primary = {
      nodeId: nodeId(designated.nodeId),
    };
    await prepareStandbyDatabase(db, spare.db, primary);
    expect(await takenOverSeries(spare.db, standby.nodeId, fixture, fiscal)).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "RF-P000042", purpose: "corrective" },
      { code: "RFF-P000042", purpose: "full_corrective" },
    ]);
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
    const { designated } = await setupVenue();
    const app = mountApp(designated);

    const res = await approvedJoin(app, { email: ADMIN_EMAIL });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("mirror.standby_invalid");

    // Every field but the one under test is well-formed; `""` is a valid contact URL.
    const res2 = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      standbyNodeId: "not-a-uuid",
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "",
      standbyAt: Date.now(),
    });
    expect(res2.status).toBe(400);
    expect((await res2.json()).error.code).toBe("mirror.standby_invalid");

    const res3 = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: "",
      standbyContactUrl: "",
      standbyAt: Date.now(),
    });
    expect(res3.status).toBe(400);
    expect((await res3.json()).error.code).toBe("mirror.standby_invalid");
  });

  it("refuses a standbyContactUrl that is not a bare origin as mirror.standby_invalid", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);

    // Not a bare origin: tills concatenate paths onto it.
    const slash = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "https://cloud.deli.test/",
      standbyAt: Date.now(),
    });
    expect(slash.status).toBe(400);
    expect(await slash.json()).toEqual({ error: { code: "mirror.standby_invalid", params: {} } });

    const script = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: "javascript:alert(1)",
      standbyAt: Date.now(),
    });
    expect(script.status).toBe(400);
    expect((await script.json()).error.code).toBe("mirror.standby_invalid");
  });

  it("refuses an empty standbyContactUrl, which leaves the store address no host to match", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const before = await readNodeMembership(db);

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
      standbyContactUrl: "",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "mirror.standby_invalid", params: {} } });
    expect(await readNodeMembership(db)).toEqual(before);
  });

  it("refuses a standby id the held chart lists as evicted with 409 mirror.standby_removed, before reserving anything", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const removedId = crypto.randomUUID();
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    await writeNodeMembership(
      db,
      signedMembershipDoc(seedTerm, {
        signerNodeId: designated.nodeId,
        keyPair: primaryKeyPair,
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
    const counterBefore = await allocationSnapshot();

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
      standbyNodeId: removedId,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "mirror.standby_removed", params: {} } });
    expect(await allocationSnapshot()).toEqual(counterBefore);
    expect(await readNodeMembership(db)).toEqual(chartBefore);

    // A fresh id through the same app reaches the signed outside reservation.
    const fresh = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });
    expect(fresh.status).toBe(200);
    expect(await allocationSnapshot()).not.toEqual(counterBefore);
  });

  it("refuses a standby id the held chart has cleared (revoked) with 409 mirror.standby_removed, before reserving anything", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const clearedId = crypto.randomUUID();
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    await writeNodeMembership(
      db,
      signedMembershipDoc(seedTerm, {
        signerNodeId: designated.nodeId,
        keyPair: primaryKeyPair,
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
    const counterBefore = await allocationSnapshot();

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
      standbyNodeId: clearedId,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "mirror.standby_removed", params: {} } });
    expect(await allocationSnapshot()).toEqual(counterBefore);
    expect(await readNodeMembership(db)).toEqual(chartBefore);
  });

  it("refuses 409 membership.revoked_duplicate when the held chart's revoked list names a machine twice, so no chart can be minted", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    await writeNodeMembership(
      db,
      signedMembershipDoc(seedTerm, {
        signerNodeId: designated.nodeId,
        keyPair: primaryKeyPair,
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
    const counterBefore = await allocationSnapshot();

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "membership.revoked_duplicate", params: { nodeId: "gone" } },
    });
    expect(await readNodeMembership(db)).toEqual(chartBefore);
    expect(await allocationSnapshot()).toEqual(counterBefore);
  });

  describe("refusals before anything is reserved", () => {
    // Reservations and the chart, before and after: a refused join changes neither.
    async function reservedAndListed() {
      return { allocation: await allocationSnapshot(), chart: await readNodeMembership(db) };
    }

    async function writePairLink(designated: AdoptResult, state: "pending" | "streaming") {
      await withNodeTransaction(suite.node, async (tx) => {
        await writePairLinkTx(tx, RING, designated.nodeId, {
          role: "streams",
          state: "pending",
          peerNodeId: crypto.randomUUID(),
          peerPublicKey: STANDBY_PUB,
          storeUrl: "https://box-0000.waitron.local:7443",
          venueId: "venue",
          accessKeyId: "pair-access-key",
          secretAccessKey: "pair-secret-key",
        });
        if (state !== "pending") await setPairLinkStateTx(tx, designated.nodeId, state);
      });
    }

    describe("this box's recovery key", () => {
      afterEach(async () => {
        await holdRecoveryKey(stateDir);
      });

      it("refuses a join while this box holds no recovery key, reserving nothing and listing nobody", async () => {
        const { designated } = await setupVenue();
        const app = mountApp(designated);
        await replaceBackupSettings(stateDir, null);
        const before = await reservedAndListed();

        const res = await approvedJoin(app, {
          email: ADMIN_EMAIL,
          ...validStandby(),
        });

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
          error: { code: "backup.recovery_key_missing", params: {} },
        });
        expect(await reservedAndListed()).toEqual(before);
        expect(await readPairLink(suite.node, designated.nodeId)).toBeNull();
      });

      it("a key under the length floor is refused the same way", async () => {
        const { designated } = await setupVenue();
        const app = mountApp(designated);
        await holdRecoveryKey(stateDir, "k".repeat(MIN_RECOVERY_KEY_LENGTH - 1));
        const before = await reservedAndListed();

        const res = await approvedJoin(app, {
          email: ADMIN_EMAIL,
          ...validStandby(),
        });

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
          error: { code: "backup.recovery_key_missing", params: {} },
        });
        expect(await reservedAndListed()).toEqual(before);
      });

      it("a key in backup.env lets the join through", async () => {
        const { designated } = await setupVenue();
        const app = mountApp(designated);
        await holdRecoveryKey(stateDir, "k".repeat(MIN_RECOVERY_KEY_LENGTH));

        const res = await approvedJoin(app, {
          email: ADMIN_EMAIL,
          ...validStandby(),
        });

        expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      });
    });

    it("refuses a second spare while one is joined, reserving nothing", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      await writePairLink(designated, "streaming");
      const before = await reservedAndListed();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.spare_already_joined", params: {} },
      });
      expect(await reservedAndListed()).toEqual(before);
    });

    it("a pending link, from a join that never finished, does not refuse the next join", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      await writePairLink(designated, "pending");

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    });

    it("refuses a join while the venue streams to a bucket, reserving nothing and listing nobody", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      await withTransaction(db, (tx) =>
        writeStreamSettings(
          tx,
          RING,
          {
            endpoint: "https://s3.example.test",
            region: "eu-west-1",
            bucket: "venue-bucket",
            prefix: "",
            accessKeyId: "bucket-access-key",
            secretAccessKey: "bucket-secret-key",
          },
          null,
        ),
      );
      const before = await reservedAndListed();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.bucket_stream_active", params: {} },
      });
      expect(await reservedAndListed()).toEqual(before);
    });

    it("refuses a join when bucket settings are saved after its early refusals, reserving nothing and writing no link", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const before = await reservedAndListed();
      pause.beforeModuleConfigRead = async () => {
        await withTransaction(db, (tx) =>
          writeStreamSettings(
            tx,
            RING,
            {
              endpoint: "https://s3.example.test",
              region: "eu-west-1",
              bucket: "venue-bucket",
              prefix: "",
              accessKeyId: "bucket-access-key",
              secretAccessKey: "bucket-secret-key",
            },
            null,
          ),
        );
      };

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(pause.beforeModuleConfigRead).toBeUndefined();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.bucket_stream_active", params: {} },
      });
      expect(await reservedAndListed()).toEqual(before);
      expect(await readPairLink(suite.node, designated.nodeId)).toBeNull();
    });

    it("waits for a bucket Save that holds node.db's lock, then refuses the settings it stored", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const before = await reservedAndListed();
      // Bucket Save's shape: under node.db's lock it has found no pair link, and stores its
      // settings only once released. A join that checks without waiting for the lock has done so
      // by the time the timer releases the save.
      let entered!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => (entered = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      const saving = withNodeTransaction(suite.node, async () => {
        entered();
        await gate;
        await withTransaction(db, (tx) =>
          writeStreamSettings(
            tx,
            RING,
            {
              endpoint: "https://s3.example.test",
              region: "eu-west-1",
              bucket: "venue-bucket",
              prefix: "",
              accessKeyId: "bucket-access-key",
              secretAccessKey: "bucket-secret-key",
            },
            null,
          ),
        );
      });
      await ready;
      pause.beforeModuleConfigRead = async () => {
        setTimeout(release, 50);
      };

      let res: Response;
      try {
        res = await approvedJoin(app, {
          email: ADMIN_EMAIL,
          ...validStandby(),
        });
      } finally {
        release();
        await saving;
      }

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.bucket_stream_active", params: {} },
      });
      expect(await reservedAndListed()).toEqual(before);
      expect(await readPairLink(suite.node, designated.nodeId)).toBeNull();
    });

    it("refuses a join while the venue holds stream settings this box cannot open, as it does readable ones", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const otherRing = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      });
      await withTransaction(db, (tx) =>
        writeStreamSettings(
          tx,
          otherRing,
          {
            endpoint: "https://s3.example.test",
            region: "eu-west-1",
            bucket: "venue-bucket",
            prefix: "",
            accessKeyId: "bucket-access-key",
            secretAccessKey: "bucket-secret-key",
          },
          null,
        ),
      );
      const before = await reservedAndListed();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.bucket_stream_active", params: {} },
      });
      expect(await reservedAndListed()).toEqual(before);
    });

    it("refuses a spare whose name is the main box's own", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const before = await reservedAndListed();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
        standbyNodeId: `${designated.nodeId.slice(0, 4)}${crypto.randomUUID().slice(4)}`,
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.standby_name_taken", params: {} },
      });
      expect(await reservedAndListed()).toEqual(before);
    });

    it("refuses a spare whose name a listed box already has", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const listed = crypto.randomUUID();
      await holdChartWithStandby(designated, listed);
      const before = await reservedAndListed();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
        standbyNodeId: `${listed.slice(0, 4)}${crypto.randomUUID().slice(4)}`,
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.standby_name_taken", params: {} },
      });
      expect(await reservedAndListed()).toEqual(before);
    });

    it("refuses a chart that lists a box it also names as cleared, before reserving", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const cleared = crypto.randomUUID();
      const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
      await writeNodeMembership(
        db,
        signedMembershipDoc(seedTerm, {
          signerNodeId: designated.nodeId,
          keyPair: primaryKeyPair,
          nodes: [
            {
              nodeId: designated.nodeId,
              contactUrl: "https://box.deli.test",
              standing: "serving-primary",
            },
            { nodeId: cleared, contactUrl: "", standing: "serving-secondary" },
          ],
          revoked: [cleared],
        }),
      );
      const before = await reservedAndListed();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "membership.revoked_node_listed", params: { nodeId: cleared } },
      });
      expect(await reservedAndListed()).toEqual(before);
    });

    it.each([
      ["behind", -10],
      ["ahead", 10],
    ])(
      "refuses a spare whose clock is too far away, in either direction, reserving nothing and listing nobody (%s)",
      async (_direction, minutes) => {
        const { designated } = await setupVenue();
        const primaryAt = Date.now();
        const app = mountApp(designated, undefined, undefined, () => new Date(primaryAt));
        const standbyAt = primaryAt + minutes * 60_000;
        const before = await reservedAndListed();

        const res = await approvedJoin(app, {
          email: ADMIN_EMAIL,
          ...validStandby(),
          standbyAt,
        });

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
          error: {
            code: "mirror.clocks_apart",
            params: {
              primaryAt: new Date(primaryAt).toISOString(),
              standbyAt: new Date(standbyAt).toISOString(),
            },
          },
        });
        expect(await reservedAndListed()).toEqual(before);
      },
    );

    it.each([-9, 9])("a spare %i minutes away joins", async (minutes) => {
      const { designated } = await setupVenue();
      const primaryAt = Date.now();
      const app = mountApp(designated, undefined, undefined, () => new Date(primaryAt));

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
        standbyAt: primaryAt + minutes * 60_000,
      });

      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    });

    // The hello checks the clock and the name too; these pass it, so the bundle's own checks answer.
    async function listedSpare(app: Hono, at: number) {
      const box = joiningBox("10.30.0.1", {
        identity: {
          nodeId: unusedFixtureNodeId(),
          publicKey: STANDBY_PUB,
          privateKey: STANDBY_KEYS.privateKey,
        },
        contactUrl: "https://cloud.deli.test",
        storeUrl: "https://cloud.deli.test:7443",
      });
      return listedJoin(app, box, at);
    }

    it("refuses at approve a spare whose latest poll reads a clock too far away, reserving nothing", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const primaryAt = Date.now();
      const app = mountApp(designated, undefined, undefined, () => new Date(primaryAt));
      const listed = await listedSpare(app, primaryAt);
      const standbyAt = primaryAt + 11 * 60_000;
      expect(await pollJoin(app, listed, standbyAt, true)).toEqual({ state: "waiting" });
      const before = await reservedAndListed();

      const answer = await approveJoin(
        app,
        listed.requestId,
        {},
        { cookie: await signedInCookie(db, adminPersonId) },
      );

      expect(answer.status).toBe(409);
      expect((answer.body as { error: { code: string } }).error.code).toBe("mirror.clocks_apart");
      expect(await reservedAndListed()).toEqual(before);
    });

    it("refuses Add as spare before the new box's Yes, reserving nothing and ending nothing, then adds it after the Yes", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated);
      const listed = await listedSpare(app, Date.now());
      const sent = { cookie: await signedInCookie(db, adminPersonId) };
      const before = await reservedAndListed();

      expect(await approveJoin(app, listed.requestId, {}, sent)).toEqual({
        status: 409,
        body: { error: { code: "mirror.join_not_confirmed", params: {} } },
      });
      expect(await reservedAndListed()).toEqual(before);

      expect(await pollJoin(app, listed, Date.now(), true)).toEqual({ state: "waiting" });
      const added = await approveJoin(app, listed.requestId, {}, sent);
      expect(added.status, JSON.stringify(added.body)).toBe(202);
      expect(await pollJoin(app, listed, Date.now(), true)).toMatchObject({ state: "approved" });
    });

    it("refuses at approve a spare whose name a box listed after its hello already has, reserving nothing", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated);
      const listed = await listedSpare(app, Date.now());
      expect(await pollJoin(app, listed, Date.now(), true)).toEqual({ state: "waiting" });
      const newNodeId = listed.box.hello.newNodeId;
      await holdChartWithStandby(
        designated,
        `${newNodeId.slice(0, 4)}${crypto.randomUUID().slice(4)}`,
      );
      const before = await reservedAndListed();

      const answer = await approveJoin(
        app,
        listed.requestId,
        {},
        { cookie: await signedInCookie(db, adminPersonId) },
      );

      expect(answer).toEqual({
        status: 409,
        body: { error: { code: "mirror.standby_name_taken", params: {} } },
      });
      expect(await reservedAndListed()).toEqual(before);
    });

    it.each([
      ["a string", "1700000000000"],
      ["null", null],
      ["far past a date's range", 1e300],
      ["just past a date's range", 8.64e15 + 1],
      ["far before a date's range", -1e17],
    ])("refuses a standbyAt that is %s as mirror.standby_invalid", async (_kind, standbyAt) => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
        standbyAt,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: "mirror.standby_invalid", params: {} } });
    });
  });

  it("refuses to sign over a held document no stored key vouches for, writing nothing", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    await writeNodeMembership(
      db,
      signedMembershipDoc(seedTerm, {
        signerNodeId: "stranger",
        nodes: [
          {
            nodeId: designated.nodeId,
            contactUrl: "https://box.deli.test",
            standing: "serving-primary",
          },
        ],
      }),
    );
    const chartBefore = await readNodeMembership(db);

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "membership.held_untrusted", params: { reason: "untrusted_signer" } },
    });
    expect(await readNodeMembership(db)).toEqual(chartBefore);
  });

  it("still refuses a malformed held document signed by a key no stored key vouches for", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    await writeNodeMembership(
      db,
      signedMembershipDoc(seedTerm, {
        signerNodeId: "stranger",
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

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "membership.held_untrusted", params: { reason: "untrusted_signer" } },
    });
    expect(await readNodeMembership(db)).toEqual(chartBefore);
  });

  /** Holds a chart signed by a key this box never stored, then changed as `alter` says. */
  async function holdStrangerChart(
    designated: AdoptResult,
    alter: (doc: SignedMembershipDocument) => object = (doc) => doc,
  ): Promise<void> {
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    const doc = signedMembershipDoc(seedTerm, {
      signerNodeId: "stranger",
      nodes: [
        {
          nodeId: designated.nodeId,
          contactUrl: "https://box.deli.test",
          standing: "serving-primary",
        },
      ],
    });
    await writeNodeMembership(db, alter(doc) as SignedMembershipDocument);
  }

  it("refuses a held document no stored key vouches for that carries an unsigned field beside its body", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    await holdStrangerChart(designated, (doc) => ({ ...doc, note: "x" }));
    const chartBefore = await readNodeMembership(db);

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "membership.held_untrusted", params: { reason: "untrusted_signer" } },
    });
    expect(await readNodeMembership(db)).toEqual(chartBefore);
  });

  it("refuses a held document too broken to verify with 409 membership.held_untrusted", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    await holdStrangerChart(designated, (doc) => ({ ...doc, signature: undefined }));
    const chartBefore = await readNodeMembership(db);

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "membership.held_untrusted", params: { reason: "malformed" } },
    });
    expect(await readNodeMembership(db)).toEqual(chartBefore);
  });

  it("refuses a held document no stored key vouches for before reserving anything", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    await holdStrangerChart(designated);
    const counterBefore = await allocationSnapshot();

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...validStandby(),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "membership.held_untrusted",
    );
    expect(await allocationSnapshot()).toEqual(counterBefore);
  });

  /** Holds a chart the main box signed with its own key over `body`, whatever its shape. */
  async function holdMainSignedBody(designated: AdoptResult, body: object): Promise<void> {
    await writeNodeMembership(db, {
      body,
      signerNodeId: designated.nodeId,
      signature: signDocumentBody(body as MembershipDocumentBody, primaryKeyPair.privateKey),
      endorsements: [],
    } as unknown as SignedMembershipDocument);
  }

  it.each([
    ["with no nodes list", (term: number) => ({ term })],
    ["whose nodes entry is a number", (term: number) => ({ term, nodes: [42] })],
  ])(
    "refuses 409 membership.held_untrusted malformed for a chart the main box signed %s, reserving nothing and changing no chart",
    async (_label, bodyAt) => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
      await holdMainSignedBody(designated, bodyAt(seedTerm));
      const chartBefore = await readNodeMembership(db);
      const counterBefore = await allocationSnapshot();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "membership.held_untrusted", params: { reason: "malformed" } },
      });
      expect(await allocationSnapshot()).toEqual(counterBefore);
      expect(await readNodeMembership(db)).toEqual(chartBefore);
    },
  );

  it.each([
    ["with no nodes list", (term: number) => ({ term })],
    ["whose nodes entry is a number", (term: number) => ({ term, nodes: [42] })],
  ])(
    "refuses 409 membership.held_untrusted malformed when a chart the main box signed %s lands between a chart round's read and its write",
    async (_label, bodyAt) => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const seedTerm = await holdChartWithStandby(designated, crypto.randomUUID());
      pause.beforeChartMint = () => holdMainSignedBody(designated, bodyAt(seedTerm + 1));

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(pause.beforeChartMint).toBeUndefined();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "membership.held_untrusted", params: { reason: "malformed" } },
      });
      expect((await readNodeMembership(db))?.body).toEqual(bodyAt(seedTerm + 1));
    },
  );

  it("adds a spare after another spare retired itself", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);
    const retired = generateNodeKeyPair();
    const retiredId = crypto.randomUUID();
    const endorsement = endorseKey(
      retiredId,
      retired.publicKey,
      designated.nodeId,
      primaryKeyPair.privateKey,
    );
    const seedTerm = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
    const retirement = signedMembershipDoc(seedTerm, {
      signerNodeId: retiredId,
      keyPair: retired,
      nodes: [
        {
          nodeId: designated.nodeId,
          contactUrl: "https://box.deli.test",
          standing: "serving-primary",
        },
        { nodeId: retiredId, contactUrl: "https://cloud.deli.test", standing: "evicted" },
      ],
    });
    await writeNodeMembership(db, { ...retirement, endorsements: [endorsement] });
    const standby = validStandby();

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      ...standby,
    });

    expect(res.status).toBe(200);
    const held = (await readNodeMembership(db))!;
    expect(held.body.term).toBe(seedTerm + 1);
    expect(held.signerNodeId).toBe(designated.nodeId);
    expect(held.body.nodes.map((n) => n.nodeId)).toContain(standby.standbyNodeId);
  });

  describe("a held chart already listing MAX_NODES machines", () => {
    /** This primary and MAX_NODES - 1 others, the first of them `evicted`; returns their ids. */
    async function holdFullChart(
      designated: AdoptResult,
    ): Promise<{ term: number; ids: string[] }> {
      const term = ((await readNodeMembership(db))?.body.term ?? -1) + 1;
      const others: MembershipNode[] = Array.from({ length: MAX_NODES - 1 }, (_, i) => ({
        nodeId: unusedFixtureNodeId(),
        contactUrl: `https://standby-${i}.deli.test`,
        standing: i === 0 ? "evicted" : "serving-secondary",
      }));
      await writeNodeMembership(
        db,
        signedMembershipDoc(term, {
          signerNodeId: designated.nodeId,
          keyPair: primaryKeyPair,
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

    it("keeps fixture box names distinct when UUID draws share a prefix", async () => {
      const { designated } = await setupVenue();
      const draw = vi.spyOn(crypto, "randomUUID");
      try {
        draw.mockReturnValueOnce(
          `${designated.nodeId.slice(0, 4)}0000-0000-4000-8000-000000000001`,
        );
        const { ids } = await holdFullChart(designated);
        draw.mockReturnValueOnce(`${ids[0]!.slice(0, 4)}0000-0000-4000-8000-000000000002`);
        const standby = validStandby();
        const prefixes = [designated.nodeId, ...ids, standby.standbyNodeId].map((id) =>
          id.slice(0, 4).toLowerCase(),
        );
        expect(new Set(prefixes).size).toBe(prefixes.length);
      } finally {
        draw.mockRestore();
      }
    });

    it("refuses a new standby with 409 mirror.membership_full, before reserving anything", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      await holdFullChart(designated);
      const chartBefore = await readNodeMembership(db);
      const counterBefore = await allocationSnapshot();

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: "mirror.membership_full", params: { limit: MAX_NODES } },
      });
      expect(await allocationSnapshot()).toEqual(counterBefore);
      expect(await readNodeMembership(db)).toEqual(chartBefore);
    });

    it("takes the new standby once an admin clears the removed machine, and still refuses the cleared id", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated);
      const { ids } = await holdFullChart(designated);
      const removed = ids[0]!;
      const newcomer = validStandby();
      const refused = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...newcomer,
      });
      expect(refused.status).toBe(409);

      const clearance = await clearRemovedMachine(
        { db, node: suite.node, ring: RING, nodeId: designated.nodeId, log: () => {} },
        { targetNodeId: removed, personId: adminPersonId },
      );
      expect(clearance.cleared).toBe(true);

      const joined = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...newcomer,
      });
      expect(joined.status).toBe(200);
      const after = (await readNodeMembership(db))!;
      expect(after.body.nodes).toHaveLength(MAX_NODES);
      expect(after.body.nodes.map((n) => n.nodeId)).toContain(newcomer.standbyNodeId);
      expect(after.body.revoked).toEqual([removed]);

      const returning = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
        standbyNodeId: removed,
      });
      expect(returning.status).toBe(409);
      expect(await returning.json()).toEqual({
        error: { code: "mirror.standby_removed", params: {} },
      });
    });

    it("still serves a standby the full chart already lists, which adds no machine", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const { ids } = await holdFullChart(designated);
      const listed = ids[1]!;

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
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
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      await holdChartWithStandby(designated, crypto.randomUUID());
      let filledTerm = -1;
      pause.beforeChartMint = async () => {
        filledTerm = (await holdFullChart(designated)).term;
      };

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
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
        await removeStandby(
          { db, node: suite.node, ring: RING, nodeId: designated.nodeId, log: () => {} },
          { targetNodeId: standbyNodeId, personId: adminPersonId },
        );
      };

    it("refuses 409 mirror.standby_removed when the removal commits before the reservation, which spends nothing", async () => {
      const { designated, adminPersonId } = await setupVenue();
      const app = mountApp(designated);
      const standbyNodeId = crypto.randomUUID();
      const seedTerm = await holdChartWithStandby(designated, standbyNodeId);
      const counterBefore = await allocationSnapshot();
      pause.beforeModuleConfigRead = removeDuringRequest(designated, adminPersonId, standbyNodeId);

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
        standbyNodeId,
      });

      expect(pause.beforeModuleConfigRead).toBeUndefined();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: { code: "mirror.standby_removed", params: {} } });
      expect(await allocationSnapshot()).toEqual(counterBefore);
      const after = (await readNodeMembership(db))!;
      expect(after.body.term).toBe(seedTerm + 1);
      expect(after.body.nodes.find((n) => n.nodeId === standbyNodeId)?.standing).toBe("evicted");
      expect(await removalRows()).toEqual([{ removed_node_id: standbyNodeId, term: seedTerm + 1 }]);
    });

    // A Remove takes node.db's lock, so it waits for this request and cannot commit inside its
    // round; the evicting chart is written directly, as a chart another writer signs would land.
    it("refuses 409 mirror.standby_removed when a chart evicting the standby lands between a chart round's read and its write", async () => {
      const { designated } = await setupVenue();
      const app = mountApp(designated);
      const standbyNodeId = crypto.randomUUID();
      const seedTerm = await holdChartWithStandby(designated, standbyNodeId);
      const counterBefore = await allocationSnapshot();
      pause.beforeChartMint = () =>
        writeNodeMembership(
          db,
          signedMembershipDoc(seedTerm + 1, {
            signerNodeId: designated.nodeId,
            keyPair: primaryKeyPair,
            nodes: [
              {
                nodeId: designated.nodeId,
                contactUrl: "https://box.deli.test",
                standing: "serving-primary",
              },
              { nodeId: standbyNodeId, contactUrl: "https://cloud.deli.test", standing: "evicted" },
            ],
          }),
        );

      const res = await approvedJoin(app, {
        email: ADMIN_EMAIL,
        ...validStandby(),
        standbyNodeId,
      });

      expect(pause.beforeChartMint).toBeUndefined();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: { code: "mirror.standby_removed", params: {} } });
      // The chart is written before any module reserves, so its refusal reserves nothing.
      expect(await allocationSnapshot()).toEqual(counterBefore);
      // The removal's chart is the one held: the request wrote no later term over it.
      const after = (await readNodeMembership(db))!;
      expect(after.body.term).toBe(seedTerm + 1);
      expect(after.body.nodes.find((n) => n.nodeId === standbyNodeId)?.standing).toBe("evicted");
    });
  });

  it("refuses a non-string standbyContactUrl as mirror.standby_invalid", async () => {
    const { designated } = await setupVenue();
    const app = mountApp(designated);

    const res = await approvedJoin(app, {
      email: ADMIN_EMAIL,
      standbyNodeId: crypto.randomUUID(),
      standbyPublicKey: STANDBY_PUB,
      standbyContactUrl: 42,
      standbyAt: Date.now(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "mirror.standby_invalid", params: {} } });
  });
});

async function allocatedReply(
  app: Hono,
  designated: AdoptResult,
  adminPersonId: string,
  body: { standbyNodeId: string; [key: string]: unknown },
) {
  const primary = {
    nodeId: nodeId(designated.nodeId),
  };
  const fixture = await standbyContract(
    db,
    primary,
    body.standbyNodeId,
    [
      { code: "FA", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "RF", purpose: "corrective" },
      { code: "RFF", purpose: "full_corrective" },
    ],
    adminPersonId,
  );
  const held = fixture.request("reserve");
  const original = [...ALL_MODULES];
  (ALL_MODULES as WaitronModule[]).splice(
    0,
    ALL_MODULES.length,
    ...withoutActivationMark(allocatedStandbyModules(ALL_MODULES, fixture)),
  );
  try {
    const res = await approvedJoin(app, {
      ...body,
      moduleOperation: { binding: held.binding, input: held.input },
    });
    return { res, fixture };
  } finally {
    (ALL_MODULES as WaitronModule[]).splice(0, ALL_MODULES.length, ...original);
  }
}
