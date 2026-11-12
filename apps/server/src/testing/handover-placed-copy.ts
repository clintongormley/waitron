import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
// A spare whose venue.db is a real placed copy of the old box's database. Stand-ins: M1's stepdown
// and the transfer of the copy (both real elsewhere); the copy, its signed indicator, its
// acceptance and its placing are the real functions.
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, vi } from "vitest";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  locations,
  nodes,
  openVenueDatabase,
  stampDeployment,
  tenants,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { signEnvelope } from "@waitron/handover";
import { hashPassword } from "@waitron/identity";
import { endorseKey, signDocumentBody, type SignedMembershipDocument } from "@waitron/membership";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import {
  readHandoverOperation,
  recordHandoverRestrictionTx,
  setNodeMode,
  writeMirrorLink,
} from "@waitron/node-db";
import { mergeModulePreparationRevisions } from "@waitron/provisioning";
import { locationId } from "@waitron/shared";
import { acceptFinalCopy, acceptedCopyPath } from "../handover-acceptance.js";
import { captureFinalCopy, finalCopyPath } from "../handover-capture.js";
import { placeAcceptedCopyAtStart, recordCopyPlaced } from "../handover-place-copy.js";
import { advanceHandover, beginHandover } from "../handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "../node-identity.js";
import { mintSelfSignedServerCert } from "../self-signed-cert.js";
import { pinMainBoxKey } from "./pinned-main-box.js";

const venueId = locationId(TENANT_A.locationId);
export const primary = { nodeId: TENANT_A.nodeId };
export const standby = { nodeId: TENANT_A.nodeId2 };
export const OPERATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ADMIN = "e1000000-0000-4000-8000-000000000004";
export const ADMIN_EMAIL = "admin@venue.test";
export const PASSWORD = "synthetic-handover-password";
export const MODULE = "fiscal-verifactu";
export const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
export const binding: OperationBinding = {
  module: MODULE,
  action: "promote",
  eventId: OPERATION,
  sourceId: primary.nodeId,
  targetNodeId: standby.nodeId,
};
export const fiscalModules = ALL_MODULES.filter((module) => module.name === MODULE);
export const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const handoverBinding = {
  operationId: OPERATION,
  scenario: "controlled" as const,
  venue: { country: "ES", taxId: "89890001K", environment: "preproduction" as const },
  sourceNodeId: primary.nodeId,
  destinationNodeId: standby.nodeId,
  membership: { term: 1, digest: "a".repeat(64) },
};

export interface PlacedSpare {
  venue: Database;
  node: NodeDatabase;
  close(): Promise<void>;
  /** What the old box handed over, as `filing_assumed` stored it. */
  relinquishment: unknown;
  /** The chart the copy holds, naming the old box the main box. */
  chart: SignedMembershipDocument;
  mainKey: string;
  spareKey: string;
}

