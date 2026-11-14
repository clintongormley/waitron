import { seedModuleDocument } from "../test/module-settings.js";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  readTenant,
  stampDeployment,
  writeNodeMembership,
  type NodeDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import {
  sha256Hex,
  signEnvelope,
  verifyEnvelope,
  type HandoverBinding,
  type HandoverKind,
} from "@waitron/handover";
import {
  canonicalize,
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { NODE_MIGRATIONS, readHandoverOperation, setNodeMode } from "@waitron/node-db";
import { mountHandoverDestinationApi } from "./handover-destination-api.js";
import { imageMigrationsDigest } from "./handover-manifest.js";
import type { HandoverStatusBody } from "./handover-status-api.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { copyImageMigrations } from "./testing/image-migrations.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSON = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE = { nodeId: "11111111-1111-4111-8111-111111111111", ...generateNodeKeyPair() };
const BYSTANDER = { nodeId: "22222222-2222-4222-8222-222222222222", ...generateNodeKeyPair() };
const STRANGER = { nodeId: "33333333-3333-4333-8333-333333333333", ...generateNodeKeyPair() };
const SETTINGS = { backupSettings: null, moduleSettings: null, ringVersions: [1] };
const IMAGE = imageMigrationsDigest(null);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});

async function writeSettingsSource(file: string, text: string) {
  if (file !== "settings:modules") return writeFile(join(stateDir, file), text);
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text);
  } catch {
    doc = { modules: null };
  }
  await seedModuleDocument(suite.db, doc);
}

let self: string;
let app: Hono;
let held: SignedMembershipDocument;
let binding: HandoverBinding;
let stateDir: string;

const store = () => ({ node: suite.node as NodeDatabase, nodeId: self });

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "handover-destination-"));
  await seedVenue(suite.db);
  self = await seedNode(suite.db);
  await stampDeployment(suite.db, "preproduction");
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, self);
  await setNodeMode({ venue: suite.db, node: suite.node }, self, "mirror");
  const selfKey = await readNodeIdentityKey(suite.node, RING, self);
  const body: MembershipDocumentBody = {
    term: 3,
    nodes: [
      { nodeId: SOURCE.nodeId, contactUrl: "https://box-0", standing: "serving-primary" },
      { nodeId: self, contactUrl: "https://box-1", standing: "serving-secondary" },
      { nodeId: BYSTANDER.nodeId, contactUrl: "https://box-2", standing: "serving-secondary" },
    ],
  };
  held = {
    body,
    signerNodeId: self,
    signature: signDocumentBody(body, selfKey),
    endorsements: [
      endorseKey(SOURCE.nodeId, SOURCE.publicKey, self, selfKey),
      endorseKey(BYSTANDER.nodeId, BYSTANDER.publicKey, self, selfKey),
    ],
  };
  await writeNodeMembership(suite.db, held);
  const tenant = await readTenant(suite.db);
  binding = {
    operationId: OP,
    scenario: "controlled",
    venue: { country: tenant!.country, taxId: tenant!.taxId, environment: "preproduction" },
    sourceNodeId: SOURCE.nodeId,
    destinationNodeId: self,
    membership: {
      term: 3,
      digest: sha256Hex(canonicalize(held as unknown as CanonicalValue)),
    },
  };
  app = new Hono();
  mountHandoverDestinationApi(
    app,
    { db: suite.db, node: suite.node, ring: RING, nodeId: self, stateDir, migrationsRoot: null },
    () => undefined,
  );
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

function envelopeOf(
  overrides: Partial<HandoverBinding> = {},
  signer: { nodeId: string; privateKey: string } = SOURCE,
  kind: HandoverKind = "stepdown",
) {
  const body = {
    binding: { ...binding, ...overrides },
    authorisedBy: PERSON,
    settings: SETTINGS,
    imageMigrations: IMAGE,
  };
  return signEnvelope(kind, body as unknown as CanonicalValue, signer);
}

