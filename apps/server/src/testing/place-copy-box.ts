// A spare at `filing_assumed` or `copy_accepted`, and production's real entry to start it with, for
// the test files that run a real start over placing the accepted copy.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import {
  lockVenueDatabase,
  readTenant,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import {
  envelopeDigest,
  sha256Hex,
  signEnvelope,
  signIndicator,
  type HandoverBinding,
  type NodeLocalItem,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  canonicalize,
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
} from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { appendHandoverEventTx, setNodeMode, writeMirrorLink } from "@waitron/node-db";
import type { StartedServer } from "../boot.js";
import { loadBoxEnv } from "../box-env.js";
import { acceptedCopyPath } from "../handover-acceptance.js";
import { advanceHandover, beginHandover, HANDOVER_EVENT } from "../handover-store.js";
import { type assertNotAhead, runEntry } from "../node-entry.js";
import { establishNodeIdentity, readNodeIdentityKey } from "../node-identity.js";
import { readRecoveryState, writeRecoveryState } from "../recovery-state.js";
import { mintSelfSignedServerCert } from "../self-signed-cert.js";
import { pinMainBoxKey } from "./pinned-main-box.js";
import { setupVenue } from "./venue-fixtures.js";

export const PLACE_COPY_MIGRATIONS = migrationOptionsFor(manifestSets(), null);
const MAIN_BOX = { nodeId: "00000000-0000-4000-8000-0000000000bb", ...generateNodeKeyPair() };
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTHORISER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const THIRD_BOX = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** The accepted copy and the old mirror database tell apart by this, in the file's own header. */
export const ACCEPTED_VERSION = 777;
export const OLD_VERSION = 111;

export const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export function userVersion(path: string): number {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return (raw.prepare("pragma user_version").get() as { user_version: number }).user_version;
  } finally {
    raw.close();
  }
}

/** Real frames in `-wal`, as a killed process leaves them: a clean close would checkpoint them. */
function leaveCommittedRowInWal(live: string): void {
  const writer = new DatabaseSync(live);
  writer.exec(
    "pragma journal_mode = wal; pragma wal_autocheckpoint = 0; create table old_mirror_row_in_wal(a); insert into old_mirror_row_in_wal values (1);",
  );
  const kept = mkdtempSync(join(tmpdir(), "waitron-boot-place-wal-"));
  for (const suffix of ["", "-wal", "-shm"]) copyFileSync(live + suffix, join(kept, `x${suffix}`));
  writer.close();
  for (const suffix of ["", "-wal", "-shm"]) copyFileSync(join(kept, `x${suffix}`), live + suffix);
  rmSync(kept, { recursive: true });
}

/** A chart delivered to this box and stored by its real route, written with the box off. */
export function holdChart(databasePath: string, document: unknown): void {
  const raw = new DatabaseSync(databasePath);
  try {
    raw
      .prepare("update node_membership set document = ?, term = ? where id = 1")
      .run(JSON.stringify(document), (document as { body: { term: number } }).body.term);
  } finally {
    raw.close();
  }
}

export function handoverRow(b: Box): { state: string; waitingReason: string | null } {
  const raw = new DatabaseSync(join(b.venueDir, "node.db"), { readOnly: true });
  try {
    const row = raw.prepare("select state, waiting_reason from node_handover_operations").get() as {
      state: string;
      waiting_reason: string | null;
    };
    return { state: row.state, waitingReason: row.waiting_reason };
  } finally {
    raw.close();
  }
}

export function copyPlacedEvents(b: Box): number {
  const raw = new DatabaseSync(join(b.venueDir, "node.db"), { readOnly: true });
  try {
    return (
      raw
        .prepare("select count(*) as n from node_handover_events where kind = ?")
        .get(HANDOVER_EVENT.copyPlaced) as { n: number }
    ).n;
  } finally {
    raw.close();
  }
}

export interface StartResult {
  started?: StartedServer;
  page?: string;
  thrown?: { code?: string; message?: string };
}