export function placedSpareFixture(boxes: {
  mainBox: { db: Database; node: NodeDatabase };
  spareBefore: { db: Database; node: NodeDatabase };
  dirs: () => { mainState: string; spareState: string; spareVenue: string };
}) {
  const { mainBox, spareBefore, dirs } = boxes;
  /** M1's first setup, activated in M1's database, with its selection kept in M1's own file. */
  async function firstSetupOnM1() {
    let value: unknown = null;
    const first = { ...binding, action: "setup", eventId: "first", targetNodeId: primary.nodeId };
    const setup = createHourPreparation({
      withState: async (_binding, run) =>
        run({
          get value() {
            return value;
          },
          history: [],
          async replace(next) {
            value = next;
          },
        }),
      monotonicNow: () => performance.now(),
      read: async () => ({
        scope: { taxpayerNif: "89890001K", environment: "preproduction" },
        bases,
        contextKey: "first",
        history: [{ reference: "empty", complete: true, records: [] }],
        clock: compareHourClocks(
          ["box", "browser"].map((source) => ({
            source: source as "box" | "browser",
            result: "usable",
            instantMs: Date.now(),
            uncertaintyMs: 0,
            wallStartedMs: Date.now(),
            wallFinishedMs: Date.now(),
            monotonicStartedMs: 0,
            monotonicFinishedMs: 0,
          })),
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      }),
    });
    await withOperationAuthority(first, ADMIN, async (authority) => {
      let selected = await setup.select({ binding: first, authority, comparisonId: "comparison" });
      if (selected.status === "waiting") {
        vi.advanceTimersByTime(selected.targetMs + 1 - Date.now());
        selected = await setup.select({ binding: first, authority, comparisonId: "comparison" });
      }
      if (selected.status !== "selected") throw new Error("first setup selection");
      await setup.prepare({ binding: first, authority, input: selected.input }, (ready) =>
        withTransaction(mainBox.db, (tx) => activatePreparedModuleAllocation(tx, primary, ready)),
      );
    });
    await mergeModulePreparationRevisions({ stateDir: dirs().mainState }, [
      { binding: first, value },
    ]);
  }

  async function setupBoxes() {
    const { mainState, spareState, spareVenue } = dirs();
    for (const dir of [mainState, spareState, spareVenue]) await mkdir(dir);
    await mainBox.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Handover SL" });
    await mainBox.db.insert(locations).values({
      id: venueId,
    });
    await seedVenueSettings(mainBox.db, {
      name: "Restaurant",
      invoiceLocales: ["en"],
      operationDescription: "Hospitality",
    });
    await seedBusinessDay(mainBox.db, { timeZone: "Europe/Madrid" });
    await mainBox.db.insert(nodes).values({
      id: primary.nodeId,
      name: "Primary",
      filingModule: "verifactu",
      taxModule: "vat",
    });
    await stampDeployment(mainBox.db, "preproduction");
    await seedPersons(mainBox.db, {
      id: ADMIN,
      displayName: "Administrator",
      role: "admin",
      passwordHash: hashPassword(PASSWORD),
      email: ADMIN_EMAIL,
    });
    await firstSetupOnM1();
    await establishNodeIdentity({ ownerDb: mainBox.db, node: mainBox.node, ring }, primary.nodeId);

    // M2's own database knows nothing of the venue's people or filing; only its own row and key.
    await spareBefore.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Handover SL" });
    await spareBefore.db.insert(locations).values({
      id: venueId,
    });
    await seedVenueSettings(spareBefore.db, { name: "Restaurant" });
    await seedBusinessDay(spareBefore.db, { timeZone: "Europe/Madrid" });
    await spareBefore.db.insert(nodes).values({
      id: standby.nodeId,
      name: "Standby",
      filingModule: "verifactu",
      taxModule: "vat",
    });
    await establishNodeIdentity(
      { ownerDb: spareBefore.db, node: spareBefore.node, ring },
      standby.nodeId,
    );
    await stampDeployment(spareBefore.db, "preproduction");
    await setNodeMode({ venue: spareBefore.db, node: spareBefore.node }, standby.nodeId, "mirror");

    const spareKey = await readNodeIdentityKey(spareBefore.node, ring, standby.nodeId);
    const mainKey = await readNodeIdentityKey(mainBox.node, ring, primary.nodeId);
    const sparePublic = nodeSigningPublicKey(spareKey);
    await pinMainBoxKey(spareBefore.node, standby.nodeId, {
      nodeId: primary.nodeId,
      publicKey: nodeSigningPublicKey(mainKey),
    });
    await withTransaction(mainBox.db, (tx) =>
      insertReservedNodeTx(tx, {
        id: standby.nodeId,
        name: "Primary (standby)",
        filingModule: "verifactu",
        taxModule: "vat",
        publicKey: sparePublic,
        endorsement: endorseKey(standby.nodeId, sparePublic, primary.nodeId, mainKey),
      }),
    );

    const chartBody = {
      term: 1,
      nodes: [
        {
          nodeId: primary.nodeId,
          contactUrl: "https://main.example",
          standing: "serving-primary" as const,
        },
        {
          nodeId: standby.nodeId,
          contactUrl: "https://spare.example",
          standing: "serving-secondary" as const,
        },
      ],
    };
    const chart: SignedMembershipDocument = {
      body: chartBody,
      signerNodeId: primary.nodeId,
      signature: signDocumentBody(chartBody, mainKey),
      endorsements: [endorseKey(standby.nodeId, sparePublic, primary.nodeId, mainKey)],
    };
    await writeNodeMembership(mainBox.db, chart);
    await writeNodeMembership(spareBefore.db, chart);

    return { chart, mainKey, spareKey };
  }

  /** Two separate boxes, then the real capture and acceptance, leaving M2 stopped on its own files. */
  async function stoppedBeforePlacing() {
    const { chart, mainKey, spareKey } = await setupBoxes();
    const { mainState, spareState, spareVenue } = dirs();
    const mainStore = { node: mainBox.node, nodeId: primary.nodeId };
    await beginHandover(mainStore, handoverBinding, "source");
    await advanceHandover(mainStore, OPERATION, "source_stepped_down", {});
    await withNodeTransaction(mainBox.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: primary.nodeId,
        operationId: OPERATION,
        kind: "handed-over",
        successorNodeId: standby.nodeId,
        membershipTerm: 1,
      }),
    );
    const indicator = await captureFinalCopy(
      {
        venue: mainBox.db,
        node: mainBox.node,
        stateDir: mainState,
        ring,
        nodeId: primary.nodeId,
        modules: fiscalModules,
      },
      OPERATION,
    );

    const spareStore = { node: spareBefore.node, nodeId: standby.nodeId };
    await beginHandover(spareStore, handoverBinding, "destination");
    const received = join(spareState, "received.db");
    await copyFile(finalCopyPath(mainState, OPERATION), received);
    await mkdir(dirname(acceptedCopyPath(spareState, OPERATION)), { recursive: true });
    await acceptFinalCopy(
      { node: spareBefore.node, ring, nodeId: standby.nodeId, stateDir: spareState },
      (await readHandoverOperation(spareBefore.node, standby.nodeId, OPERATION))!,
      indicator,
      received,
    );
    const relinquishment = signEnvelope(
      "relinquishment",
      { binding: handoverBinding, filingAssignedTo: standby.nodeId },
      { nodeId: primary.nodeId, privateKey: mainKey },
    );
    await advanceHandover(spareStore, OPERATION, "filing_assumed", {}, relinquishment);

    await writeMirrorLink(spareBefore.node, standby.nodeId, {
      originUrl: "http://127.0.0.1:1/",
      boxHostname: "box.local",
      boxCaPem: mintSelfSignedServerCert({
        hostnames: ["box.local"],
        ipAddresses: [],
        now: new Date(),
      }).caCertPem,
      originNodeId: primary.nodeId,
    });

    // The spare's own files, as a stopped box leaves them for the start that places the copy.
    spareBefore.db.run(sql`vacuum into ${join(spareVenue, "venue.db")}`);
    spareBefore.node.run(sql`vacuum into ${join(spareVenue, "node.db")}`);
    return { relinquishment, chart, mainKey, spareKey };
  }

  /** {@link stoppedBeforePlacing}, then the real placing, leaving M2 on M1's bytes. */
  async function placeRealCopy({ recordPlaced = true } = {}): Promise<PlacedSpare> {
    const { spareState, spareVenue } = dirs();
    const stopped = await stoppedBeforePlacing();
    const log = () => {};
    const placing = await placeAcceptedCopyAtStart({
      venueDir: spareVenue,
      stateDir: spareState,
      nodeId: standby.nodeId,
      log,
    });
    expect(placing).toMatchObject({ kind: "copy_placed_owed", swapped: true });
    const placed = await openVenueDatabase(spareVenue);
    if (recordPlaced) {
      await recordCopyPlaced({
        node: placed.node,
        nodeId: standby.nodeId,
        stateDir: spareState,
        operationId: OPERATION,
        log,
      });
    }
    return {
      venue: placed.venue,
      node: placed.node,
      close: () => placed.close(),
      ...stopped,
    };
  }

  async function placeEmergencyCopy(): Promise<PlacedSpare> {
    const keys = await setupBoxes();
    await writeMirrorLink(spareBefore.node, standby.nodeId, {
      originUrl: "http://127.0.0.1:1/",
      boxHostname: "box.local",
      boxCaPem: mintSelfSignedServerCert({
        hostnames: ["box.local"],
        ipAddresses: [],
        now: new Date(),
      }).caCertPem,
      originNodeId: primary.nodeId,
    });
    const { spareVenue } = dirs();
    mainBox.db.run(sql`vacuum into ${join(spareVenue, "venue.db")}`);
    spareBefore.node.run(sql`vacuum into ${join(spareVenue, "node.db")}`);
    const opened = await openVenueDatabase(spareVenue);
    return {
      venue: opened.venue,
      node: opened.node,
      close: () => opened.close(),
      relinquishment: null,
      ...keys,
    };
  }
  return { setupBoxes, placeRealCopy, stoppedBeforePlacing, placeEmergencyCopy };
}
