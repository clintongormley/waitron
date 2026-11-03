import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureError,
  CORE_MIGRATIONS,
  nodes,
  withNodeTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, type KeyRing } from "@waitron/credentials";
import {
  sha256Hex,
  verifyEnvelope,
  type FinalStateIndicator,
  type HandoverBinding,
} from "@waitron/handover";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import {
  appendHandoverEventTx,
  NODE_MIGRATIONS,
  nodeHandoverEvents,
  nodeHandoverRestriction,
  recordHandoverRestrictionTx,
} from "@waitron/node-db";
import {
  CAPTURE_REFUSAL_STATUS,
  captureFinalCopy,
  FINAL_STATE_EVENT,
  journalDigest,
  type CaptureDeps,
} from "./handover-capture.js";
import { buildNodeLocalManifest } from "./handover-manifest.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { establishNodeIdentity } from "./node-identity.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x4).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const DESTINATION = "22222222-2222-4222-8222-222222222222";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function probeRows(
  query: Parameters<NonNullable<WaitronModule["handover"]>["summarise"]>[0],
) {
  for await (const row of query.rows("select count(*) as n from handover_probe")) {
    return Number(row.n);
  }
  return -1;
}

const MODULES = [
  {
    name: "core",
    version: "1.2.3",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
    handover: { summarise: async (query) => ({ probeRows: await probeRows(query) }) },
  },
  {
    name: "credentials",
    version: "0.4.0",
    tier: "mandatory",
    migrations: {
      name: "credentials",
      table: "__drizzle_migrations_credentials",
      from: "../credentials/drizzle",
    },
  },
  {
    name: "node",
    version: "0.9.0",
    tier: "mandatory",
    migrations: {
      name: "node",
      table: "__drizzle_migrations_node",
      from: "../node-db/drizzle",
      database: "node",
    },
  },
] as const satisfies readonly WaitronModule[];

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
  setup: async (db) => {
    db.run(sql`create table handover_probe (n integer not null)`);
  },
});

let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-capture-"));
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

function bindingFor(self: string, operationId = OP): HandoverBinding {
  return {
    operationId,
    scenario: "controlled",
    venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
    sourceNodeId: self,
    destinationNodeId: DESTINATION,
    membership: { term: 3, digest: "a".repeat(64) },
  };
}

/** This box, with its signing key, an operation begun as the source, and nothing else. */
async function box(): Promise<string> {
  await seedVenue(suite.db);
  const self = await seedNode(suite.db);
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, self);
  await beginHandover({ node: suite.node, nodeId: self }, bindingFor(self), "source");
  return self;
}

async function restrict(
  self: string,
  row: Partial<{
    operationId: string;
    kind: "handed-over" | "superseded";
    successor: string;
    term: number;
  }> = {},
): Promise<void> {
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: self,
      operationId: row.operationId ?? OP,
      kind: row.kind ?? "handed-over",
      successorNodeId: row.successor ?? DESTINATION,
      membershipTerm: row.term ?? 3,
    }),
  );
}

/** A box that has stepped down for OP, as `stepDown` leaves it. */
async function steppedDown(): Promise<string> {
  const self = await box();
  await advanceHandover({ node: suite.node, nodeId: self }, OP, "source_stepped_down", {});
  await restrict(self);
  return self;
}

function deps(self: string, overrides: Partial<CaptureDeps> = {}): CaptureDeps {
  return {
    venue: suite.db,
    node: suite.node,
    stateDir,
    ring: RING,
    nodeId: self,
    modules: MODULES,
    ...overrides,
  };
}

/**
 * The venue handle, counting copies and running `after` once each copy is written. `foundAtPath`
 * holds, per copy, whether a file already sat at its path when the copy began.
 */