async function post(raw: unknown): Promise<{ status: number; body: unknown }> {
  const response = await app.request("/api/node/handover/offer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof raw === "string" ? raw : JSON.stringify(raw),
  });
  return { status: response.status, body: await response.json() };
}

function refusal(status: number, code: string, params: object = {}) {
  return { status, body: { error: { code, params } } };
}

function events(): {
  operationId: string;
  kind: string;
  detail: string;
  envelope: string | null;
}[] {
  return suite.node.all<{
    operationId: string;
    kind: string;
    detail: string;
    envelope: string | null;
  }>(
    sql`select operation_id as operationId, kind, detail, envelope from node_handover_events
        where node_id = ${self}`,
  );
}

async function expectNothingRecorded(): Promise<void> {
  expect(await readHandoverOperation(suite.node, self, OP)).toBeNull();
  expect(events()).toEqual([]);
}

async function signedStatusOf(answer: { status: number; body: unknown }) {
  expect(answer.status).toBe(200);
  const key = nodeSigningPublicKey(await readNodeIdentityKey(suite.node, RING, self));
  const verdict = verifyEnvelope<HandoverStatusBody>(answer.body, "status", (id) =>
    id === self ? key : undefined,
  );
  if (!verdict.valid) throw new Error(`the answer did not verify: ${verdict.reason}`);
  return verdict.body;
}