const makeSeams = (restart: () => void = () => {}) => ({
  timings: { minTickMs: 200, maxTickMs: 600_000 },
  // Beside a real chart whose other box is not running.
  peerCheck: async () => ({ result: "proceed" as const, successorNodeId: null }),
  stepdown: { mount: () => {}, restart },
});

interface BoxOptions {
  mode?: "mirror" | "primary";
  /** `copy_accepted` leaves the relinquishment still to come, from `contactUrl`'s old box. */
  state?: "filing_assumed" | "copy_accepted";
  /** The folder the venue and state folders go in, for a box on a small disk. */
  on?: string;
  /** Makes the accepted copy at least this large. */
  acceptedBytes?: number;
  /** A chart the old box's copy holds that has this standing for the old box, signed by it. */
  copyNamesOldBox?: MembershipDocumentBody["nodes"][number]["standing"];
}

export type Box = Awaited<ReturnType<ReturnType<typeof placeCopyBoxes>["buildBox"]>>;

export function placeCopyBoxes(deps: {
  suite: { db: Database; node: NodeDatabase };
  beforeServerStarts: () => void;
  startServer: (
    env: NodeJS.ProcessEnv,
    base: NodeJS.ProcessEnv | undefined,
    seams: ReturnType<typeof makeSeams>,
  ) => Promise<StartedServer>;
}) {
  const { suite, beforeServerStarts, startServer } = deps;
  const scratchRoots: string[] = [];
  let oldBox: Server | undefined;

  function databaseWithVersion(target: string, version: number, makeFrom: string, bytes = 0): void {
    suite.db.run(sql`vacuum into ${makeFrom}`);
    const raw = new DatabaseSync(makeFrom);
    if (bytes > 0) {
      raw.exec("create table test_filler(a)");
      raw.prepare("insert into test_filler values (randomblob(?))").run(bytes);
    }
    raw.exec(`pragma user_version = ${version}; vacuum into '${target}'`);
    raw.close();
    rmSync(makeFrom);
  }

  /** A signed relinquishment for whatever acceptance it is posted: the old box, reduced to that. */
  async function startOldBox(self: () => string): Promise<{ url: string; posts: string[] }> {
    const posts: string[] = [];
    oldBox = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      req.on("end", () => {
        const acceptance = JSON.parse(raw) as SignedHandoverEnvelope<{
          binding: CanonicalValue;
          indicatorDigest: string;
        }>;
        posts.push(raw);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify(
            signEnvelope(
              "relinquishment",
              {
                binding: acceptance.body.binding,
                indicatorDigest: acceptance.body.indicatorDigest,
                acceptanceDigest: envelopeDigest(acceptance),
                filingAssignedTo: self(),
                authorisedBy: AUTHORISER,
              },
              MAIN_BOX,
            ),
          ),
        );
      });
    });
    await new Promise<void>((resolve) => oldBox!.listen(0, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${(oldBox.address() as AddressInfo).port}`, posts };
  }

  async function buildBox(options: BoxOptions = {}) {
    const { mode = "mirror", state = "filing_assumed" } = options;
    beforeServerStarts();
    const venue = await setupVenue(suite.db);
    const nodeId = venue.cfg.nodeId;
    const ring = loadKeyRing(KEY_ENV);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
    const own = await readNodeIdentityKey(suite.node, ring, nodeId);
    await pinMainBoxKey(suite.node, nodeId, MAIN_BOX);
    const old =
      state === "copy_accepted"
        ? await startOldBox(() => nodeId)
        : { url: "http://127.0.0.1:1", posts: [] };
    const body: MembershipDocumentBody = {
      term: 3,
      nodes: [
        { nodeId: MAIN_BOX.nodeId, contactUrl: old.url, standing: "serving-primary" },
        { nodeId, contactUrl: "https://spare.example", standing: "serving-secondary" },
      ],
    };
    const endorsements = [
      endorseKey(nodeId, nodeSigningPublicKey(own), MAIN_BOX.nodeId, MAIN_BOX.privateKey),
    ];
    const signedChart = (chartBody: MembershipDocumentBody) => ({
      body: chartBody,
      signerNodeId: MAIN_BOX.nodeId,
      signature: signDocumentBody(chartBody, MAIN_BOX.privateKey),
      endorsements,
    });
    /** The chart a third box's promotion leaves: this standing for the old box, the third box main. */
    const movedOnChart = (
      term: number,
      standing: MembershipDocumentBody["nodes"][number]["standing"] = "sell-only",
    ) =>
      signedChart({
        term,
        nodes: [
          { nodeId: MAIN_BOX.nodeId, contactUrl: old.url, standing },
          { nodeId, contactUrl: "https://spare.example", standing: "serving-secondary" },
          { nodeId: THIRD_BOX, contactUrl: "https://third.example", standing: "serving-primary" },
        ],
      });
    /** A newer chart with the old box the main box again, signed by a key this box's route trusts. */
    const chartNamingOldBox = (term: number) => {
      const chartBody = { ...body, term };
      return {
        body: chartBody,
        signerNodeId: nodeId,
        signature: signDocumentBody(chartBody, own),
        endorsements: [endorseKey(MAIN_BOX.nodeId, MAIN_BOX.publicKey, nodeId, own)],
      };
    };
    const held = signedChart(body);
    await writeNodeMembership(suite.db, held);
    await stampDeployment(suite.db, "preproduction");
    const tenant = (await readTenant(suite.db))!;
    const binding: HandoverBinding = {
      operationId: OP,
      scenario: "controlled",
      venue: { country: tenant.country, taxId: tenant.taxId, environment: "preproduction" },
      sourceNodeId: MAIN_BOX.nodeId,
      destinationNodeId: nodeId,
      membership: { term: 3, digest: sha256Hex(canonicalize(held as unknown as CanonicalValue)) },
    };
    const store = { node: suite.node, nodeId };
    await beginHandover(store, binding, "destination");
    await setNodeMode({ venue: suite.db, node: suite.node }, nodeId, mode);
    await writeMirrorLink(suite.node, nodeId, {
      originUrl: "http://127.0.0.1:1/",
      boxHostname: "box.local",
      boxCaPem: mintSelfSignedServerCert({
        hostnames: ["box.local"],
        ipAddresses: [],
        now: new Date(),
      }).caCertPem,
      originNodeId: MAIN_BOX.nodeId,
    });

    const root = mkdtempSync(join(tmpdir(), "waitron-boot-place-"));
    scratchRoots.push(root);
    const home = options.on ?? root;
    scratchRoots.push(home);
    const venueDir = join(home, "venue");
    const stateDir = join(home, "state");
    mkdirSync(venueDir);
    mkdirSync(stateDir);
    const accepted = acceptedCopyPath(stateDir, OP);
    mkdirSync(join(stateDir, "handover", OP), { recursive: true });
    // Made outside `home`, whose disk may have room for one copy of this and no more.
    const built = join(root, "accepted-built.db");
    databaseWithVersion(built, ACCEPTED_VERSION, `${built}.raw`, options.acceptedBytes);
    if (options.copyNamesOldBox !== undefined) {
      holdChart(built, movedOnChart(3, options.copyNamesOldBox));
    }
    copyFileSync(built, accepted);
    rmSync(built);

    const nodeLocal: NodeLocalItem[] = [
      { item: "backup.env", where: "state", class: "transferred", treatment: "x", sha256: null },
      { item: "modules.json", where: "state", class: "transferred", treatment: "x", sha256: null },
      {
        item: "secrets.env",
        where: "state",
        class: "transferred",
        treatment: "x",
        ringVersions: [1],
      },
      {
        item: "module-preparation-state.json",
        where: "state",
        class: "transferred",
        treatment: "merged",
        revisions: [],
      },
    ];
    const envelope = signIndicator(
      {
        binding,
        snapshot: {
          sha256: sha(accepted),
          bytes: statSync(accepted).size,
          schema: [],
          modules: [],
        },
        nodeLocal,
        modulesSummary: {},
        capturedAtMs: 1,
      },
      { nodeId: MAIN_BOX.nodeId, privateKey: MAIN_BOX.privateKey },
    );
    await withNodeTransaction(suite.node, async (tx) => {
      await appendHandoverEventTx(tx, {
        nodeId,
        operationId: OP,
        kind: HANDOVER_EVENT.finalState,
        detail: {},
        envelope: JSON.stringify(envelope),
      });
      await appendHandoverEventTx(tx, {
        nodeId,
        operationId: OP,
        kind: HANDOVER_EVENT.offer,
        detail: {},
        envelope: canonicalize({ body: { authorisedBy: AUTHORISER } }),
      });
    });
    const acceptance = signEnvelope(
      "acceptance",
      {
        binding: binding as unknown as CanonicalValue,
        indicatorDigest: "d".repeat(64),
        acceptedAtMs: 1,
      },
      { nodeId, privateKey: own },
    );
    await advanceHandover(store, OP, "copy_accepted", {}, acceptance);
    if (state === "filing_assumed") await advanceHandover(store, OP, "filing_assumed", {});

    const live = join(venueDir, "venue.db");
    databaseWithVersion(live, OLD_VERSION, `${live}.raw`);
    leaveCommittedRowInWal(live);
    mkdirSync(join(venueDir, ".venue.db-litestream"));
    writeFileSync(join(venueDir, ".venue.db-litestream", "generation"), "old");
    suite.node.run(sql`vacuum into ${join(venueDir, "node.db")}`);
    const note = join(stateDir, "backup-room-note.json");
    writeFileSync(note, "{}");
    // The lock file exists before anything happens, as on a box that has run.
    (await lockVenueDatabase(venueDir)).release();

    const migrationsRoot = join(root, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      cpSync(PLACE_COPY_MIGRATIONS[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    writeFileSync(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const env: Record<string, string> = {
      ...KEY_ENV,
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_NODE_ID: nodeId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
      WAITRON_LOG_DIR: join(stateDir, "logs"),
    };
    return {
      root,
      venueDir,
      stateDir,
      accepted,
      live,
      note,
      env,
      nodeId,
      migrationsRoot,
      old,
      movedOnChart,
      chartNamingOldBox,
    };
  }

  const startSeams = makeSeams;

  /** Production's real entry, every check on: only the listener and the process's own exit are not. */
  async function entryStart(
    b: Box,
    overrides: {
      env?: Record<string, string>;
      restart?: () => void;
      assertNotAhead?: typeof assertNotAhead;
      installShutdownHandlers?: () => void;
    } = {},
  ): Promise<StartResult> {
    const result: StartResult = {};
    try {
      await runEntry({
        args: [],
        baseEnv: overrides.env ?? b.env,
        stateDir: b.stateDir,
        venueDir: b.venueDir,
        logDir: join(b.stateDir, "logs"),
        migrationsRoot: b.migrationsRoot,
        loadBoxEnv,
        readRecoveryState,
        writeRecoveryState,
        startServer: async (env, base) => {
          result.started = await startServer(env, base, startSeams(overrides.restart));
          return result.started;
        },
        assertNotAhead: overrides.assertNotAhead,
        serveRecovery: async (app) => {
          result.page = await (await app.request("/")).text();
        },
        installShutdownHandlers: overrides.installShutdownHandlers ?? (() => {}),
        scheduleStayedUp: () => {},
        log: () => {},
        exit: () => {},
        spareBytes: 0,
      });
    } catch (error) {
      result.thrown = error as { code?: string; message?: string };
    }
    return result;
  }

  async function cleanUp(): Promise<void> {
    await new Promise<void>((resolve) => {
      oldBox?.closeAllConnections();
      if (oldBox === undefined) resolve();
      else oldBox.close(() => resolve());
    });
    oldBox = undefined;
    for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  }

  return { buildBox, entryStart, startSeams, cleanUp };
}
