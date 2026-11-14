import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadKeyRing, sealNodeSigningKeyTx } from "@waitron/credentials";
import { CORE_MIGRATIONS, nodes, withNodeTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { sha256Hex } from "@waitron/handover";
import { generateNodeKeyPair, signDocumentBody } from "@waitron/membership";
import { NODE_MIGRATIONS, pinPrimaryKeyTx } from "@waitron/node-db";
import { SPARE_FOLLOW_DIR, VENUE_FILE } from "@waitron/store";
import { followedCopyId, stageFollowedAsCopy } from "./handover-copy-from-follow.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const main = generateNodeKeyPair();
const spare = generateNodeKeyPair();
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 6).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const mainId = "d5000000-0000-4000-8000-000000000001";
const nodeId = "d5000000-0000-4000-8000-000000000002";
const position = { generation: "generation-a", appliedTXID: "0000000000000003" };
let root: string;
let input: string;
const body = () => ({
  term: 1,
  nodes: [
    { nodeId: mainId, standing: "serving-primary" as const, contactUrl: "https://main.example" },
    { nodeId, standing: "serving-secondary" as const, contactUrl: "https://spare.example" },
  ],
});
const chart = async (value = body()) =>
  writeNodeMembership(suite.db, {
    body: value,
    signerNodeId: mainId,
    signature: signDocumentBody(value, main.privateKey),
    endorsements: [],
  });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "followed-handover-"));
  input = join(root, SPARE_FOLLOW_DIR, VENUE_FILE);
  await seedVenue(suite.db, { invoiceLocales: ["en"] });
  await suite.db.insert(nodes).values([
    { id: mainId, name: "Main", publicKey: main.publicKey },
    { id: nodeId, name: "Spare", publicKey: spare.publicKey },
  ]);
  await chart();
  await withNodeTransaction(suite.node, async (tx) => {
    await sealNodeSigningKeyTx(tx, ring, nodeId, spare.privateKey);
    await pinPrimaryKeyTx(tx, nodeId, { primaryNodeId: mainId, publicKey: main.publicKey });
  });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The follower's output: Litestream writes the older journal header on the pages it applies. */
async function followedOutput(): Promise<Buffer> {
  await mkdir(join(root, SPARE_FOLLOW_DIR), { recursive: true });
  await rm(input, { force: true });
  await suite.db.archiveTo(input);
  const bytes = await readFile(input);
  bytes[18] = 1;
  bytes[19] = 1;
  await writeFile(input, bytes);
  await writeFile(`${input}-txid`, `${position.appliedTXID}\n`);
  return bytes;
}
const stage = () =>
  stageFollowedAsCopy(
    {
      db: suite.db,
      node: suite.node,
      ring,
      nodeId,
      stateDir: root,
      modules: [],
      migrationsRoot: null,
    },
    { path: input, ...position },
  );
const noMarker = () =>
  expect(stat(join(root, "pair-copy", "ready.json"))).rejects.toMatchObject({ code: "ENOENT" });

it("stages a checked followed copy under its position's id", async () => {
  const bytes = await followedOutput();
  expect(followedCopyId(position)).toBe(sha256Hex("generation-a:0000000000000003"));
  const selection = await stage();
  expect(selection).toEqual({ source: "followed-copy", sourceId: followedCopyId(position) });
  expect(JSON.parse(await readFile(join(root, "pair-copy", "ready.json"), "utf8"))).toEqual(
    selection,
  );
  expect(await readFile(join(root, "pair-copy", VENUE_FILE))).toEqual(bytes);
  expect(await readFile(input)).toEqual(bytes);
});

it("refuses a damaged copy and stages nothing", async () => {
  const bytes = await followedOutput();
  const pageSize = bytes.readUInt16BE(16);
  bytes.fill(0xa5, pageSize, 2 * pageSize);
  await writeFile(input, bytes);
  await expect(stage()).rejects.toMatchObject({ code: "handover.copy_damaged" });
  await noMarker();
});

it("refuses a copy whose chart does not admit this spare", async () => {
  const value = body();
  value.nodes.pop();
  await chart(value);
  await followedOutput();
  await chart();
  await expect(stage()).rejects.toMatchObject({ code: "handover.copy_predates_destination" });
  await noMarker();
});