describe("POST /api/node/handover/offer", () => {
  describe("a valid offer", () => {
    it("records `prepared` and the offer's envelope, and answers this box's signed status", async () => {
      const envelope = envelopeOf();
      expect(await signedStatusOf(await post(envelope))).toEqual({
        operationId: OP,
        role: "destination",
        scenario: "controlled",
        state: "prepared",
        sourceNodeId: SOURCE.nodeId,
        destinationNodeId: self,
        waitingReason: null,
      });
      expect(await readHandoverOperation(suite.node, self, OP)).toMatchObject({
        role: "destination",
        state: "prepared",
        binding,
      });
      expect(events()).toEqual([
        {
          operationId: OP,
          kind: "offer",
          detail: "{}",
          envelope: canonicalize(envelope as unknown as CanonicalValue),
        },
      ]);
    });

    it("a replay answers the same status and records nothing more", async () => {
      const first = await post(envelopeOf());
      const second = await post(envelopeOf());
      expect(second).toEqual(first);
      expect(events()).toHaveLength(1);
    });

    it("a replay after this box moved on answers the state it has now", async () => {
      await post(envelopeOf());
      await advanceHandover(store(), OP, "copy_accepted", {});
      expect((await signedStatusOf(await post(envelopeOf()))).state).toBe("copy_accepted");
    });

    it("a replay answers on a box that is no longer a mirror, whose chart has moved on", async () => {
      await post(envelopeOf());
      await setNodeMode({ venue: suite.db, node: suite.node }, self, "primary");
      const body = { ...held.body, term: 4 };
      const selfKey = await readNodeIdentityKey(suite.node, RING, self);
      await writeNodeMembership(suite.db, {
        ...held,
        body,
        signature: signDocumentBody(body, selfKey),
      });
      expect((await signedStatusOf(await post(envelopeOf()))).state).toBe("prepared");
    });

    it("a replay answers once the chart no longer names the source as the main box", async () => {
      await post(envelopeOf());
      const body: MembershipDocumentBody = {
        term: 4,
        nodes: [
          { nodeId: self, contactUrl: "https://box-1", standing: "serving-primary" },
          { nodeId: SOURCE.nodeId, contactUrl: "https://box-0", standing: "serving-secondary" },
        ],
      };
      const selfKey = await readNodeIdentityKey(suite.node, RING, self);
      await writeNodeMembership(suite.db, {
        ...held,
        body,
        signature: signDocumentBody(body, selfKey),
      });
      expect((await signedStatusOf(await post(envelopeOf()))).state).toBe("prepared");
    });

    it("is accepted once an earlier operation has closed", async () => {
      await post(envelopeOf({ operationId: OTHER_OP }));
      await advanceHandover(store(), OTHER_OP, "abandoned", {});
      expect((await signedStatusOf(await post(envelopeOf()))).operationId).toBe(OP);
    });
  });

  describe("the spare's duty", () => {
    function appTelling(onOfferRecorded: () => void): Hono {
      const told = new Hono();
      mountHandoverDestinationApi(
        told,
        {
          db: suite.db,
          node: suite.node,
          ring: RING,
          nodeId: self,
          stateDir,
          migrationsRoot: null,
        },
        () => undefined,
        onOfferRecorded,
      );
      return told;
    }
    const offer = (to: Hono, raw: unknown) =>
      to.request("/api/node/handover/offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(raw),
      });

    it("is told of an offer once the operation is on disk", async () => {
      const states: Promise<unknown>[] = [];
      const told = appTelling(() => {
        states.push(readHandoverOperation(suite.node, self, OP));
      });
      const response = await offer(told, envelopeOf());
      expect(response.status).toBe(200);
      expect(states).toHaveLength(1);
      expect(await states[0]).toMatchObject({ state: "prepared" });
    });

    it("is not told of an offer that is refused", async () => {
      const telling = vi.fn();
      const response = await offer(appTelling(telling), envelopeOf({ scenario: "emergency" }));
      expect(response.status).toBe(400);
      expect(telling).not.toHaveBeenCalled();
    });
  });

  describe("the signer", () => {
    it("refuses a signer this box holds no key for", async () => {
      const envelope = envelopeOf({ sourceNodeId: STRANGER.nodeId }, STRANGER);
      expect(await post(envelope)).toEqual(refusal(403, "handover.peer_unknown"));
      await expectNothingRecorded();
    });

    it("refuses a signature that does not cover the body", async () => {
      const envelope = envelopeOf();
      const tampered = {
        ...envelope,
        body: { binding: { ...binding, scenario: "emergency" }, authorisedBy: PERSON },
      };
      expect(await post(tampered)).toEqual(refusal(403, "handover.peer_unknown"));
      await expectNothingRecorded();
    });

    it("checks the signer before anything the body says", async () => {
      const envelope = envelopeOf({ destinationNodeId: BYSTANDER.nodeId }, STRANGER);
      expect(await post(envelope)).toEqual(refusal(403, "handover.peer_unknown"));
    });

    it("refuses a box it trusts that is not the binding's source", async () => {
      expect(await post(envelopeOf({}, BYSTANDER))).toEqual(
        refusal(400, "handover.request_invalid", { field: "sourceNodeId" }),
      );
      await expectNothingRecorded();
    });
  });

  describe("a source the held chart does not name as the main box", () => {
    it("refuses an endorsed spare naming itself as the source, recording nothing", async () => {
      const envelope = envelopeOf({ sourceNodeId: BYSTANDER.nodeId }, BYSTANDER);
      expect(await post(envelope)).toEqual(
        refusal(409, "handover.membership_mismatch", { operationId: OP }),
      );
      await expectNothingRecorded();
    });

    it("says first that a box which is not a mirror is not a spare", async () => {
      await setNodeMode({ venue: suite.db, node: suite.node }, self, "primary");
      const envelope = envelopeOf({ sourceNodeId: BYSTANDER.nodeId }, BYSTANDER);
      expect(await post(envelope)).toEqual(refusal(409, "handover.not_a_spare"));
    });
  });

  describe("the destination", () => {
    it("refuses an offer naming another destination", async () => {
      expect(await post(envelopeOf({ destinationNodeId: BYSTANDER.nodeId }))).toEqual(
        refusal(400, "handover.request_invalid", { field: "destinationNodeId" }),
      );
      await expectNothingRecorded();
    });
  });

  describe("the request's shape", () => {
    it.each([
      ["text that is not JSON", "{not json"],
      ["no envelope at all", "{}"],
    ])("refuses %s", async (_name, raw) => {
      expect(await post(raw)).toEqual(
        refusal(400, "handover.request_invalid", { field: "envelope" }),
      );
    });

    it("refuses an envelope signed for another purpose", async () => {
      expect(await post(envelopeOf({}, SOURCE, "query"))).toEqual(
        refusal(400, "handover.request_invalid", { field: "envelope" }),
      );
      await expectNothingRecorded();
    });

    it.each([
      ["a list", [], "body"],
      ["nothing", null, "body"],
      ["no binding", { authorisedBy: PERSON }, "body"],
      ["no person", { binding: "later" }, "body"],
      ["an extra key", { binding: "later", authorisedBy: PERSON, extra: 1 }, "body"],
      [
        "a person that is not an id",
        { binding: "later", authorisedBy: "someone", settings: SETTINGS, imageMigrations: IMAGE },
        "authorisedBy",
      ],
      [
        "a person that is not text",
        { binding: "later", authorisedBy: 7, settings: SETTINGS, imageMigrations: IMAGE },
        "authorisedBy",
      ],
    ])("refuses a body holding %s", async (_name, shape, field) => {
      const body =
        shape !== null && !Array.isArray(shape) && "binding" in shape
          ? { ...shape, binding }
          : shape;
      const envelope = signEnvelope("stepdown", body as unknown as CanonicalValue, SOURCE);
      expect(await post(envelope)).toEqual(refusal(400, "handover.request_invalid", { field }));
      await expectNothingRecorded();
    });

    it("refuses a binding the parser refuses", async () => {
      const envelope = signEnvelope(
        "stepdown",
        {
          binding: { ...binding, scenario: "other" },
          authorisedBy: PERSON,
          settings: SETTINGS,
          imageMigrations: IMAGE,
        } as CanonicalValue,
        SOURCE,
      );
      expect(await post(envelope)).toEqual(
        refusal(400, "handover.request_invalid", { field: "scenario" }),
      );
      await expectNothingRecorded();
    });

    it("refuses an otherwise valid emergency offer, recording nothing", async () => {
      expect(await post(envelopeOf({ scenario: "emergency" }))).toEqual(
        refusal(400, "handover.request_invalid", { field: "scenario" }),
      );
      await expectNothingRecorded();
    });

    it("refuses an emergency offer even when this box holds that operation", async () => {
      await beginHandover(store(), { ...binding, scenario: "emergency" }, "destination");
      expect(await post(envelopeOf({ scenario: "emergency" }))).toEqual(
        refusal(400, "handover.request_invalid", { field: "scenario" }),
      );
      expect(events()).toEqual([]);
    });

    // A later step names a folder after the operation id.
    it.each([
      ["climbs out of its folder", "../x"],
      ["names a folder below", "a/b"],
      ["climbs out, shaped like an id", "../aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa"],
      ["is empty", ""],
      ["is over-long", `${OP}${"a".repeat(64)}`],
      ["ends in a line break", `${OP}\n`],
      ["is an id in capitals", OP.toUpperCase()],
    ])("refuses an operation id that %s, recording nothing", async (_name, operationId) => {
      expect(await post(envelopeOf({ operationId }))).toEqual(
        refusal(400, "handover.request_invalid", { field: "operationId" }),
      );
      expect(events()).toEqual([]);
      expect(suite.node.all(sql`select 1 from node_handover_operations`)).toEqual([]);
    });
  });

  describe("on a box that is not a mirror", () => {
    it("refuses `handover.not_a_spare`", async () => {
      await setNodeMode({ venue: suite.db, node: suite.node }, self, "primary");
      expect(await post(envelopeOf())).toEqual(refusal(409, "handover.not_a_spare"));
      await expectNothingRecorded();
    });

    it("says so before comparing the chart", async () => {
      await setNodeMode({ venue: suite.db, node: suite.node }, self, "primary");
      const membership = { term: 2, digest: binding.membership.digest };
      expect(await post(envelopeOf({ membership }))).toEqual(refusal(409, "handover.not_a_spare"));
    });
  });

  describe("a binding that differs from this box's own", () => {
    it.each([
      ["the term", (b: HandoverBinding) => ({ membership: { ...b.membership, term: 2 } })],
      [
        "the chart's digest",
        (b: HandoverBinding) => ({ membership: { ...b.membership, digest: "0".repeat(64) } }),
      ],
      ["the tax number", (b: HandoverBinding) => ({ venue: { ...b.venue, taxId: "B00000000" } })],
      ["the country", (b: HandoverBinding) => ({ venue: { ...b.venue, country: "PT" } })],
      [
        "the environment",
        (b: HandoverBinding) => ({ venue: { ...b.venue, environment: "production" as const } }),
      ],
    ])("refuses a different %s", async (_name, change) => {
      expect(await post(envelopeOf(change(binding)))).toEqual(
        refusal(409, "handover.membership_mismatch", { operationId: OP }),
      );
      await expectNothingRecorded();
    });
  });

  it("refuses a box holding no chart as a mismatch, not a fault", async () => {
    await pinMainBoxKey(suite.node, self, SOURCE);
    suite.db.run(sql`delete from node_membership`);
    expect(await post(envelopeOf())).toEqual(
      refusal(409, "handover.membership_mismatch", { operationId: OP }),
    );
    await expectNothingRecorded();
  });

  describe("another operation", () => {
    it("two identical offers at once get one answer and record one operation", async () => {
      const envelope = envelopeOf();
      const [first, second] = await Promise.all([post(envelope), post(envelope)]);
      expect((await signedStatusOf(first)).state).toBe("prepared");
      expect((await signedStatusOf(second)).state).toBe("prepared");
      expect(events()).toHaveLength(1);
    });

    it("refuses a controlled offer while an emergency operation is open", async () => {
      await beginHandover(
        store(),
        { ...binding, operationId: OTHER_OP, scenario: "emergency" },
        "destination",
      );
      expect(await post(envelopeOf())).toEqual(
        refusal(409, "handover.operation_in_progress", { operationId: OTHER_OP }),
      );
    });

    it("refuses `handover.operation_in_progress` while another is open", async () => {
      await post(envelopeOf({ operationId: OTHER_OP }));
      expect(await post(envelopeOf())).toEqual(
        refusal(409, "handover.operation_in_progress", { operationId: OTHER_OP }),
      );
      expect(await readHandoverOperation(suite.node, self, OP)).toBeNull();
      expect(events().map((event) => event.operationId)).toEqual([OTHER_OP]);
    });

    it("refuses `handover.operation_conflict` for this id under another binding", async () => {
      await beginHandover(
        store(),
        { ...binding, membership: { ...binding.membership, term: 2 } },
        "destination",
      );
      expect(await post(envelopeOf())).toEqual(
        refusal(409, "handover.operation_conflict", { operationId: OP }),
      );
      expect(events()).toEqual([]);
    });
  });

  describe("the image the offer names", () => {
    const offerNaming = (imageMigrations: unknown) =>
      signEnvelope(
        "stepdown",
        {
          binding,
          authorisedBy: PERSON,
          settings: SETTINGS,
          imageMigrations,
        } as unknown as CanonicalValue,
        SOURCE,
      );
    const onImage = async (root: string): Promise<Hono> => {
      const built = new Hono();
      mountHandoverDestinationApi(
        built,
        {
          db: suite.db,
          node: suite.node,
          ring: RING,
          nodeId: self,
          stateDir,
          migrationsRoot: root,
        },
        () => undefined,
      );
      return built;
    };
    const offerTo = async (to: Hono, raw: unknown) => {
      const response = await to.request("/api/node/handover/offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(raw),
      });
      return { status: response.status, body: await response.json() };
    };

    it("a spare on an image one migration behind refuses, recording nothing", async () => {
      const root = join(stateDir, "older-image");
      await copyImageMigrations(root, "fiscal-verifactu");
      // Failing case: 200, and a `prepared` row with the old box about to stop.
      expect(await offerTo(await onImage(root), envelopeOf())).toEqual(
        refusal(409, "handover.modules_differ"),
      );
      await expectNothingRecorded();
    });

    it("control: a spare on an equal image at another path accepts", async () => {
      const root = join(stateDir, "same-image");
      await copyImageMigrations(root);
      expect(imageMigrationsDigest(root)).toBe(IMAGE);
      const answer = await offerTo(await onImage(root), envelopeOf());
      expect(answer.status).toBe(200);
      expect(await readHandoverOperation(suite.node, self, OP)).toMatchObject({
        state: "prepared",
      });
    });

    it("an offer naming another digest is refused", async () => {
      expect(await post(offerNaming("a".repeat(64)))).toEqual(
        refusal(409, "handover.modules_differ"),
      );
      await expectNothingRecorded();
    });

    it.each([
      ["not a digest", "abc"],
      ["in capitals", "A".repeat(64)],
      ["a number", 7],
      ["nothing", null],
    ])("an image digest that is %s is a malformed request", async (_label, value) => {
      expect(await post(offerNaming(value))).toEqual(
        refusal(400, "handover.request_invalid", { field: "imageMigrations" }),
      );
      await expectNothingRecorded();
    });

    it("an offer that names no image is a malformed request", async () => {
      const envelope = signEnvelope(
        "stepdown",
        { binding, authorisedBy: PERSON, settings: SETTINGS } as unknown as CanonicalValue,
        SOURCE,
      );
      expect(await post(envelope)).toEqual(
        refusal(400, "handover.request_invalid", { field: "body" }),
      );
    });
  });

  describe("the settings the offer carries", () => {
    const DIGEST = "a".repeat(64);
    const offerWith = (settings: unknown, overrides: Partial<HandoverBinding> = {}) =>
      signEnvelope(
        "stepdown",
        {
          binding: { ...binding, ...overrides },
          authorisedBy: PERSON,
          settings,
          imageMigrations: IMAGE,
        } as unknown as CanonicalValue,
        SOURCE,
      );

    it.each([
      ["not an object", "digest", "settings"],
      ["a list", [], "settings"],
      ["nothing", null, "settings"],
      ["a missing key", { backupSettings: null, moduleSettings: null }, "settings"],
      ["an extra key", { ...SETTINGS, extra: 1 }, "settings"],
      [
        "a backup digest that is not a digest",
        { ...SETTINGS, backupSettings: "abc" },
        "settings.backupSettings",
      ],
      [
        "a backup digest in capitals",
        { ...SETTINGS, backupSettings: "A".repeat(64) },
        "settings.backupSettings",
      ],
      [
        "a module digest that is a number",
        { ...SETTINGS, moduleSettings: 7 },
        "settings.moduleSettings",
      ],
      ["a ring that is not a list", { ...SETTINGS, ringVersions: 1 }, "settings.ringVersions"],
      ["a ring with no versions", { ...SETTINGS, ringVersions: [] }, "settings.ringVersions"],
      ["a ring version of nought", { ...SETTINGS, ringVersions: [0] }, "settings.ringVersions"],
      ["a fractional ring version", { ...SETTINGS, ringVersions: [1.5] }, "settings.ringVersions"],
      ["a ring version as text", { ...SETTINGS, ringVersions: ["1"] }, "settings.ringVersions"],
    ])("refuses settings that are %s, recording nothing", async (_name, settings, field) => {
      expect(await post(offerWith(settings))).toEqual(
        refusal(400, "handover.request_invalid", { field }),
      );
      await expectNothingRecorded();
    });

    it("refuses an offer with settings and an extra key", async () => {
      const envelope = signEnvelope(
        "stepdown",
        {
          binding,
          authorisedBy: PERSON,
          settings: SETTINGS,
          extra: 1,
        } as unknown as CanonicalValue,
        SOURCE,
      );
      expect(await post(envelope)).toEqual(
        refusal(400, "handover.request_invalid", { field: "body" }),
      );
      await expectNothingRecorded();
    });

    it.each([
      ["backup settings", { backupSettings: DIGEST }, "handover.backup_settings_differ"],
      ["module settings", { moduleSettings: DIGEST }, "handover.modules_differ"],
      ["a ring version this box lacks", { ringVersions: [1, 2] }, "handover.key_ring_mismatch"],
    ])("a difference in %s refuses and records nothing", async (_name, change, code) => {
      expect(await post(offerWith({ ...SETTINGS, ...change }))).toEqual(refusal(409, code));
      await expectNothingRecorded();
    });

    it("a ring version this box holds beyond the offer's is no difference", async () => {
      const ring = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x8).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "2",
        WAITRON_CREDENTIALS_KEY_PREVIOUS: Buffer.alloc(32, 0x7).toString("base64"),
        WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
      });
      const rotated = new Hono();
      mountHandoverDestinationApi(
        rotated,
        { db: suite.db, node: suite.node, ring, nodeId: self, stateDir, migrationsRoot: null },
        () => undefined,
      );
      const response = await rotated.request("/api/node/handover/offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelopeOf()),
      });
      expect(response.status).toBe(200);
      expect(await readHandoverOperation(suite.node, self, OP)).toMatchObject({
        state: "prepared",
      });
    });

    it("the checks already there come first", async () => {
      const differing = { ...SETTINGS, backupSettings: DIGEST };
      expect(await post(offerWith(differing, { membership: { term: 9, digest: DIGEST } }))).toEqual(
        refusal(409, "handover.membership_mismatch", { operationId: OP }),
      );
      await setNodeMode({ venue: suite.db, node: suite.node }, self, "primary");
      expect(await post(offerWith(differing))).toEqual(refusal(409, "handover.not_a_spare"));
      await expectNothingRecorded();
    });

    it("a replay of a stored operation answers its stored status, whatever the settings are now", async () => {
      const first = await post(envelopeOf());
      await writeFile(join(stateDir, "backup.env"), "ARCHIVE_RETAIN=5\n");
      expect(await post(envelopeOf())).toEqual(first);
      await seedModuleDocument(suite.db, { modules: null });
      expect(await post(envelopeOf())).toEqual(first);
      expect(events()).toHaveLength(1);
    });

    describe("this box's own bad file", () => {
      const unreadableFile = refusal(409, "handover.destination_settings_unreadable", {
        file: "settings:modules",
      });

      it.each([
        ["settings:modules", "not json"],
        ["settings:modules", JSON.stringify({ modules: "every one" })],
        ["module-preparation-state.json", "not json"],
        ["module-preparation-state.json", JSON.stringify({ version: 2, revisions: [] })],
      ])("a damaged %s refuses and records nothing: %s", async (file, text) => {
        await writeSettingsSource(file, text);
        expect(await post(envelopeOf())).toEqual({
          ...unreadableFile,
          body: { error: { ...unreadableFile.body.error, params: { file } } },
        });
        await expectNothingRecorded();
      });

      it("a state folder that is gone refuses and records nothing", async () => {
        const envelope = envelopeOf();
        await rm(stateDir, { recursive: true });
        expect(await post(envelope)).toEqual(
          refusal(409, "handover.destination_settings_unreadable", { file: "backup.env" }),
        );
        await expectNothingRecorded();
      });

      it.each(["backup.env", "module-preparation-state.json"])(
        "%s being a folder rather than a file refuses and records nothing",
        async (file) => {
          await mkdir(join(stateDir, file));
          expect(await post(envelopeOf())).toEqual(
            refusal(409, "handover.destination_settings_unreadable", { file }),
          );
          await expectNothingRecorded();
        },
      );

      it.skipIf(process.getuid?.() === 0).each(["backup.env", "module-preparation-state.json"])(
        "%s with no read permission refuses and records nothing",
        async (file) => {
          await writeFile(join(stateDir, file), "{}");
          await chmod(join(stateDir, file), 0o000);
          expect(await post(envelopeOf())).toEqual(
            refusal(409, "handover.destination_settings_unreadable", { file }),
          );
          await expectNothingRecorded();
        },
      );
    });
  });
});