function countingVenue(after: () => void = () => {}): {
  venue: Database;
  copies: () => number;
  foundAtPath: () => boolean[];
} {
  let copies = 0;
  const found: boolean[] = [];
  const venue = new Proxy(suite.db, {
    get: (target, key) => {
      if (key === "archiveTo") {
        return async (path: string) => {
          found.push(existsSync(path));
          await target.archiveTo(path);
          copies++;
          after();
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { venue, copies: () => copies, foundAtPath: () => [...found] };
}

/** The node handle, failing its first write as a crash before the write would. */
function crashingNode(): NodeDatabase {
  let failed = false;
  return new Proxy(suite.node, {
    get: (target, key) => {
      if (key === "withWriteLock") {
        return async <T>(fn: () => Promise<T>) => {
          if (!failed) {
            failed = true;
            throw new Error("the box stopped before the event was written");
          }
          return target.withWriteLock(fn);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Another handle on the same node connection and write queue, with its own single-flight map. */
function otherHandle(): NodeDatabase {
  return new Proxy(suite.node, {
    get: (target, key) => {
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function finalStateEvents(self: string) {
  const rows = await suite.node.select().from(nodeHandoverEvents);
  return rows.filter((row) => row.nodeId === self && row.kind === FINAL_STATE_EVENT);
}

const copyPath = () => join(stateDir, "handover", OP, "venue.db");

describe("capturing a stepped-down box's final copy", () => {
  it("the indicator's digest is the SHA-256 of the file it names", async () => {
    const self = await steppedDown();
    const envelope = await captureFinalCopy(deps(self), OP);
    const bytes = await readFile(copyPath());
    expect(envelope.body.snapshot.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(envelope.body.snapshot.bytes).toBe((await stat(copyPath())).size);
    expect(envelope.body.snapshot.bytes).toBeGreaterThan(0);
  });

  it("the summaries are read from the captured file", async () => {
    const self = await steppedDown();
    suite.db.run(sql`insert into handover_probe (n) values (1), (2)`);
    // A row the live file gains once the copy is written, before anything summarises.
    const { venue } = countingVenue(() => {
      suite.db.run(sql`insert into handover_probe (n) values (3)`);
    });
    const envelope = await captureFinalCopy(deps(self, { venue }), OP);
    expect(envelope.body.modulesSummary).toEqual({ core: { probeRows: 2 } });
    const [live] = await suite.db.all<{ n: number }>(sql`select count(*) as n from handover_probe`);
    expect(live!.n).toBe(3);
  });

  it("a second call returns the same envelope byte for byte", async () => {
    const self = await steppedDown();
    const { venue, copies } = countingVenue();
    const first = await captureFinalCopy(deps(self, { venue }), OP);
    const second = await captureFinalCopy(deps(self, { venue }), OP);
    const text = canonicalize(first as unknown as CanonicalValue);
    expect(canonicalize(second as unknown as CanonicalValue)).toBe(text);
    const events = await finalStateEvents(self);
    expect(events.map((row) => row.envelope)).toEqual([text]);
    expect(events[0]!.operationId).toBe(OP);
    expect(copies()).toBe(1);
  });

  it("two calls at once capture once and record one event", async () => {
    const self = await steppedDown();
    const { venue, copies } = countingVenue();
    const [a, b] = await Promise.all([
      captureFinalCopy(deps(self, { venue }), OP),
      captureFinalCopy(deps(self, { venue }), OP),
    ]);
    expect(canonicalize(b as unknown as CanonicalValue)).toBe(
      canonicalize(a as unknown as CanonicalValue),
    );
    expect(await finalStateEvents(self)).toHaveLength(1);
    expect(copies()).toBe(1);
  });

  it("two captures through separate node handles on one connection record one event and both answer it", async () => {
    const self = await steppedDown();
    const [a, b] = await Promise.all([
      captureFinalCopy(deps(self, { node: otherHandle(), now: () => 1 }), OP),
      captureFinalCopy(deps(self, { node: otherHandle(), now: () => 2 }), OP),
    ]);
    const events = await finalStateEvents(self);
    expect(events).toHaveLength(1);
    expect(canonicalize(a as unknown as CanonicalValue)).toBe(events[0]!.envelope);
    expect(canonicalize(b as unknown as CanonicalValue)).toBe(events[0]!.envelope);
  });

  it("a crash between the copy and the event: the next call captures again and records one event", async () => {
    const self = await steppedDown();
    const { venue, copies } = countingVenue();
    await expect(captureFinalCopy(deps(self, { venue, node: crashingNode() }), OP)).rejects.toThrow(
      "the box stopped before the event was written",
    );
    expect(existsSync(copyPath())).toBe(true);
    expect(await finalStateEvents(self)).toHaveLength(0);

    const envelope = await captureFinalCopy(deps(self, { venue }), OP);
    expect(copies()).toBe(2);
    const events = await finalStateEvents(self);
    expect(events.map((row) => row.envelope)).toEqual([
      canonicalize(envelope as unknown as CanonicalValue),
    ]);
    expect(envelope.body.snapshot.sha256).toBe(sha256Hex(await readFile(copyPath())));
  });

  it("a retry after a crash removes the unsigned copy before copying again", async () => {
    const self = await steppedDown();
    const { venue, foundAtPath } = countingVenue();
    await expect(captureFinalCopy(deps(self, { venue, node: crashingNode() }), OP)).rejects.toThrow(
      "the box stopped before the event was written",
    );
    expect(existsSync(copyPath())).toBe(true);

    await captureFinalCopy(deps(self, { venue }), OP);
    expect(foundAtPath()).toEqual([false, false]);
  });

  it("verifies with this box's key", async () => {
    const self = await steppedDown();
    const envelope = await captureFinalCopy(deps(self), OP);
    const [row] = await suite.db
      .select({ publicKey: nodes.publicKey })
      .from(nodes)
      .where(eq(nodes.id, self));
    const keyOf = (nodeId: string) => (nodeId === self ? (row!.publicKey ?? undefined) : undefined);
    const verified = verifyEnvelope<FinalStateIndicator>(
      JSON.parse(JSON.stringify(envelope)),
      "final-state",
      keyOf,
    );
    expect(verified.valid).toBe(true);
    expect(envelope.signerNodeId).toBe(self);
    expect(envelope.body.binding).toEqual(bindingFor(self));
  });

  it("lists each venue.db set's version and journal digest, read from the copy, and no node.db set", async () => {
    const self = await steppedDown();
    const envelope = await captureFinalCopy(deps(self), OP);
    const journal = async (table: string) =>
      (
        await suite.db.all<{ hash: string }>(
          sql.raw(`select hash from "${table}" order by created_at`),
        )
      ).map((row) => row.hash);
    const core = await journal("__drizzle_migrations_db");
    const credentials = await journal("__drizzle_migrations_credentials");
    expect(core.length).toBeGreaterThan(1);
    expect(envelope.body.snapshot.schema).toEqual([
      { set: "core", version: core.length, journalSha256: sha256Hex(core.join("\n")) },
      {
        set: "credentials",
        version: credentials.length,
        journalSha256: sha256Hex(credentials.join("\n")),
      },
    ]);
    expect(envelope.body.snapshot.modules).toEqual([
      { name: "core", version: "1.2.3" },
      { name: "credentials", version: "0.4.0" },
      { name: "node", version: "0.9.0" },
    ]);
  });

  it("carries the own-state manifest read from this box's state folder", async () => {
    const self = await steppedDown();
    await writeFile(join(stateDir, "modules.json"), '{"enabled":["core"]}');
    const envelope = await captureFinalCopy(deps(self), OP);
    expect(envelope.body.nodeLocal).toEqual(
      [...(await buildNodeLocalManifest(stateDir, RING))].sort((a, b) =>
        `${a.where}/${a.item}` < `${b.where}/${b.item}` ? -1 : 1,
      ),
    );
    const modulesFile = envelope.body.nodeLocal.find(
      (row) => row.where === "state" && row.item === "modules.json",
    );
    expect(modulesFile?.sha256).toBe(sha256Hex('{"enabled":["core"]}'));
  });

  it("lists a set's journal by when each migration was applied, not by row order", async () => {
    const self = await steppedDown();
    const table = "__drizzle_migrations_credentials";
    const applied = (
      await suite.db.all<{ hash: string }>(
        sql.raw(`select hash from "${table}" order by created_at`),
      )
    ).map((row) => row.hash);
    suite.db.run(sql.raw(`insert into "${table}" (hash, created_at) values ('earliest', 0)`));
    try {
      const envelope = await captureFinalCopy(deps(self), OP);
      const credentials = envelope.body.snapshot.schema.find((row) => row.set === "credentials");
      expect(credentials?.journalSha256).toBe(journalDigest(["earliest", ...applied]));
    } finally {
      suite.db.run(sql.raw(`delete from "${table}" where hash = 'earliest'`));
    }
  });
});

describe("a capture is refused", () => {
  async function refusedWith(self: string, code: string, overrides: Partial<CaptureDeps> = {}) {
    const error = await captureError(() => captureFinalCopy(deps(self, overrides), OP));
    expect(error).toMatchObject({ code });
    expect(existsSync(join(stateDir, "handover"))).toBe(false);
    expect(await finalStateEvents(self)).toHaveLength(0);
  }

  it("refused on a box that has not stepped down", async () => {
    const self = await box();
    await refusedWith(self, "handover.not_stepped_down");
    expect(CAPTURE_REFUSAL_STATUS["handover.not_stepped_down"]).toBe(409);
  });

  it("refused when this box stepped down for another operation", async () => {
    const self = await box();
    await restrict(self, { operationId: OTHER_OP });
    await refusedWith(self, "handover.not_stepped_down");
  });

  it("refused when this box was superseded rather than handed over", async () => {
    const self = await box();
    await restrict(self, { kind: "superseded" });
    await refusedWith(self, "handover.not_stepped_down");
  });

  it("refused when the restriction names a successor other than the operation's destination", async () => {
    const self = await box();
    await restrict(self, { successor: "33333333-3333-4333-8333-333333333333" });
    await refusedWith(self, "handover.not_stepped_down");
  });

  it("refused when this box holds no operation by that id", async () => {
    await seedVenue(suite.db);
    const self = await seedNode(suite.db);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, self);
    await restrict(self);
    await refusedWith(self, "handover.not_stepped_down");
  });

  it("refused when this box is the operation's destination, not its source", async () => {
    await seedVenue(suite.db);
    const self = await seedNode(suite.db);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, self);
    await beginHandover({ node: suite.node, nodeId: self }, bindingFor(self), "destination");
    await restrict(self);
    await refusedWith(self, "handover.not_stepped_down");
  });

  it("refused when the restriction's membership term is not the operation's", async () => {
    const self = await box();
    await restrict(self, { term: 4 });
    await refusedWith(self, "handover.not_stepped_down");
  });

  it("refused after a capture once the restriction no longer names the operation", async () => {
    const self = await steppedDown();
    await captureFinalCopy(deps(self), OP);
    await suite.node.delete(nodeHandoverRestriction);
    const error = await captureError(() => captureFinalCopy(deps(self), OP));
    expect(error).toMatchObject({ code: "handover.not_stepped_down" });
  });

  it("refused, with nothing copied, when the state folder is missing", async () => {
    const self = await steppedDown();
    const missing = join(stateDir, "gone");
    await expect(captureFinalCopy(deps(self, { stateDir: missing }), OP)).rejects.toThrow(
      /state folder/,
    );
    expect(existsSync(join(missing, "handover"))).toBe(false);
    expect(await finalStateEvents(self)).toHaveLength(0);
  });
});

describe("a fault in Waitron stops the capture", () => {
  it("a state folder that cannot be read is reported as it failed", async () => {
    const self = await steppedDown();
    const file = join(stateDir, "a-file");
    await writeFile(file, "");
    await expect(
      captureFinalCopy(deps(self, { stateDir: join(file, "inside") }), OP),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("a journal table outside the drizzle shape is refused before it reaches SQL", async () => {
    const self = await steppedDown();
    const odd = { ...MODULES[1], migrations: { ...MODULES[1].migrations, table: 'x"; --' } };
    await expect(captureFinalCopy(deps(self, { modules: [MODULES[0], odd] }), OP)).rejects.toThrow(
      /invalid journal table/,
    );
  });

  it("a final-state event stored with no envelope", async () => {
    const self = await steppedDown();
    await withNodeTransaction(suite.node, (tx) =>
      appendHandoverEventTx(tx, {
        nodeId: self,
        operationId: OP,
        kind: FINAL_STATE_EVENT,
        detail: {},
        envelope: null,
      }),
    );
    await expect(captureFinalCopy(deps(self), OP)).rejects.toThrow(/is empty/);
  });
});

describe("the journal digest", () => {
  it("is the SHA-256 of the hashes joined by a newline, in the order given", () => {
    expect(journalDigest(["a", "b"])).toBe(
      createHash("sha256").update("a\nb", "utf8").digest("hex"),
    );
    expect(journalDigest(["b", "a"])).not.toBe(journalDigest(["a", "b"]));
  });
});
