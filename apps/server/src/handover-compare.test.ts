import { randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getRequestListener } from "@hono/node-server";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  nodes,
  readNodeMembership,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { appendToChain } from "@waitron/fiscal-verifactu/src/chain.js";
import {
  altaFor,
  seedNode,
  seedSale,
  type SeededNode,
} from "@waitron/fiscal-verifactu/src/testing/seed.js";
import {
  envelopeDigest,
  sha256Hex,
  signEnvelope,
  verifyEnvelope,
  type FinalStateIndicator,
  type HandoverBinding,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import { persons } from "@waitron/identity";
import {
  endorseKey,
  signDocumentBody,
  type CanonicalValue,
  type MembershipDocumentBody,
} from "@waitron/membership";
import { imageMigrationHashes, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { WaitronModule } from "@waitron/module";
import { fakeSetlessModule } from "@waitron/module/src/testing/fake-module.js";
import {
  appendHandoverEventTx,
  readHandoverEvent,
  readHandoverOperation,
  readHandoverRestriction,
  recordHandoverRestrictionTx,
  setNodeMode,
  writeMirrorLink,
  type HandoverOperation,
} from "@waitron/node-db";
import { acceptedCopyPath, acceptFinalCopy } from "./handover-acceptance.js";
import { captureFinalCopy, finalCopyPath, type CaptureDeps } from "./handover-capture.js";
import {
  compareFinalCopy,
  type CompareDeps,
  type CompareOptions,
  type CopyFileChecks,
} from "./handover-compare.js";
import {
  receivedCopyPath,
  startHandoverDestinationDuty,
  type HandoverDestinationDuty,
  type DestinationDutyDeps,
} from "./handover-destination-duty.js";
import { mountHandoverSourceApi } from "./handover-source-api.js";
import {
  advanceHandover,
  beginHandover,
  beginHandoverFromOffer,
  HANDOVER_EVENT,
} from "./handover-store.js";
import type { Logger } from "./logger.js";
import { boxDownload } from "./mirror-bundle-fetch.js";
import { ALL_MODULES } from "./modules.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { stopShortOfAccepting } from "./testing/stop-short-of-accepting.js";

const integrityThreads = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("node:worker_threads", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:worker_threads")>();
  class CountedWorker extends real.Worker {
    constructor(source: string | URL, options?: import("node:worker_threads").WorkerOptions) {
      const path = (options?.workerData as { path?: string } | undefined)?.path;
      if (path !== undefined) integrityThreads.paths.push(path);
      super(source, options);
    }
  }
  return { ...real, Worker: CountedWorker };
});

const fileFlushes = vi.hoisted(() => ({
  seen: null as null | ((path: string) => Promise<void>),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const open = async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      await sync();
      await fileFlushes.seen?.(String(args[0]));
    };
    return handle;
  };
  return { ...real, open };
});

const fileReads = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const createReadStream = (...args: Parameters<typeof real.createReadStream>) => {
    fileReads.paths.push(String(args[0]));
    return real.createReadStream(...args);
  };
  return { ...real, createReadStream };
});

const imageReads = vi.hoisted(() => ({ folders: [] as string[] }));
vi.mock("drizzle-orm/migrator", async (importOriginal) => {
  const real = await importOriginal<typeof import("drizzle-orm/migrator")>();
  return {
    ...real,
    readMigrationFiles: (...args: Parameters<typeof real.readMigrationFiles>) => {
      imageReads.folders.push(args[0].migrationsFolder);
      return real.readMigrationFiles(...args);
    },
  };
});

const journalReads = vi.hoisted(() => ({ statements: [] as string[] }));
vi.mock("@waitron/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/store")>();
  return {
    ...real,
    openBackupQuery: async (...args: Parameters<typeof real.openBackupQuery>) => {
      const opened = await real.openBackupQuery(...args);
      const rows: typeof opened.query.rows = (statement, values) => {
        if (statement.startsWith("select hash from")) journalReads.statements.push(statement);
        return opened.query.rows(statement, values);
      };
      return { ...opened, query: { ...opened.query, rows } };
    },
  };
});

const chartReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@waitron/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/db")>();
  return {
    ...real,
    readNodeMembership: (...args: Parameters<typeof real.readNodeMembership>) => {
      chartReads.count += 1;
      return real.readNodeMembership(...args);
    },
  };
});

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const COPY_PLACED_EVENT = HANDOVER_EVENT.copyPlaced;
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FISCAL = "fiscal-verifactu";
const SETTINGS = "WAITRON_BACKUP_RECOVERY_KEY=one\n";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

let scratch: string;
const closers: (() => Promise<unknown>)[] = [];
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "waitron-handover-compare-"));
});
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
  await rm(scratch, { recursive: true, force: true });
});

async function appendRecord(node: SeededNode, number: number): Promise<void> {
  const sale = await seedSale(suite.db, node, number);
  const [sif] = suite.db.all<{ nif: string; numero_instalacion: string }>(
    sql`select nif, numero_instalacion from registro_sif where node_id = ${node.nodeId} and revocado_en is null`,
  );
  const pending = altaFor(node, sale, number, number);
  pending.input.SistemaInformatico = {
    ...pending.input.SistemaInformatico,
    IDOtro: undefined,
    NIF: sif!.nif,
    NumeroInstalacion: sif!.numero_instalacion,
  };
  pending.input.IDEmisorFactura = sif!.nif;
  pending.input.NumSerieFactura = `${node.nodeId}/${number}`;
  pending.input.DescripcionOperacion = "Fixture meal";
  await suite.db.transaction((tx) => appendToChain(tx, node.nodeId, pending));
}

/** Writes to a copy as a box never does: past the triggers that keep its records from changing. */
function alter(path: string, statement: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec("pragma foreign_keys = off");
    const triggers = db.prepare("select name from sqlite_schema where type = 'trigger'").all() as {
      name: string;
    }[];
    for (const { name } of triggers) db.exec(`drop trigger "${name.replaceAll('"', '""')}"`);
    db.exec(statement);
  } finally {
    db.close();
  }
}

/** One page overwritten, at the same size, where the named table's rows start. */
async function damageRootPage(path: string, table: string): Promise<void> {
  const copy = new DatabaseSync(path, { readOnly: true });
  const { rootpage } = copy
    .prepare("select rootpage from sqlite_schema where name = ?")
    .get(table) as { rootpage: number };
  copy.close();
  const file = await open(path, "r+");
  await file.write(Buffer.alloc(4096, 0xff), 0, 4096, (rootpage - 1) * 4096);
  await file.close();
}

type Envelope = SignedHandoverEnvelope<FinalStateIndicator>;

/**
 * A real three-record chain and a real capture by M1, its file already at M2's received path. Both
 * boxes share one database, as `handover-fetch.test.ts`'s do: every row is keyed by its box.
 */
const THIRD_BOX = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function rig() {
  const db = suite.db;
  const m1 = await seedNode(db, "First");
  const m2 = await seedNode(db, "Second");
  for (const number of [1, 2, 3]) await appendRecord(m1, number);
  for (const { nodeId } of [m1, m2]) {
    await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
  }
  const m1Key = await readNodeIdentityKey(suite.node, RING, m1.nodeId);
  const m2Key = await readNodeIdentityKey(suite.node, RING, m2.nodeId);
  await pinMainBoxKey(suite.node, m2.nodeId, {
    nodeId: m1.nodeId,
    publicKey: nodeSigningPublicKey(m1Key),
  });
  const [person] = await db
    .insert(persons)
    .values({ displayName: "Owner", role: "admin", status: "active" })
    .returning({ id: persons.id });
  const authorisedBy = person!.id;

  const binding: HandoverBinding = {
    operationId: OP,
    scenario: "controlled",
    venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
    sourceNodeId: m1.nodeId,
    destinationNodeId: m2.nodeId,
    membership: { term: 3, digest: "a".repeat(64) },
  };
  const m1Store = { node: suite.node, nodeId: m1.nodeId };
  const m2Store = { node: suite.node, nodeId: m2.nodeId };
  await beginHandover(m1Store, binding, "source");
  await advanceHandover(m1Store, OP, "source_stepped_down", {});
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: m1.nodeId,
      operationId: OP,
      kind: "handed-over",
      successorNodeId: m2.nodeId,
      membershipTerm: 3,
    }),
  );
  const offer = signEnvelope(
    "stepdown",
    { binding: binding as unknown as CanonicalValue, authorisedBy },
    { nodeId: m1.nodeId, privateKey: m1Key },
  );
  await beginHandoverFromOffer(m2Store, binding, "destination", offer);

  const m1State = join(scratch, "m1");
  const m2State = join(scratch, "m2");
  await mkdir(m1State, { recursive: true });
  await mkdir(m2State, { recursive: true });
  const captureDeps: CaptureDeps = {
    venue: db,
    node: suite.node,
    stateDir: m1State,
    ring: RING,
    nodeId: m1.nodeId,
    modules: ALL_MODULES,
  };
  const indicator = await captureFinalCopy(captureDeps, OP);
  const path = receivedCopyPath(m2State, OP);
  await mkdir(dirname(path), { recursive: true });
  await copyFile(finalCopyPath(m1State, OP), path);

  const signer = { nodeId: m1.nodeId, privateKey: m1Key };
  const deps: CompareDeps = {
    db,
    node: suite.node,
    ring: RING,
    nodeId: m2.nodeId,
    stateDir: m2State,
    modules: ALL_MODULES,
    migrationsRoot: null,
  };
  const row = async (): Promise<HandoverOperation> =>
    (await readHandoverOperation(suite.node, m2.nodeId, OP))!;

  /** The captured body with `change` made, signed again by M1, as an old box that lied would. */
  const resigned = (
    change: (body: Mutable) => void,
    by: { nodeId: string; privateKey: string } = signer,
  ): Envelope => {
    const body = structuredClone(indicator.body) as unknown as Mutable;
    change(body);
    return signEnvelope(
      "final-state",
      body as unknown as CanonicalValue,
      by,
    ) as unknown as Envelope;
  };

  /** An indicator telling the truth about the file's bytes as they now are. */
  const resignedForFile = async (change: (body: Mutable) => void = () => {}): Promise<Envelope> => {
    const bytes = await readFile(path);
    return resigned((body) => {
      body.snapshot.sha256 = sha256Hex(bytes);
      body.snapshot.bytes = bytes.length;
      change(body);
    });
  };

  const compareRow = async (
    envelope: unknown = indicator,
    overrides: Partial<CompareDeps> = {},
    found: CopyFileChecks = {},
  ) => compareFinalCopy({ ...deps, ...overrides }, await row(), envelope, path, { found });

  return {
    db,
    m1,
    m2,
    m1Key,
    m2Key,
    m1Store,
    m2Store,
    m1State,
    m2State,
    binding,
    authorisedBy,
    indicator,
    path,
    signer,
    deps,
    captureDeps,
    row,
    resigned,
    resignedForFile,
    compareRow,
  };
}

interface Mutable {
  binding: { [key: string]: unknown; venue: { taxId: string }; membership: { term: number } };
  snapshot: {
    sha256: string;
    bytes: number;
    schema: unknown[];
    modules: { name: string; version: string }[];
  };
  nodeLocal: {
    item: string;
    sha256?: string | null;
    ringVersions?: number[];
    revisions?: { binding: Record<string, string>; value: unknown }[];
  }[];
  modulesSummary: Record<string, unknown>;
}

const refused = (reason: string, detail: unknown = {}) => ({ ok: false, reason, detail });

const FIRST_CHAIN = (m1: SeededNode) => `node_id = '${m1.nodeId}' and secuencia = 2`;

const revisionOf = (text: string, eventId = "event-1") => ({
  binding: {
    module: FISCAL,
    action: "select",
    eventId,
    sourceId: "source-1",
    targetNodeId: "target-1",
  },
  value: { text },
});

describe("compareFinalCopy", () => {
  it("control: an untouched real capture is accepted, and comparing changes no byte", async () => {
    const r = await rig();
    const before = await readFile(r.path);
    expect(await r.compareRow()).toEqual({ ok: true });
    expect(sha256Hex(await readFile(r.path))).toBe(sha256Hex(before));
    expect(await readdir(dirname(r.path))).toEqual(["received.db"]);
  });

  describe("the indicator's shape comes first", () => {
    it.each([
      ["no envelope at all", null, "indicator"],
      ["an envelope with no body", {}, "indicator"],
      ["a body with no binding", { body: { snapshot: {} } }, "binding"],
    ])("%s is refused naming the field", async (_label, envelope, field) => {
      const r = await rig();
      expect(await r.compareRow(envelope)).toEqual(
        refused("handover.indicator_mismatch", { field }),
      );
    });

    it("a wrong shape, however signed, is refused before its signature is read", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => {
        delete (body as Partial<Mutable>).modulesSummary;
      });
      expect(await r.compareRow({ ...envelope, signature: "not a signature" })).toEqual(
        refused("handover.indicator_mismatch", { field: "modulesSummary" }),
      );
    });

    it("a fault that is not a wrong shape is not read as a refusal", async () => {
      const r = await rig();
      const poison = new Proxy(
        {},
        {
          get() {
            throw new Error("a fault in Waitron");
          },
        },
      );
      await expect(r.compareRow(poison)).rejects.toThrow("a fault in Waitron");
    });
  });

  describe("the signature", () => {
    it("the same body signed by the spare is refused", async () => {
      const r = await rig();
      const envelope = r.resigned(() => {}, { nodeId: r.m2.nodeId, privateKey: r.m2Key });
      expect(await r.compareRow(envelope)).toEqual(refused("handover.indicator_untrusted"));
    });

    it("a signer nobody vouches for is refused", async () => {
      const r = await rig();
      const envelope = r.resigned(() => {}, { nodeId: OTHER_OP, privateKey: r.m1Key });
      expect(await r.compareRow(envelope)).toEqual(refused("handover.indicator_untrusted"));
    });

    it("a signature of another body is refused", async () => {
      const r = await rig();
      const envelope = {
        ...r.indicator,
        body: { ...r.indicator.body, capturedAtMs: r.indicator.body.capturedAtMs + 1 },
      };
      expect(await r.compareRow(envelope)).toEqual(refused("handover.indicator_untrusted"));
    });

    it("the old box's signature for another purpose is refused", async () => {
      const r = await rig();
      const envelope = signEnvelope(
        "status",
        r.indicator.body as unknown as CanonicalValue,
        r.signer,
      );
      expect(await r.compareRow(envelope)).toEqual(refused("handover.indicator_untrusted"));
    });
  });

  it("a forged signature over a wrong binding is refused for the signature", async () => {
    const r = await rig();
    const envelope = {
      ...r.resigned((body) => {
        body.binding.venue.taxId = "B00000000";
      }),
      signature: r.indicator.signature,
    };
    expect(await r.compareRow(envelope)).toEqual(refused("handover.indicator_untrusted"));
  });

  describe("the binding", () => {
    it.each<[string, (body: Mutable) => void]>([
      ["another operation", (body) => void (body.binding.operationId = OTHER_OP)],
      ["another taxpayer", (body) => void (body.binding.venue.taxId = "B87654321")],
      ["another term", (body) => void (body.binding.membership.term = 4)],
    ])("an indicator for %s, properly signed, is refused", async (_label, change) => {
      const r = await rig();
      expect(await r.compareRow(r.resigned(change))).toEqual(
        refused("handover.indicator_mismatch", { field: "binding" }),
      );
    });
  });

  describe("the digest and the size", () => {
    it("one row written after capture is refused", async () => {
      const r = await rig();
      alter(r.path, `update persons set display_name = 'Late' where id = '${r.authorisedBy}'`);
      expect(await r.compareRow()).toEqual(refused("handover.copy_mismatch"));
    });

    it("a digest that differs with the size right is refused", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => void (body.snapshot.sha256 = "0".repeat(64)));
      expect(await r.compareRow(envelope)).toEqual(refused("handover.copy_mismatch"));
    });

    it("a size that differs with the digest right is refused", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => void (body.snapshot.bytes += 1));
      expect(await r.compareRow(envelope)).toEqual(refused("handover.copy_mismatch"));
    });

    it("a file that is gone is refused the same way, so it is fetched again", async () => {
      const r = await rig();
      await rm(r.path);
      expect(await r.compareRow()).toEqual(refused("handover.copy_mismatch"));
    });

    it("a path that cannot be read for another reason is a fault, not a refusal", async () => {
      const r = await rig();
      await rm(r.path);
      await mkdir(r.path);
      await expect(r.compareRow()).rejects.toMatchObject({ code: "EISDIR" });
    });
  });

  describe("the database's own integrity check", () => {
    it("a page overwritten in a file the indicator describes is refused", async () => {
      const r = await rig();
      const { size } = await stat(r.path);
      const file = await open(r.path, "r+");
      const page = 4096;
      await file.write(
        Buffer.alloc(page * 4, 0xff),
        0,
        page * 4,
        Math.floor(size / page / 2) * page,
      );
      await file.close();
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.copy_damaged"),
      );
    });

    it("a row naming a parent that is not there is refused the same way", async () => {
      const r = await rig();
      alter(r.path, `update sales set device_id = 'gone' where node_id = '${r.m1.nodeId}'`);
      const altered = new DatabaseSync(r.path, { readOnly: true });
      expect(altered.prepare("pragma integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
      expect(altered.prepare("pragma foreign_key_check").all().length).toBeGreaterThan(0);
      altered.close();
      // Failing case: with the integrity check alone, this copy passes: `{ ok: true }`.
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.copy_damaged"),
      );
    });

    it("a file that is not a database, under the indicator as signed, is refused for its bytes", async () => {
      const r = await rig();
      await writeFile(r.path, "x".repeat(8192));
      expect(await r.compareRow()).toEqual(refused("handover.copy_mismatch"));
    });

    it("a file that is not a database at all is refused", async () => {
      const r = await rig();
      await writeFile(r.path, "x".repeat(8192));
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.copy_damaged"),
      );
    });
  });

  describe("the schema is checked before any module's code reads the copy", () => {
    const AHEAD = "insert into __drizzle_migrations_db (hash, created_at) values ('from-later', 1)";

    it("a journal naming a migration this image does not ship is refused", async () => {
      const r = await rig();
      alter(r.path, AHEAD);
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("provisioning.database_ahead", { set: "core", unknownMigrations: ["from-later"] }),
      );
    });

    it("a set this box does not switch on is read too: a start would refuse it", async () => {
      const r = await rig();
      const off = manifestSets()
        .filter((set) => set.database !== "node")
        .at(-1)!;
      alter(r.path, `insert into ${off.table} (hash, created_at) values ('from-later', 1)`);
      const envelope = await r.resignedForFile();
      expect(
        await r.compareRow(envelope, {
          modules: ALL_MODULES.filter((module) => module.name !== off.name),
        }),
      ).toEqual(
        refused("provisioning.database_ahead", {
          set: off.name,
          unknownMigrations: ["from-later"],
        }),
      );
    });

    it("a toggleable set this box switches off may have no journal: neither ahead nor behind", async () => {
      const r = await rig();
      const off = manifestSets()
        .filter((one) => one.database !== "node")
        .at(-1)!;
      expect(ALL_MODULES.find((module) => module.name === off.name)?.tier).toBe("toggleable");
      alter(r.path, `drop table ${off.table}`);
      const envelope = await r.resignedForFile((body) => {
        body.snapshot.modules = body.snapshot.modules.filter((one) => one.name !== off.name);
      });
      const modules = ALL_MODULES.filter((module) => module.name !== off.name);
      expect(await r.compareRow(envelope, { modules })).toEqual({ ok: true });
    });

    it("a node.db set is not looked for in the copy, even with a table of its name", async () => {
      const r = await rig();
      const set = manifestSets().find((one) => one.database === "node")!;
      alter(
        r.path,
        `create table ${set.table} (hash text, created_at integer);
         insert into ${set.table} values ('from-later', 1)`,
      );
      expect(await r.compareRow(await r.resignedForFile())).toEqual({ ok: true });
    });

    it("a copy both ahead and broken reports ahead: no module read it", async () => {
      const r = await rig();
      alter(
        r.path,
        `${AHEAD}; update registros_facturacion set importe_total = '1.00' where ${FIRST_CHAIN(r.m1)}`,
      );
      const summarise = vi.fn(async () => ({}));
      const checkCopy = vi.fn(async () => "ok" as const);
      const spy: WaitronModule = {
        ...ALL_MODULES[0]!,
        name: "spy",
        handover: { summarise, checkCopy },
      };
      const result = await r.compareRow(await r.resignedForFile(), {
        modules: [...ALL_MODULES, spy],
      });
      expect(result).toMatchObject({ reason: "provisioning.database_ahead" });
      expect(checkCopy).not.toHaveBeenCalled();
      expect(summarise).not.toHaveBeenCalled();
    });
  });

  describe("the modules", () => {
    it.each<[string, (body: Mutable) => void]>([
      ["one fewer", (body) => void body.snapshot.modules.pop()],
      ["another version", (body) => void (body.snapshot.modules[0]!.version = "99.0.0")],
      ["another name", (body) => void (body.snapshot.modules[0]!.name = "another")],
      [
        "one more",
        (body) => void body.snapshot.modules.push({ name: "zzz-later", version: "1.0.0" }),
      ],
    ])("an old box listing %s is refused", async (_label, change) => {
      const r = await rig();
      expect(await r.compareRow(r.resigned(change))).toEqual(refused("handover.modules_differ"));
    });

    it("a module with no set of its own, held on both boxes, is accepted", async () => {
      const r = await rig();
      const setless = fakeSetlessModule("synthetic-setless", "core");
      const indicator = r.resigned(
        (body) => void body.snapshot.modules.push({ name: setless.name, version: setless.version }),
      );
      const result = await r.compareRow(indicator, { modules: [...ALL_MODULES, setless] });
      expect(result).toEqual({ ok: true });
    });

    it("the order this box holds its modules in does not matter", async () => {
      const r = await rig();
      const result = await r.compareRow(r.indicator, { modules: [...ALL_MODULES].reverse() });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("what each try reads of this image's migrations and the copy's journals", () => {
    /** A root of this image's migrations that no earlier case has asked about. */
    function imageRoot(r: { m2State: string }, name: string): string {
      const root = join(r.m2State, name);
      for (const set of manifestSets()) {
        const { migrationsFolder } = migrationOptionsFor([set], null)[0]!;
        cpSync(migrationsFolder, join(root, set.name), { recursive: true });
      }
      return root;
    }

    it("reads the image's files once across two tries, and each journal once a try", async () => {
      const r = await rig();
      const migrationsRoot = imageRoot(r, "image");
      const found: CopyFileChecks = {};
      imageReads.folders.length = 0;
      journalReads.statements.length = 0;

      expect(await r.compareRow(r.indicator, { migrationsRoot }, found)).toEqual({ ok: true });
      const firstFolders = imageReads.folders.filter((path) => path.startsWith(migrationsRoot));
      const firstJournals = [...journalReads.statements];
      expect(firstFolders.length).toBeGreaterThan(0);
      expect(new Set(firstFolders).size).toBe(firstFolders.length);
      expect(firstJournals.length).toBeGreaterThan(0);
      expect(new Set(firstJournals).size).toBe(firstJournals.length);

      imageReads.folders.length = 0;
      journalReads.statements.length = 0;
      expect(await r.compareRow(r.indicator, { migrationsRoot }, found)).toEqual({ ok: true });
      // Failing case, nothing remembered: every set's folder again, twice for the enabled ones.
      expect(imageReads.folders.filter((path) => path.startsWith(migrationsRoot))).toEqual([]);
      expect(journalReads.statements).toEqual(firstJournals);
    });

    it("a root holding other migrations answers by its own files, not another root's", async () => {
      const r = await rig();
      const whole = imageRoot(r, "whole");
      const short = imageRoot(r, "short");
      const journalPath = join(short, FISCAL, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
      journal.entries.pop();
      writeFileSync(journalPath, JSON.stringify(journal));

      expect(await r.compareRow(r.indicator, { migrationsRoot: whole })).toEqual({ ok: true });
      // Failing case, remembered by the set alone: the whole root's answer again.
      expect(await r.compareRow(r.indicator, { migrationsRoot: short })).toEqual(
        expect.objectContaining({
          ok: false,
          reason: "provisioning.database_ahead",
          detail: expect.objectContaining({ set: FISCAL }),
        }),
      );
    });
  });

  describe("a copy behind this box's image", () => {
    const setNamed = (name: string) => manifestSets().find((set) => set.name === name)!;
    const lastMigration = (name: string) => imageMigrationHashes(setNamed(name), null).at(-1)!;

    it("one migration behind, with a column a module reads gone, is refused before it reads", async () => {
      const r = await rig();
      alter(
        r.path,
        `delete from ${setNamed(FISCAL).table} where hash = '${lastMigration(FISCAL)}';
         alter table acks drop column csv`,
      );
      // Failing case: `handover.summary_unreadable`, which waits for ever with M1 stopped.
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.modules_differ", { set: FISCAL }),
      );
    });

    it("one migration behind and otherwise sound is refused too", async () => {
      const r = await rig();
      alter(
        r.path,
        `delete from ${setNamed("core").table} where hash = '${lastMigration("core")}'`,
      );
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.modules_differ", { set: "core" }),
      );
    });

    it("a set this box does not switch on may be behind: no start migrates it", async () => {
      const r = await rig();
      const off = "bookings";
      alter(r.path, `delete from ${setNamed(off).table} where hash = '${lastMigration(off)}'`);
      const envelope = await r.resignedForFile((body) => {
        body.snapshot.modules = body.snapshot.modules.filter((one) => one.name !== off);
      });
      const modules = ALL_MODULES.filter((module) => module.name !== off);
      expect(await r.compareRow(envelope, { modules })).toEqual({ ok: true });
    });

    it("no journal for a set this box switches on is refused: that copy could not migrate", async () => {
      const r = await rig();
      alter(r.path, `drop table ${setNamed("core").table}`);
      // Failing case: `{ ok: true }`, and `applyMigrations` on the copy then fails
      // `migrations.apply_failed` after the old box was told it can relinquish.
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.modules_differ", { set: "core" }),
      );
    });

    it("a toggleable set this box switches on is held to its journal too", async () => {
      const r = await rig();
      const on = "bookings";
      expect(ALL_MODULES.find((module) => module.name === on)?.tier).toBe("toggleable");
      alter(r.path, `drop table ${setNamed(on).table}`);
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.modules_differ", { set: on }),
      );
    });

    it("a node.db set is not looked for in the copy", async () => {
      const r = await rig();
      const set = manifestSets().find((one) => one.database === "node")!;
      alter(r.path, `create table ${set.table} (hash text, created_at integer)`);
      expect(await r.compareRow(await r.resignedForFile())).toEqual({ ok: true });
    });
  });

  describe("a file kept between tries", () => {
    const LATE = (r: Awaited<ReturnType<typeof rig>>) =>
      `update persons set display_name = 'Late' where id = '${r.authorisedBy}'`;

    const FORGED_AMOUNT = (r: Awaited<ReturnType<typeof rig>>) =>
      `update registros_facturacion set importe_total = printf('%.2f', importe_total + 1) where ${FIRST_CHAIN(r.m1)}`;

    it("a change after it passed is found before the next answer, and a new file's bytes are read", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      expect(await r.compareRow(r.indicator, {}, found)).toEqual({ ok: true });
      alter(r.path, LATE(r));
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(refused("handover.copy_mismatch"));
      // Control: the same file with nothing remembered is read, and refused.
      expect(await r.compareRow(r.indicator, {}, {})).toEqual(refused("handover.copy_mismatch"));
    });

    it("a forged amount at the same size, after a try refused on settings, is refused", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      await writeFile(join(r.m2State, "backup.env"), SETTINGS);
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(
        refused("handover.backup_settings_differ"),
      );
      expect(found).toEqual({ bytesAndIntegrity: true, moduleChecks: null });
      const before = (await stat(r.path)).size;
      alter(r.path, FORGED_AMOUNT(r));
      expect((await stat(r.path)).size).toBe(before);
      await rm(join(r.m2State, "backup.env"));
      // Failing case: `{ ok: true }`, accepting a fiscal record the old box never wrote.
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(refused("handover.copy_mismatch"));
      expect(found).toEqual({});
    });

    it("control: unaltered, it is accepted on the second try, reading its bytes once more", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      await writeFile(join(r.m2State, "backup.env"), SETTINGS);
      fileReads.paths.length = 0;
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(
        refused("handover.backup_settings_differ"),
      );
      expect(fileReads.paths).toEqual([r.path]);
      await rm(join(r.m2State, "backup.env"));
      expect(await r.compareRow(r.indicator, {}, found)).toEqual({ ok: true });
      expect(fileReads.paths).toEqual([r.path, r.path]);
      expect(found).toEqual({ bytesAndIntegrity: true, moduleChecks: null });
    });

    it("a try refused on settings does not read its bytes, whatever they now hold", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      await writeFile(join(r.m2State, "backup.env"), SETTINGS);
      await r.compareRow(r.indicator, {}, found);
      alter(r.path, FORGED_AMOUNT(r));
      fileReads.paths.length = 0;
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(
        refused("handover.backup_settings_differ"),
      );
      // Failing case: one read of the file per try, however long the wait for a person lasts.
      expect(fileReads.paths).toEqual([]);
    });

    it("a first try that passes reads its bytes once", async () => {
      const r = await rig();
      fileReads.paths.length = 0;
      expect(await r.compareRow(r.indicator, {}, {})).toEqual({ ok: true });
      expect(fileReads.paths).toEqual([r.path]);
    });

    it("its integrity check runs once, on a thread of its own", async () => {
      const r = await rig();
      integrityThreads.paths.length = 0;
      const found: CopyFileChecks = {};
      await r.compareRow(r.indicator, {}, found);
      await r.compareRow(r.indicator, {}, found);
      expect(integrityThreads.paths).toEqual([r.path]);
      // Control: a new file is checked.
      await r.compareRow(r.indicator, {}, {});
      expect(integrityThreads.paths).toEqual([r.path, r.path]);
    });

    it("a refused file's integrity check is not remembered as passed", async () => {
      const r = await rig();
      await writeFile(r.path, "x".repeat(8192));
      const found: CopyFileChecks = {};
      const envelope = await r.resignedForFile();
      expect(await r.compareRow(envelope, {}, found)).toEqual(refused("handover.copy_damaged"));
      expect(await r.compareRow(envelope, {}, found)).toEqual(refused("handover.copy_damaged"));
    });

    it("its modules' checks run once, and a passing or refusing answer is kept", async () => {
      const r = await rig();
      const checkCopy = vi.fn(async (): Promise<"ok" | "broken"> => "ok");
      const counted: WaitronModule = {
        ...ALL_MODULES[0]!,
        name: "counted",
        handover: { summarise: async () => ({}), checkCopy },
      };
      const modules = [...ALL_MODULES, counted];
      const listed = (body: Mutable) => {
        body.snapshot.modules.push({ name: "counted", version: counted.version });
        body.modulesSummary.counted = {};
      };
      const envelope = r.resigned(listed);
      const found: CopyFileChecks = {};
      expect(await r.compareRow(envelope, { modules }, found)).toEqual({ ok: true });
      expect(await r.compareRow(envelope, { modules }, found)).toEqual({ ok: true });
      expect(checkCopy).toHaveBeenCalledTimes(1);

      checkCopy.mockResolvedValue("broken");
      const refusing: CopyFileChecks = {};
      const answer = refused("handover.chain_broken", { module: "counted" });
      expect(await r.compareRow(envelope, { modules }, refusing)).toEqual(answer);
      expect(await r.compareRow(envelope, { modules }, refusing)).toEqual(answer);
      expect(checkCopy).toHaveBeenCalledTimes(2);
    });

    it("a module's check that threw is not kept: the next try asks it again", async () => {
      const r = await rig();
      const checkCopy = vi.fn(async (): Promise<"ok" | "broken"> => "ok");
      checkCopy.mockRejectedValueOnce(new Error("a passing fault"));
      const flaky: WaitronModule = {
        ...ALL_MODULES[0]!,
        name: "flaky",
        handover: { summarise: async () => ({}), checkCopy },
      };
      const modules = [...ALL_MODULES, flaky];
      const envelope = r.resigned((body) => {
        body.snapshot.modules.push({ name: "flaky", version: flaky.version });
        body.modulesSummary.flaky = {};
      });
      const found: CopyFileChecks = {};
      expect(await r.compareRow(envelope, { modules }, found)).toEqual(
        refused("handover.copy_check_failed", { module: "flaky" }),
      );
      expect(found).toEqual({ bytesAndIntegrity: true });
      // Failing case: `copy_check_failed` again, with the old box stopped until a restart.
      expect(await r.compareRow(envelope, { modules }, found)).toEqual({ ok: true });
      expect(checkCopy).toHaveBeenCalledTimes(2);
    });

    it("a kept file turned to noise throws once, then is refused so it is fetched again", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      expect(await r.compareRow(r.indicator, {}, found)).toEqual({ ok: true });
      await writeFile(r.path, randomBytes((await stat(r.path)).size));
      await expect(r.compareRow(r.indicator, {}, found)).rejects.toMatchObject({
        code: "ERR_SQLITE_ERROR",
        errcode: 26,
      });
      expect(found).toEqual({});
      // Failing case: the same throw on every try, and the file never fetched again.
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(refused("handover.copy_mismatch"));
    });

    it("a throw on a kept sound file costs one more read and one more thread, then it passes", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      expect(await r.compareRow(r.indicator, {}, found)).toEqual({ ok: true });
      fileReads.paths.length = 0;
      integrityThreads.paths.length = 0;
      // Where this image's migrations should be: a fault on this box, nothing about the file.
      const migrationsRoot = join(r.m2State, "absent");
      await expect(r.compareRow(r.indicator, { migrationsRoot }, found)).rejects.toMatchObject({
        code: "migrations.set_missing",
      });
      expect(found).toEqual({});
      expect(fileReads.paths).toEqual([]);
      expect(await r.compareRow(r.indicator, {}, found)).toEqual({ ok: true });
      expect(fileReads.paths).toEqual([r.path]);
      expect(integrityThreads.paths).toEqual([r.path]);
      expect(found).toEqual({ bytesAndIntegrity: true, moduleChecks: null });
    });

    it("a throw on a first try keeps what that try read: nothing was remembered before it", async () => {
      const r = await rig();
      const migrationsRoot = join(r.m2State, "absent");
      const found: CopyFileChecks = {};
      await expect(r.compareRow(r.indicator, { migrationsRoot }, found)).rejects.toMatchObject({
        code: "migrations.set_missing",
      });
      expect(found).toEqual({ bytesAndIntegrity: true });
    });

    it("a page a summary reads, damaged on a kept file, answers once, then is refused so it is fetched again", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      expect(await r.compareRow(r.indicator, {}, found)).toEqual({ ok: true });
      await damageRootPage(r.path, "registros_facturacion");
      expect(await r.compareRow(r.indicator, {}, found)).toMatchObject({
        reason: "handover.summary_unreadable",
      });
      expect(found).toEqual({});
      // Failing case: `summary_unreadable` on every try, and the file never fetched again.
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(refused("handover.copy_mismatch"));
    });

    it("a summary's passing fault on a kept sound file costs one more read and thread, then it passes", async () => {
      const r = await rig();
      const summarise = vi.fn(async (): Promise<CanonicalValue> => ({}));
      const flaky: WaitronModule = {
        ...ALL_MODULES[0]!,
        name: "flaky",
        handover: { summarise, checkCopy: async () => "ok" },
      };
      const modules = [...ALL_MODULES, flaky];
      const envelope = r.resigned((body) => {
        body.snapshot.modules.push({ name: "flaky", version: flaky.version });
        body.modulesSummary.flaky = {};
      });
      const found: CopyFileChecks = {};
      expect(await r.compareRow(envelope, { modules }, found)).toEqual({ ok: true });
      summarise.mockRejectedValueOnce(new Error("a passing fault"));
      fileReads.paths.length = 0;
      integrityThreads.paths.length = 0;
      expect(await r.compareRow(envelope, { modules }, found)).toMatchObject({
        reason: "handover.summary_unreadable",
      });
      expect(found).toEqual({});
      expect(await r.compareRow(envelope, { modules }, found)).toEqual({ ok: true });
      expect(fileReads.paths).toEqual([r.path]);
      expect(integrityThreads.paths).toEqual([r.path]);
    });

    it("a summary refused on a first try keeps what that try read: nothing was remembered before it", async () => {
      const r = await rig();
      const flaky: WaitronModule = {
        ...ALL_MODULES[0]!,
        name: "flaky",
        handover: {
          summarise: async () => {
            throw new Error("a fault");
          },
          checkCopy: async () => "ok",
        },
      };
      const envelope = r.resigned((body) => {
        body.snapshot.modules.push({ name: "flaky", version: flaky.version });
      });
      const found: CopyFileChecks = {};
      expect(
        await r.compareRow(envelope, { modules: [...ALL_MODULES, flaky] }, found),
      ).toMatchObject({ reason: "handover.summary_unreadable" });
      expect(found).toEqual({ bytesAndIntegrity: true, moduleChecks: null });
    });

    it("what only the spare's own files say is read every time", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      await writeFile(join(r.m2State, "backup.env"), SETTINGS);
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(
        refused("handover.backup_settings_differ"),
      );
      await rm(join(r.m2State, "backup.env"));
      expect(await r.compareRow(r.indicator, {}, found)).toEqual({ ok: true });
    });

    it("a kept file that is gone, or another size, is refused so it is fetched again", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      expect(await r.compareRow(r.indicator, {}, found)).toEqual({ ok: true });
      const bytes = await readFile(r.path);
      await writeFile(r.path, bytes.subarray(0, bytes.length - 4096));
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(refused("handover.copy_mismatch"));
      expect(found).toEqual({});
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(refused("handover.copy_mismatch"));
      found.bytesAndIntegrity = true;
      await rm(r.path);
      expect(await r.compareRow(r.indicator, {}, found)).toEqual(refused("handover.copy_mismatch"));
    });

    it("a kept path that cannot be read for another reason stays a fault", async () => {
      const r = await rig();
      const found: CopyFileChecks = {};
      expect(await r.compareRow(r.indicator, {}, found)).toEqual({ ok: true });
      await rm(dirname(r.path), { recursive: true });
      await writeFile(dirname(r.path), "a file where the folder was");
      await expect(r.compareRow(r.indicator, {}, found)).rejects.toMatchObject({
        code: "ENOTDIR",
      });
    });

    it("a stop during the check rejects, and leaves nothing remembered", async () => {
      const r = await rig();
      const stopping = new AbortController();
      stopping.abort(new Error("stopping"));
      const found: CopyFileChecks = {};
      await expect(
        compareFinalCopy(r.deps, await r.row(), r.indicator, r.path, {
          found,
          signal: stopping.signal,
        }),
      ).rejects.toThrow("stopping");
      expect(found).toEqual({});
    });
  });

  describe("each module's own check of the copy", () => {
    it("one record's amount changed, with a re-signed indicator, is refused naming the module", async () => {
      const r = await rig();
      alter(
        r.path,
        `update registros_facturacion set importe_total = printf('%.2f', importe_total + 1) where ${FIRST_CHAIN(r.m1)}`,
      );
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.chain_broken", { module: FISCAL }),
      );
    });

    it("a check that throws is refused naming the module", async () => {
      const r = await rig();
      const thrower: WaitronModule = {
        ...ALL_MODULES[0]!,
        name: "thrower",
        handover: {
          summarise: async () => ({}),
          checkCopy: async () => {
            throw new Error("no such table");
          },
        },
      };
      const modules = [...ALL_MODULES, thrower];
      const envelope = r.resigned((body) => {
        body.snapshot.modules.push({ name: "thrower", version: thrower.version });
      });
      expect(await r.compareRow(envelope, { modules })).toEqual(
        refused("handover.copy_check_failed", { module: "thrower" }),
      );
    });
  });

  describe("this box's own settings", () => {
    const write = (dir: string, file: string, text: string) => writeFile(join(dir, file), text);
    const row = (body: Mutable, item: string) => body.nodeLocal.find((one) => one.item === item)!;

    it("a spare's backup settings changed after the offer are refused", async () => {
      const r = await rig();
      await write(r.m2State, "backup.env", SETTINGS);
      expect(await r.compareRow()).toEqual(refused("handover.backup_settings_differ"));
    });

    it("control: the same settings in another order and spacing are accepted", async () => {
      const r = await rig();
      const text = "A=1\nB=2\n";
      await write(r.m1State, "backup.env", text);
      await write(r.m2State, "backup.env", "\nB=2\n\nA=1\n");
      const m1Digest = sha256Hex('{"A":"1","B":"2"}');
      const envelope = r.resigned((body) => void (row(body, "backup.env").sha256 = m1Digest));
      expect(await r.compareRow(envelope)).toEqual({ ok: true });
    });

    it("a spare's module settings changed after the offer are refused", async () => {
      const r = await rig();
      await write(r.m2State, "modules.json", JSON.stringify({ modules: { "fiscal-none": false } }));
      expect(await r.compareRow()).toEqual(refused("handover.modules_differ"));
    });

    it("an old box listing a key version the spare does not hold is refused", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => void (row(body, "secrets.env").ringVersions = [1, 9]));
      expect(await r.compareRow(envelope)).toEqual(refused("handover.key_ring_mismatch"));
    });

    it("a state folder that is gone does not read as a box with no settings", async () => {
      const r = await rig();
      const path = join(scratch, "elsewhere.db");
      await copyFile(r.path, path);
      await rm(r.m2State, { recursive: true });
      expect(
        await compareFinalCopy(r.deps, await r.row(), r.indicator, path, { found: {} }),
      ).toEqual(refused("handover.destination_settings_unreadable", { file: "backup.env" }));
    });

    it("a spare's own file that cannot be read is refused naming it", async () => {
      const r = await rig();
      await write(r.m2State, "modules.json", "{not json");
      expect(await r.compareRow()).toEqual(
        refused("handover.destination_settings_unreadable", { file: "modules.json" }),
      );
    });
  });

  describe("the retained selections", () => {
    const revisions = (body: Mutable, list: ReturnType<typeof revisionOf>[]) => {
      body.nodeLocal.find((one) => one.item === "module-preparation-state.json")!.revisions = list;
    };
    const LIMIT = 1024 * 1024;

    it("an old box's selections alone over the file's limit are refused", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => revisions(body, [revisionOf("x".repeat(LIMIT))]));
      expect(await r.compareRow(envelope)).toEqual(refused("handover.preparation_state_too_large"));
    });

    it("each box's selections fit but together they do not, so they are refused", async () => {
      const r = await rig();
      const sizeable = "x".repeat(200 * 1024);
      await writeFile(
        join(r.m2State, "module-preparation-state.json"),
        JSON.stringify({ version: 1, revisions: [revisionOf(sizeable, "own")] }),
      );
      const envelope = r.resigned((body) => revisions(body, [revisionOf(sizeable, "theirs")]));
      expect(await r.compareRow(envelope)).toEqual(refused("handover.preparation_state_too_large"));
    });

    it("selections that fit the file but leave too little room for three revisions as large are refused", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => revisions(body, [revisionOf("x".repeat(LIMIT / 2))]));
      expect(await r.compareRow(envelope)).toEqual(refused("handover.preparation_state_too_large"));
    });

    it("control: selections that leave that room are not refused", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => revisions(body, [revisionOf("x".repeat(240 * 1024))]));
      expect(await r.compareRow(envelope)).toEqual({ ok: true });
    });

    it("control: a selection both boxes hold is counted once", async () => {
      const r = await rig();
      const sizeable = "x".repeat(140 * 1024);
      await writeFile(
        join(r.m2State, "module-preparation-state.json"),
        JSON.stringify({ version: 1, revisions: [revisionOf(sizeable)] }),
      );
      const envelope = r.resigned((body) => revisions(body, [revisionOf(sizeable)]));
      expect(await r.compareRow(envelope)).toEqual({ ok: true });
    });
  });

  describe("the summaries, worked out from the received bytes", () => {
    it("bytes that match, with an indicator listing one fewer record in a chain, are refused", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => {
        const chains = body.modulesSummary[FISCAL] as { count: number }[];
        expect(chains[0]!.count).toBe(3);
        chains[0]!.count = 2;
      });
      expect(await r.compareRow(envelope)).toEqual(
        refused("handover.summary_mismatch", { module: FISCAL }),
      );
    });

    it("an indicator with no summary from a module that gives one is refused", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => {
        delete body.modulesSummary[FISCAL];
      });
      expect(await r.compareRow(envelope)).toEqual(
        refused("handover.summary_mismatch", { module: FISCAL }),
      );
    });

    it("an indicator with a summary from a module that gives none is refused", async () => {
      const r = await rig();
      const envelope = r.resigned((body) => {
        body.modulesSummary.core = {};
      });
      expect(await r.compareRow(envelope)).toEqual(
        refused("handover.summary_mismatch", { module: "core" }),
      );
    });

    it("a summary this box cannot work out has its own code, not the old box's", async () => {
      const r = await rig();
      alter(r.path, "drop table acks");
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.summary_unreadable", { module: FISCAL }),
      );
    });
  });

  describe("the spare could start from the copy", () => {
    it("a copy with no row for this box is refused", async () => {
      const r = await rig();
      alter(
        r.path,
        `delete from cadenas where node_id = '${r.m2.nodeId}';
         delete from registro_sif where node_id = '${r.m2.nodeId}';
         delete from invoice_series where node_id = '${r.m2.nodeId}';
         delete from nodes where id = '${r.m2.nodeId}'`,
      );
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.copy_lacks_destination"),
      );
    });

    it("a copy holding another key for this box is refused", async () => {
      const r = await rig();
      alter(r.path, `update nodes set public_key = 'another' where id = '${r.m2.nodeId}'`);
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.copy_lacks_destination"),
      );
    });

    it("a row for this box with this box's key passes with a different name", async () => {
      const r = await rig();
      alter(r.path, `update nodes set name = 'Elsewhere' where id = '${r.m2.nodeId}'`);
      expect(await r.compareRow(await r.resignedForFile())).toEqual({ ok: true });
    });

    it("control: the live venue's row has this box's own key", async () => {
      const r = await rig();
      const [row] = await r.db.select().from(nodes).where(eq(nodes.id, r.m2.nodeId));
      expect(row!.publicKey).toBe(nodeSigningPublicKey(r.m2Key));
    });
  });

  describe("the person who authorised the handover, according to the copy", () => {
    it.each([
      ["suspended", "status = 'suspended'"],
      ["pending", "status = 'pending'"],
      ["only a member of staff", "role = 'staff'"],
      ["only a supervisor", "role = 'supervisor'"],
      ["only a manager", "role = 'manager'"],
    ])("someone %s is refused", async (_label, change) => {
      const r = await rig();
      alter(r.path, `update persons set ${change} where id = '${r.authorisedBy}'`);
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.authoriser_not_permitted"),
      );
    });

    it("someone with no row in the copy is refused", async () => {
      const r = await rig();
      alter(r.path, `delete from persons where id = '${r.authorisedBy}'`);
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.authoriser_not_permitted"),
      );
    });

    it("a copy with no table of people is refused", async () => {
      const r = await rig();
      alter(r.path, "drop table persons");
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.authoriser_not_permitted"),
      );
    });

    it("a role this box does not know is refused, not a crash", async () => {
      const r = await rig();
      alter(
        r.path,
        `pragma ignore_check_constraints = on; update persons set role = 'later' where id = '${r.authorisedBy}'`,
      );
      expect(await r.compareRow(await r.resignedForFile())).toEqual(
        refused("handover.authoriser_not_permitted"),
      );
    });

    it("an operation stored with no offer is a fault in Waitron, not a refusal", async () => {
      const r = await rig();
      const without = { ...(await r.row()), operationId: OTHER_OP };
      await expect(
        compareFinalCopy(r.deps, without, r.indicator, r.path, { found: {} }),
      ).rejects.toThrow(OTHER_OP);
    });
  });

  describe("the order of the checks", () => {
    it("each earlier check is reported before a later one that would also refuse", async () => {
      const r = await rig();
      // Everything wrong at once, then each put right in the order the checks run.
      await writeFile(join(r.m2State, "backup.env"), SETTINGS);
      alter(
        r.path,
        `insert into __drizzle_migrations_db (hash, created_at) values ('from-later', 1);
         update registros_facturacion set importe_total = '1.00' where ${FIRST_CHAIN(r.m1)}`,
      );
      const lying = await r.resignedForFile((body) => {
        (body.modulesSummary[FISCAL] as { count: number }[])[0]!.count = 2;
        body.snapshot.modules.pop();
      });
      const reasons = [
        await r.compareRow({ ...lying, signature: Buffer.alloc(64).toString("base64") }),
        await r.compareRow(lying),
      ].map((result) => (result as { reason: string }).reason);
      expect(reasons).toEqual(["handover.indicator_untrusted", "provisioning.database_ahead"]);

      await copyFile(finalCopyPath(r.m1State, OP), r.path);
      alter(
        r.path,
        `update registros_facturacion set importe_total = '1.00' where ${FIRST_CHAIN(r.m1)}`,
      );
      const stillLying = await r.resignedForFile((body) => {
        (body.modulesSummary[FISCAL] as { count: number }[])[0]!.count = 2;
      });
      const noModule = await r.resignedForFile((body) => {
        (body.modulesSummary[FISCAL] as { count: number }[])[0]!.count = 2;
        body.snapshot.modules.pop();
      });
      expect(await r.compareRow(noModule)).toMatchObject({ reason: "handover.modules_differ" });
      expect(await r.compareRow(stillLying)).toMatchObject({ reason: "handover.chain_broken" });

      await copyFile(finalCopyPath(r.m1State, OP), r.path);
      const summaryAlso = r.resigned((body) => {
        (body.modulesSummary[FISCAL] as { count: number }[])[0]!.count = 2;
      });
      expect(await r.compareRow(summaryAlso)).toMatchObject({
        reason: "handover.backup_settings_differ",
      });
      await rm(join(r.m2State, "backup.env"));
      expect(await r.compareRow(summaryAlso)).toMatchObject({
        reason: "handover.summary_mismatch",
      });
    });
  });
});

interface PostSeen {
  text: string;
  state: string;
  fileThere: boolean;
}

describe("the spare's duty runs the real comparison", () => {
  const log: Logger = () => {};

  async function dutyRig() {
    const r = await rig();
    const app = new Hono();
    const peer = { db: r.db, node: suite.node, ring: RING, nodeId: r.m1.nodeId };
    const posted: PostSeen[] = [];
    const seam: { answer: (text: string, drop: () => void) => Promise<Response> | Response } = {
      answer: () => new Response("{}", { status: 503 }),
    };
    app.post("/api/node/handover/:operationId/acceptance", async (c) => {
      const text = await c.req.text();
      posted.push({
        text,
        state: (await readHandoverOperation(suite.node, r.m2.nodeId, OP))!.state,
        fileThere: existsSync(acceptedCopyPath(r.m2State, OP)),
      });
      return seam.answer(text, () =>
        (c.env as { incoming: IncomingMessage }).incoming.socket.destroy(),
      );
    });
    mountPeerStatusApi(app, peer, () => {});
    mountHandoverSourceApi(app, r.captureDeps, () => {});
    const requests: string[] = [];
    const real = getRequestListener(app.fetch) as RequestListener;
    const server: Server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      real(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(
      () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const body: MembershipDocumentBody = {
      term: 3,
      nodes: [
        { nodeId: r.m1.nodeId, contactUrl: url, standing: "serving-primary" },
        { nodeId: r.m2.nodeId, contactUrl: "https://box-1", standing: "serving-secondary" },
      ],
    };
    await writeNodeMembership(r.db, {
      body,
      signerNodeId: r.m1.nodeId,
      signature: signDocumentBody(body, r.m1Key),
      endorsements: [endorseKey(r.m2.nodeId, nodeSigningPublicKey(r.m2Key), r.m1.nodeId, r.m1Key)],
    });
    await stampDeployment(r.db, "preproduction");
    await setNodeMode({ venue: r.db, node: suite.node }, r.m2.nodeId, "mirror");
    await writeMirrorLink(suite.node, r.m2.nodeId, {
      relayUrl: "http://127.0.0.1:1/",
      boxHostname: "box.local",
      boxCaPem: "no certificate",
      originNodeId: r.m1.nodeId,
    });
    await rm(r.path);
    const start = async (overrides: Partial<DestinationDutyDeps> = {}) => {
      const duty = await startHandoverDestinationDuty({
        db: r.db,
        node: suite.node,
        ring: RING,
        nodeId: r.m2.nodeId,
        stateDir: r.m2State,
        venueDir: dirname(r.m2State),
        log,
        restart: () => {},
        tickMs: 20,
        compare: (operation, indicator, path, options) =>
          compareFinalCopy(r.deps, operation, indicator, path, options),
        ...overrides,
      });
      closers.push(() => duty?.stop() ?? Promise.resolve());
      return duty;
    };
    /** As boot starts it, past accepting. The rig's `start` is `stopped`, which stops short. */
    const startAccepting = start;
    const m1Row = async () => (await readHandoverOperation(suite.node, r.m1.nodeId, OP))!;
    const copyReads = () => requests.filter((line) => line.endsWith("/final-copy")).length;
    const stopped = (overrides: Partial<DestinationDutyDeps>) =>
      start({ ...stopShortOfAccepting(), ...overrides });
    /** What M1 owes for `acceptanceText`, with `change` made and signed as M1, unless `by` says. */
    const relinquishment = (
      acceptanceText: string,
      change: (body: Record<string, unknown>) => void = () => {},
      by: { nodeId: string; privateKey: string } = r.signer,
    ) => {
      const body: Record<string, unknown> = {
        binding: r.binding,
        indicatorDigest: envelopeDigest(r.indicator),
        acceptanceDigest: envelopeDigest(
          JSON.parse(acceptanceText) as SignedHandoverEnvelope<unknown>,
        ),
        filingAssignedTo: r.m2.nodeId,
        authorisedBy: r.authorisedBy,
      };
      change(body);
      return signEnvelope("relinquishment", body as CanonicalValue, by);
    };
    const answerWith = (envelope: unknown) =>
      new Response(JSON.stringify(envelope), {
        headers: { "content-type": "application/json" },
      });
    const refusal = (code: string, status = 409) =>
      new Response(JSON.stringify({ error: { code, params: {} } }), { status });
    return {
      ...r,
      start: stopped,
      startAccepting,
      requests,
      m1Row,
      copyReads,
      posted,
      seam,
      relinquishment,
      answerWith,
      refusal,
    };
  }

  it("a copy differing by one late row is refused, M1 stays stepped down, and it is fetched again", async () => {
    const r = await dutyRig();
    let late = true;
    const compare = vi.fn(
      (operation: HandoverOperation, indicator: unknown, path: string, options: CompareOptions) =>
        compareFinalCopy(r.deps, operation, indicator, path, options),
    );
    const download = vi.fn(async (...args: Parameters<typeof boxDownload>) => {
      const answer = await boxDownload(...args);
      if (late) {
        alter(args[2], `update persons set display_name = 'Late' where id = '${r.authorisedBy}'`);
      }
      return answer;
    });
    await r.start({ compare, download });
    await vi.waitFor(
      async () => expect((await r.row()).waitingReason).toBe("handover.copy_mismatch"),
      { timeout: 15_000 },
    );
    // Failing case: a state past `prepared`, or anything M1 was told beyond the three reads.
    expect((await r.row()).state).toBe("prepared");
    expect((await r.m1Row()).state).toBe("source_stepped_down");
    expect(await readHandoverRestriction(suite.node, r.m1.nodeId)).toMatchObject({
      kind: "handed-over",
    });
    const asked = new Set(r.requests.map((line) => line.split("/").pop()));
    expect([...asked].sort()).toEqual(["final-copy", "indicator", "peer-status"]);

    late = false;
    await vi.waitFor(async () => expect((await r.row()).waitingReason).toBeNull(), {
      timeout: 15_000,
    });
    expect(await compare.mock.results.at(-1)!.value).toEqual({ ok: true });
    expect(r.copyReads()).toBeGreaterThan(1);
    expect(existsSync(r.path)).toBe(true);
    expect((await r.row()).state).toBe("prepared");
  }, 60_000);

  it("a copy with no journal for an enabled set waits refused, with M1 stopped and no acceptance sent", async () => {
    const r = await dutyRig();
    const coreJournal = manifestSets().find((set) => set.name === "core")!.table;
    const download = vi.fn(async (...args: Parameters<typeof boxDownload>) => {
      const answer = await boxDownload(...args);
      alter(args[2], `drop table ${coreJournal}`);
      return answer;
    });
    await r.startAccepting({
      download,
      compare: async (operation, _indicator, path, options) =>
        compareFinalCopy(r.deps, operation, await r.resignedForFile(), path, options),
    });
    await vi.waitFor(
      async () => expect((await r.row()).waitingReason).toBe("handover.modules_differ"),
      { timeout: 15_000 },
    );
    expect((await r.row()).state).toBe("prepared");
    expect(r.posted).toEqual([]);
    expect((await r.m1Row()).state).toBe("source_stepped_down");
    expect(await readHandoverRestriction(suite.node, r.m1.nodeId)).toMatchObject({
      kind: "handed-over",
    });
  }, 60_000);

  it("a setting that differs keeps the file, and a person's fix lets a later compare accept it", async () => {
    const r = await dutyRig();
    await writeFile(join(r.m2State, "backup.env"), SETTINGS);
    await r.start({ compareRetryMs: 50 });
    await vi.waitFor(
      async () => expect((await r.row()).waitingReason).toBe("handover.backup_settings_differ"),
      { timeout: 15_000 },
    );
    expect(existsSync(r.path)).toBe(true);
    await rm(join(r.m2State, "backup.env"));
    await vi.waitFor(async () => expect((await r.row()).waitingReason).toBeNull(), {
      timeout: 15_000,
    });
    expect(r.copyReads()).toBe(1);
  }, 60_000);

  it("waiting on a setting checks the file once however often it compares", async () => {
    const r = await dutyRig();
    await writeFile(join(r.m2State, "backup.env"), SETTINGS);
    const compare = vi.fn(
      (operation: HandoverOperation, indicator: unknown, path: string, options: CompareOptions) =>
        compareFinalCopy(r.deps, operation, indicator, path, options),
    );
    integrityThreads.paths.length = 0;
    await r.start({ compare, compareRetryMs: 30 });
    await vi.waitFor(() => expect(compare.mock.calls.length).toBeGreaterThanOrEqual(3), {
      timeout: 15_000,
    });
    // Failing case: one thread per compare, each reading the whole file.
    expect(integrityThreads.paths).toEqual([r.path]);
    expect(r.copyReads()).toBe(1);
  }, 60_000);

  it("a kept file changed at the same size is thrown away and fetched again", async () => {
    const r = await dutyRig();
    await writeFile(join(r.m2State, "backup.env"), SETTINGS);
    let tries = 0;
    const compare = vi.fn(
      async (
        operation: HandoverOperation,
        indicator: unknown,
        path: string,
        options: CompareOptions,
      ) => {
        tries += 1;
        if (tries === 2) {
          alter(
            path,
            `update registros_facturacion set importe_total = printf('%.2f', importe_total + 1) where ${FIRST_CHAIN(r.m1)}`,
          );
          await rm(join(r.m2State, "backup.env"));
        }
        return compareFinalCopy(r.deps, operation, indicator, path, options);
      },
    );
    await r.start({ compare, compareRetryMs: 30 });
    await vi.waitFor(() => expect(tries).toBeGreaterThanOrEqual(3), { timeout: 15_000 });
    await vi.waitFor(async () => expect((await r.row()).waitingReason).toBeNull(), {
      timeout: 15_000,
    });
    // Failing case: two tries, one read, and the forged file kept as accepted.
    expect(await compare.mock.results[1]!.value).toEqual(refused("handover.copy_mismatch"));
    expect(await compare.mock.results.at(-1)!.value).toEqual({ ok: true });
    expect(r.copyReads()).toBe(2);
    expect(sha256Hex(await readFile(r.path))).toBe(r.indicator.body.snapshot.sha256);
  }, 60_000);

  it("a file fetched again is checked again from nothing", async () => {
    const r = await dutyRig();
    let late = true;
    const seen: CopyFileChecks[] = [];
    const compare = vi.fn(
      (operation: HandoverOperation, indicator: unknown, path: string, options: CompareOptions) => {
        seen.push(options.found);
        return compareFinalCopy(r.deps, operation, indicator, path, options);
      },
    );
    const download = vi.fn(async (...args: Parameters<typeof boxDownload>) => {
      const answer = await boxDownload(...args);
      if (late) {
        late = false;
        alter(args[2], `update persons set display_name = 'Late' where id = '${r.authorisedBy}'`);
      }
      return answer;
    });
    await r.start({ compare, download });
    await vi.waitFor(() => expect(seen.at(-1)?.bytesAndIntegrity).toBe(true), { timeout: 15_000 });
    // Failing case: the second file carries the first's record, or no second file was compared.
    expect(seen.length).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]).toEqual({});
  }, 60_000);

  it("a page a summary reads, damaged while the spare waits on a setting, is fetched again", async () => {
    const r = await dutyRig();
    await writeFile(join(r.m2State, "backup.env"), SETTINGS);
    await r.start({ compareRetryMs: 30 });
    await vi.waitFor(
      async () => expect((await r.row()).waitingReason).toBe("handover.backup_settings_differ"),
      { timeout: 15_000 },
    );
    expect(r.copyReads()).toBe(1);
    await damageRootPage(r.path, "registros_facturacion");
    await rm(join(r.m2State, "backup.env"));
    // Failing case: the count stays at 1, waiting on `summary_unreadable` until the box restarts.
    await vi.waitFor(() => expect(r.copyReads()).toBeGreaterThan(1), { timeout: 15_000 });
  });

  it("a kept file turned to noise while the spare waits on a setting is fetched again", async () => {
    const r = await dutyRig();
    await writeFile(join(r.m2State, "backup.env"), SETTINGS);
    await r.start({ compareRetryMs: 30 });
    await vi.waitFor(
      async () => expect((await r.row()).waitingReason).toBe("handover.backup_settings_differ"),
      { timeout: 15_000 },
    );
    expect(r.copyReads()).toBe(1);
    await writeFile(r.path, randomBytes((await stat(r.path)).size));
    // Failing case: the count stays at 1, each try throwing, until the box restarts.
    await vi.waitFor(() => expect(r.copyReads()).toBeGreaterThan(1), { timeout: 15_000 });
  });

  describe("accepting the copy and asking the old box to give up filing", () => {
    const acceptedEvent = (r: { m2: SeededNode }) =>
      readHandoverEvent(suite.node, r.m2.nodeId, OP, "copy_accepted");

    it("a real download stays readable by its owner alone through acceptance, under a permissive mask", async () => {
      // Under this mask a file created with no stated mode comes out 644. It holds over M1's
      // capture too, which the rig takes.
      const mask = process.umask(0o022);
      try {
        const r = await dutyRig();
        const received: number[] = [];
        const download = vi.fn(async (...args: Parameters<typeof boxDownload>) => {
          const answer = await boxDownload(...args);
          received.push(statSync(args[2]).mode & 0o777);
          return answer;
        });
        r.seam.answer = () => r.refusal("handover.not_stepped_down");
        await r.startAccepting({ download });
        await vi.waitFor(async () => expect((await r.row()).state).toBe("copy_accepted"), {
          timeout: 15_000,
        });
        expect(statSync(finalCopyPath(r.m1State, OP)).mode & 0o777).toBe(0o600);
        expect(received).toEqual([0o600]);
        expect(statSync(acceptedCopyPath(r.m2State, OP)).mode & 0o777).toBe(0o600);
      } finally {
        process.umask(mask);
      }
    });

    it("reads the chart once before each post the old box refuses", async () => {
      const r = await dutyRig();
      const atEachPost: number[] = [];
      r.seam.answer = () => {
        atEachPost.push(chartReads.count);
        return r.refusal("handover.not_stepped_down");
      };
      await r.startAccepting();
      await vi.waitFor(() => expect(atEachPost.length).toBeGreaterThan(3), { timeout: 15_000 });
      const betweenPosts = atEachPost.slice(1, 4).map((reads, index) => reads - atEachPost[index]!);
      // Failing case, the address and the check each reading it: 2 between each post.
      expect(betweenPosts).toEqual([1, 1, 1]);
    });

    it("control: an unaltered copy is kept as accepted, recorded, posted, and filing is assumed", async () => {
      const r = await dutyRig();
      const original = await readFile(finalCopyPath(r.m1State, OP));
      let answered: unknown;
      r.seam.answer = (text) => {
        answered = r.relinquishment(text);
        return r.answerWith(answered);
      };
      await r.startAccepting();
      await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
        timeout: 15_000,
      });
      // Failing case, on a duty with no acceptance step: the row stays at `prepared`.
      expect((await r.row()).waitingReason).toBeNull();
      expect(existsSync(r.path)).toBe(false);
      expect(Buffer.compare(await readFile(acceptedCopyPath(r.m2State, OP)), original)).toBe(0);

      const event = await acceptedEvent(r);
      const stored = JSON.parse(event!.envelope!) as SignedHandoverEnvelope<{
        binding: unknown;
        indicatorDigest: string;
        acceptedAtMs: number;
      }>;
      const verdict = verifyEnvelope(stored, "acceptance", (id) =>
        id === r.m2.nodeId ? nodeSigningPublicKey(r.m2Key) : undefined,
      );
      expect(verdict.valid).toBe(true);
      expect(stored.body.binding).toEqual(r.binding);
      expect(stored.body.indicatorDigest).toBe(envelopeDigest(r.indicator));
      expect(typeof stored.body.acceptedAtMs).toBe("number");
      expect(r.posted.map((post) => post.text)).toEqual([event!.envelope]);

      // The placing step at a later start reads the indicator, and M2's copy has no other record.
      const indicatorEvent = await readHandoverEvent(suite.node, r.m2.nodeId, OP, "final_state");
      expect(JSON.parse(indicatorEvent!.envelope!)).toEqual(r.indicator);

      const assumed = await readHandoverEvent(suite.node, r.m2.nodeId, OP, "filing_assumed");
      expect(JSON.parse(assumed!.envelope!)).toEqual(answered);
    }, 60_000);

    it("nothing is posted before copy_accepted and the file are on disk", async () => {
      const r = await dutyRig();
      r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
      await r.startAccepting();
      await vi.waitFor(() => expect(r.posted.length).toBeGreaterThan(0), { timeout: 15_000 });
      // Failing case, posting before the record: the first post reads `prepared`.
      expect(r.posted[0]).toMatchObject({ state: "copy_accepted", fileThere: true });
    }, 60_000);

    it("a failure to accept posts nothing and keeps the file, and a later compare accepts it", async () => {
      const r = await dutyRig();
      r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
      let failing = true;
      const accept = vi.fn<typeof acceptFinalCopy>(async (...args) => {
        if (failing) throw new Error("the disk refused");
        return acceptFinalCopy(...args);
      });
      await r.start({ accept, compareRetryMs: 30 });
      await vi.waitFor(() => expect(accept.mock.calls.length).toBeGreaterThanOrEqual(2), {
        timeout: 15_000,
      });
      expect(r.posted).toEqual([]);
      expect((await r.row()).state).toBe("prepared");
      expect(existsSync(r.path)).toBe(true);
      expect(r.copyReads()).toBe(1);
      failing = false;
      await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
        timeout: 15_000,
      });
    }, 60_000);

    it("flushes the folder holding the moved file before it records anything", async () => {
      const r = await dutyRig();
      await mkdir(dirname(r.path), { recursive: true });
      await copyFile(finalCopyPath(r.m1State, OP), r.path);
      const folder = dirname(acceptedCopyPath(r.m2State, OP));
      const recordedAtFlush: unknown[] = [];
      fileFlushes.seen = async (path) => {
        if (path === folder) recordedAtFlush.push(await acceptedEvent(r));
      };
      try {
        const deps = { node: suite.node, ring: RING, nodeId: r.m2.nodeId, stateDir: r.m2State };
        await acceptFinalCopy(deps, await r.row(), r.indicator, r.path);
      } finally {
        fileFlushes.seen = null;
      }
      expect(recordedAtFlush).toEqual([null]);
      expect(await acceptedEvent(r)).not.toBeNull();
    }, 60_000);

    it("a file that cannot be moved into place records nothing", async () => {
      const r = await dutyRig();
      await mkdir(dirname(r.path), { recursive: true });
      await copyFile(finalCopyPath(r.m1State, OP), r.path);
      // A folder holding a file refuses the move onto it.
      await mkdir(join(acceptedCopyPath(r.m2State, OP), "in-the-way"), { recursive: true });
      const deps = { node: suite.node, ring: RING, nodeId: r.m2.nodeId, stateDir: r.m2State };
      await expect(acceptFinalCopy(deps, await r.row(), r.indicator, r.path)).rejects.toMatchObject(
        { code: "EISDIR", syscall: "rename" },
      );
      // Failing case, recording before the move: `copy_accepted` with no accepted file.
      expect((await r.row()).state).toBe("prepared");
      expect(await acceptedEvent(r)).toBeNull();
      expect(await readHandoverEvent(suite.node, r.m2.nodeId, OP, "final_state")).toBeNull();
    }, 60_000);

    it("an operation closed while it compared is not accepted", async () => {
      const r = await dutyRig();
      const accept = vi.fn<typeof acceptFinalCopy>(async () => {});
      await r.start({
        accept,
        compare: async () => {
          await advanceHandover(r.m2Store, OP, "abandoned", {});
          return { ok: true };
        },
      });
      await vi.waitFor(async () => expect((await r.row()).state).toBe("abandoned"), {
        timeout: 15_000,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Failing case: accept is told of a closed operation.
      expect(accept).not.toHaveBeenCalled();
    }, 60_000);

    it("a lost answer posts the same bytes again, and the reason clears when one arrives", async () => {
      const r = await dutyRig();
      let lose = 2;
      r.seam.answer = (text, drop) => {
        if (lose > 0) {
          lose -= 1;
          drop();
        }
        return r.answerWith(r.relinquishment(text));
      };
      await r.startAccepting();
      await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
        timeout: 15_000,
      });
      expect(r.posted.length).toBe(3);
      expect(new Set(r.posted.map((post) => post.text)).size).toBe(1);
      expect((await r.row()).waitingReason).toBeNull();
    }, 60_000);

    it("restarted at copy_accepted, M2 posts the same acceptance again and records filing_assumed", async () => {
      const r = await dutyRig();
      const first = (await r.startAccepting())!;
      await vi.waitFor(() => expect(r.posted.length).toBeGreaterThan(0), { timeout: 15_000 });
      await first.stop();
      const before = r.posted[0]!.text;
      const reads = r.copyReads();

      r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
      await r.startAccepting();
      await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
        timeout: 15_000,
      });
      // Failing case, signing a new one on each start: a later `acceptedAtMs` and signature.
      expect(r.posted.at(-1)!.text).toBe(before);
      expect(r.copyReads()).toBe(reads);
      expect(existsSync(acceptedCopyPath(r.m2State, OP))).toBe(true);
    }, 60_000);

    it("a file left by a crash between the move and the record is gone before the download starts", async () => {
      const r = await dutyRig();
      const original = await readFile(finalCopyPath(r.m1State, OP));
      const accepted = acceptedCopyPath(r.m2State, OP);
      await mkdir(dirname(accepted), { recursive: true });
      await writeFile(accepted, "left by a crash");
      const thereAtDownload: boolean[] = [];
      r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
      await r.startAccepting({
        download: (...args) => {
          thereAtDownload.push(existsSync(accepted));
          return boxDownload(...args);
        },
      });
      await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
        timeout: 15_000,
      });
      // Failing case, keeping it: `[true]`, so a second whole copy has to fit beside the first.
      expect(thereAtDownload).toEqual([false]);
      expect(Buffer.compare(await readFile(accepted), original)).toBe(0);
    }, 60_000);

    it("with the accepted file missing nothing is posted, and it waits until the file is back", async () => {
      const r = await dutyRig();
      const first = (await r.startAccepting())!;
      await vi.waitFor(() => expect(r.posted.length).toBeGreaterThan(0), { timeout: 15_000 });
      await first.stop();
      const accepted = acceptedCopyPath(r.m2State, OP);
      const aside = `${accepted}.aside`;
      await rename(accepted, aside);
      r.posted.length = 0;
      r.seam.answer = (text) => r.answerWith(r.relinquishment(text));

      await r.startAccepting();
      await vi.waitFor(
        async () =>
          expect(
            r.posted.length > 0 ||
              (await r.row()).waitingReason === "handover.accepted_copy_missing",
          ).toBe(true),
        { timeout: 15_000 },
      );
      // Failing case, posting anyway: a post with `fileThere: false`, and M1 would give up filing.
      expect(r.posted).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(r.posted).toEqual([]);
      expect(await r.row()).toMatchObject({
        state: "copy_accepted",
        waitingReason: "handover.accepted_copy_missing",
      });

      // Control: with the file there, the same duty posts and takes over.
      await rename(aside, accepted);
      await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
        timeout: 15_000,
      });
      expect(r.posted.length).toBeGreaterThan(0);
      expect(r.posted.every((post) => post.fileThere)).toBe(true);
      expect((await r.row()).waitingReason).toBeNull();
    }, 60_000);

    describe("room to place the copy, before the old box is told to give up filing", () => {
      /** Free space that always reads `free()`, on every folder unless `at` says otherwise. */
      const reading = (free: () => number, at: (path: string) => boolean = () => true) => ({
        statfs: (path: string) =>
          at(path)
            ? Promise.resolve({ bavail: free(), frsize: 1 })
            : Promise.resolve({ bavail: Number.MAX_SAFE_INTEGER, frsize: 1 }),
      });
      const needed = (r: { m2State: string }) =>
        statSync(acceptedCopyPath(r.m2State, OP)).size + START_FREE_SPACE_FLOOR;

      it("one byte short nothing is posted; a pass goes on to post once room appears", async () => {
        const r = await dutyRig();
        r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
        let short = 1;
        const waits: unknown[] = [];
        await r.startAccepting({
          ...reading(() => needed(r) - short),
          log: (_level, event, detail) => {
            if (event === "handover-destination.waiting") waits.push(detail);
          },
        });

        await vi.waitFor(
          async () => expect((await r.row()).waitingReason).toBe("handover.no_room_to_place"),
          { timeout: 15_000 },
        );
        // Failing case, posting regardless: posts here, and M1 gives up filing for a box that cannot place.
        expect(r.posted).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(r.posted).toEqual([]);
        expect((await r.row()).state).toBe("copy_accepted");
        // Written once though many passes checked.
        expect(waits).toEqual([
          expect.objectContaining({
            reason: "handover.no_room_to_place",
            neededBytes: needed(r),
            availableBytes: needed(r) - 1,
          }),
        ]);

        short = 0;
        await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
          timeout: 15_000,
        });
        expect(r.posted.length).toBeGreaterThan(0);
        expect((await r.row()).waitingReason).toBeNull();
      }, 60_000);

      it.each([
        ["the state folder", (r: { m2State: string }, path: string) => path === r.m2State],
        ["the venue folder", (r: { m2State: string }, path: string) => path !== r.m2State],
      ])(
        "%s short of room is enough to wait",
        async (_name, lowFolder) => {
          const r = await dutyRig();
          r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
          await r.startAccepting(
            reading(
              () => 0,
              (path) => lowFolder(r, path),
            ),
          );

          await vi.waitFor(
            async () => expect((await r.row()).waitingReason).toBe("handover.no_room_to_place"),
            { timeout: 15_000 },
          );
          expect(r.posted).toEqual([]);
        },
        60_000,
      );

      it("a disk that cannot say how much is free is not told to the old box as room", async () => {
        const r = await dutyRig();
        r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
        await r.startAccepting({ statfs: () => Promise.reject(new Error("cannot say")) });

        await vi.waitFor(
          async () => expect((await r.row()).waitingReason).toBe("handover.no_room_to_place"),
          { timeout: 15_000 },
        );
        expect(r.posted).toEqual([]);
      }, 60_000);

      it("a missing file is named as missing, not as no room", async () => {
        const r = await dutyRig();
        const first = (await r.startAccepting(reading(() => 0)))!;
        await vi.waitFor(
          async () => expect((await r.row()).waitingReason).toBe("handover.no_room_to_place"),
          { timeout: 15_000 },
        );
        await first.stop();
        await rm(acceptedCopyPath(r.m2State, OP));

        await r.startAccepting(reading(() => 0));
        await vi.waitFor(
          async () => expect((await r.row()).waitingReason).toBe("handover.accepted_copy_missing"),
          { timeout: 15_000 },
        );
      }, 60_000);
    });

    describe("the restart that places the copy", () => {
      async function assumed(restart: () => void) {
        const r = await dutyRig();
        r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
        const duty = (await r.startAccepting({ restart }))!;
        await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
          timeout: 15_000,
        });
        return { r, duty };
      }

      it("a restart that does nothing, as a lost signal does, is asked for again on later passes", async () => {
        let asked = 0;
        const { r } = await assumed(() => (asked += 1));

        // Failing case, asking only at the transition: `asked` stays at 1 and the box stays on its old file.
        await vi.waitFor(() => expect(asked).toBeGreaterThanOrEqual(3), { timeout: 15_000 });
        expect((await r.row()).state).toBe("filing_assumed");
        expect(await readHandoverEvent(suite.node, r.m2.nodeId, OP, COPY_PLACED_EVENT)).toBeNull();
      }, 60_000);

      it("does not ask once copy_placed is recorded", async () => {
        let asked = 0;
        const { r, duty } = await assumed(() => (asked += 1));
        await withNodeTransaction(suite.node, (tx) =>
          appendHandoverEventTx(tx, {
            nodeId: r.m2.nodeId,
            operationId: OP,
            kind: COPY_PLACED_EVENT,
            detail: {},
            envelope: null,
          }),
        );
        duty.wake();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const settled = asked;

        duty.wake();
        await new Promise((resolve) => setTimeout(resolve, 200));
        // Failing case, ignoring the event: this box would restart for ever.
        expect(asked).toBe(settled);
      }, 60_000);

      it("a box left alone off mirror does not ask, on a running duty or a new one (R6)", async () => {
        let asked = 0;
        const { r, duty } = await assumed(() => (asked += 1));
        await setNodeMode({ venue: r.db, node: suite.node }, r.m2.nodeId, "primary");
        duty.wake();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const settled = asked;

        duty.wake();
        await new Promise((resolve) => setTimeout(resolve, 200));
        // Failing case, no mode check: asks every pass, and a selling box restarts in a loop.
        expect(asked).toBe(settled);

        expect(await r.startAccepting({ restart: () => (asked += 1) })).toBeUndefined();
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(asked).toBe(settled);
      }, 60_000);
    });

    it("at filing_assumed it posts nothing more, however often it is started", async () => {
      const r = await dutyRig();
      r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
      const duty = (await r.startAccepting())!;
      await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
        timeout: 15_000,
      });
      const posts = r.posted.length;
      duty.wake();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await r.startAccepting();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(r.posted.length).toBe(posts);
    }, 60_000);

    it.each([
      ["handover.not_stepped_down", "handover.not_stepped_down"],
      ["handover.operation_unknown", "handover.operation_unknown"],
      ["handover.peer_unknown", "handover.peer_unknown"],
      ["handover.indicator_mismatch", "handover.indicator_mismatch"],
      ["handover.summary_failed", "handover.source_unreachable"],
      ["box.some_other_refusal", "handover.source_unreachable"],
    ])(
      "M1 answering %s waits on %s, writes it once, and keeps posting",
      async (code, reason) => {
        const r = await dutyRig();
        const waits: unknown[] = [];
        r.seam.answer = () => r.refusal(code);
        await r.startAccepting({
          log: (_level, event, detail) => {
            if (event === "handover-destination.waiting") waits.push(detail);
          },
        });
        await vi.waitFor(() => expect(r.posted.length).toBeGreaterThanOrEqual(3), {
          timeout: 15_000,
        });
        expect((await r.row()).waitingReason).toBe(reason);
        expect((await r.row()).state).toBe("copy_accepted");
        expect(waits).toEqual([expect.objectContaining({ reason })]);

        r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
        await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
          timeout: 15_000,
        });
        expect((await r.row()).waitingReason).toBeNull();
      },
      60_000,
    );

    it("a box answering nothing waits as unreachable, then is asked again", async () => {
      const r = await dutyRig();
      let hang = true;
      r.seam.answer = (text) =>
        hang ? new Promise<Response>(() => {}) : r.answerWith(r.relinquishment(text));
      await r.startAccepting({ acceptanceLimitMs: 100 });
      await vi.waitFor(
        async () => expect((await r.row()).waitingReason).toBe("handover.source_unreachable"),
        { timeout: 15_000 },
      );
      hang = false;
      await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
        timeout: 15_000,
      });
    }, 60_000);

    it("a stop ends a post under way, leaving the state as it was", async () => {
      const r = await dutyRig();
      r.seam.answer = () => new Promise<Response>(() => {});
      const duty = (await r.startAccepting())!;
      await vi.waitFor(() => expect(r.posted.length).toBe(1), { timeout: 15_000 });
      const stopping = performance.now();
      await duty.stop();
      // Failing case, with the stop not reaching the request: it waits out the 30-second limit.
      expect(performance.now() - stopping).toBeLessThan(5000);
      const row = await r.row();
      expect(row.state).toBe("copy_accepted");
      expect(row.waitingReason).toBeNull();
    }, 60_000);

    it("with nowhere to post to it waits as unreachable and posts nothing", async () => {
      const r = await dutyRig();
      const first = (await r.startAccepting())!;
      await vi.waitFor(() => expect(r.posted.length).toBeGreaterThan(0), { timeout: 15_000 });
      await first.stop();
      const posts = r.posted.length;
      const held = await readNodeMembership(r.db);
      const body: MembershipDocumentBody = {
        ...held!.body,
        nodes: held!.body.nodes.map((n) =>
          n.nodeId === r.m1.nodeId ? { ...n, contactUrl: "http://box-1.example" } : n,
        ),
      };
      await writeNodeMembership(r.db, {
        ...held!,
        body,
        signature: signDocumentBody(body, r.m1Key),
      });
      await r.startAccepting();
      await vi.waitFor(
        async () => expect((await r.row()).waitingReason).toBe("handover.source_unreachable"),
        { timeout: 15_000 },
      );
      expect(r.posted.length).toBe(posts);
    }, 60_000);

    describe("a chart that no longer has the old box as the main box", () => {
      const chartWith = async (
        r: Awaited<ReturnType<typeof dutyRig>>,
        term: number,
        standing: "serving-primary" | "sell-only" | "evicted",
      ) => {
        const held = await readNodeMembership(r.db);
        const body: MembershipDocumentBody = {
          term,
          nodes: [
            ...held!.body.nodes.filter((n) => n.nodeId !== THIRD_BOX),
            ...(standing === "serving-primary"
              ? []
              : [
                  {
                    nodeId: THIRD_BOX,
                    contactUrl: "https://third.example",
                    standing: "serving-primary" as const,
                  },
                ]),
          ].map((n) => (n.nodeId === r.m1.nodeId ? { ...n, standing } : n)),
        };
        await writeNodeMembership(r.db, {
          ...held!,
          body,
          signature: signDocumentBody(body, r.m1Key),
        });
      };

      it.each(["sell-only", "evicted"] as const)(
        "the old box %s before the post: it is never asked to give up filing, and a chart naming it again carries on",
        async (standing) => {
          const r = await dutyRig();
          const restart = vi.fn();
          r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
          await r.startAccepting({
            restart,
            // After the comparison, which reads the old box's signed answers against this chart.
            compare: async (operation, indicator, path, options) => {
              const outcome = await compareFinalCopy(r.deps, operation, indicator, path, options);
              await chartWith(r, 4, standing);
              return outcome;
            },
          });
          await vi.waitFor(
            async () =>
              expect(await r.row()).toMatchObject({
                state: "copy_accepted",
                waitingReason: "handover.source_no_longer_main",
              }),
            { timeout: 15_000 },
          );
          expect(r.posted).toEqual([]);
          expect(await readHandoverEvent(suite.node, r.m2.nodeId, OP, "filing_assumed")).toBeNull();
          expect(restart).not.toHaveBeenCalled();

          await chartWith(r, 5, "serving-primary");
          await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
            timeout: 15_000,
          });
          expect((await r.row()).waitingReason).toBeNull();
          expect(restart).toHaveBeenCalled();
        },
        60_000,
      );

      describe("at filing_assumed, before the start that places", () => {
        async function assumed() {
          const r = await dutyRig();
          r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
          const counted = { asked: 0 };
          const duty = (await r.startAccepting({ restart: () => (counted.asked += 1) }))!;
          await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
            timeout: 15_000,
          });
          return { r, duty, counted };
        }

        /** Tick is 20 ms, so each wait holds several passes, and the wake one more at once. */
        async function severalPasses(duty: HandoverDestinationDuty): Promise<void> {
          for (let wait = 0; wait < 3; wait += 1) {
            duty.wake();
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        it.each(["sell-only", "evicted"] as const)(
          "the old box %s: it waits and asks for no restart over many passes, and a chart naming it again asks",
          async (standing) => {
            const { r, duty, counted } = await assumed();
            await chartWith(r, 4, standing);
            await vi.waitFor(
              async () =>
                expect((await r.row()).waitingReason).toBe("handover.source_no_longer_main"),
              { timeout: 15_000 },
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
            const settled = counted.asked;

            await severalPasses(duty);
            // Failing case, the duty asking at every pass: about 30 more, a box restarting for ever.
            expect(counted.asked).toBe(settled);
            expect((await r.row()).state).toBe("filing_assumed");
            expect(r.posted).toHaveLength(1);

            await chartWith(r, 5, "serving-primary");
            await vi.waitFor(() => expect(counted.asked).toBeGreaterThan(settled), {
              timeout: 15_000,
            });
            // Failing case, leaving the reason: this box says it waits while it is restarting.
            expect((await r.row()).waitingReason).toBeNull();
          },
          60_000,
        );

        // Each of these is a chart placing would not stop for, so the duty must ask for the start,
        // or the box would sit on its old file with the old box stopped.
        it.each([
          ["no chart", sql`delete from node_membership`],
          ["text that is not JSON", sql`update node_membership set document = 'not json'`],
          ["JSON that is no chart", sql`update node_membership set document = '{"body":1}'`],
          [
            "a chart whose list is broken",
            sql`update node_membership set document = '{"body":{"term":4,"nodes":[{"nodeId":1}]}}'`,
          ],
          ["a row holding the JSON value null", sql`update node_membership set document = 'null'`],
        ])(
          "%s: it keeps asking, as placing would place",
          async (_name, change) => {
            const { r, duty, counted } = await assumed();
            r.db.run(change);
            await new Promise((resolve) => setTimeout(resolve, 100));
            const settled = counted.asked;

            await severalPasses(duty);

            expect(counted.asked).toBeGreaterThan(settled);
            expect((await r.row()).waitingReason).toBeNull();
          },
          60_000,
        );
      });

      it("a chart taken while the old box answers: not filing_assumed, and the same answer once it clears", async () => {
        const r = await dutyRig();
        let moved = false;
        r.seam.answer = async (text) => {
          if (!moved) {
            moved = true;
            await chartWith(r, 4, "sell-only");
          }
          return r.answerWith(r.relinquishment(text));
        };
        await r.startAccepting();
        await vi.waitFor(
          async () => expect((await r.row()).waitingReason).toBe("handover.source_no_longer_main"),
          { timeout: 15_000 },
        );
        expect((await r.row()).state).toBe("copy_accepted");
        expect(r.posted).toHaveLength(1);
        expect(await readHandoverEvent(suite.node, r.m2.nodeId, OP, "filing_assumed")).toBeNull();

        await chartWith(r, 5, "serving-primary");
        await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
          timeout: 15_000,
        });
      }, 60_000);
    });

    it("every failed check of the answer waits at copy_accepted and keeps posting, and the true one is taken", async () => {
      const r = await dutyRig();
      const m2Signer = { nodeId: r.m2.nodeId, privateKey: r.m2Key };
      const otherBinding = { ...r.binding, operationId: OTHER_OP };
      const body = (text: string) => r.relinquishment(text).body as unknown as CanonicalValue;
      const cases: [string, (text: string) => Response][] = [
        ["not JSON", () => new Response("not json")],
        ["no envelope", () => r.answerWith({ binding: r.binding })],
        ["the wrong kind", (t) => r.answerWith(signEnvelope("acceptance", body(t), r.signer))],
        ["signed by this box", (t) => r.answerWith(r.relinquishment(t, () => {}, m2Signer))],
        [
          "a changed body",
          (t) => {
            const envelope = r.relinquishment(t);
            return r.answerWith({
              ...envelope,
              body: { ...(envelope.body as object), authorisedBy: "someone-else" },
            });
          },
        ],
        [
          "a body that is no object",
          () => r.answerWith(signEnvelope("relinquishment", null, r.signer)),
        ],
        ["no binding", (t) => r.answerWith(r.relinquishment(t, (b) => delete b.binding))],
        [
          "another operation's binding",
          (t) => r.answerWith(r.relinquishment(t, (b) => (b.binding = otherBinding))),
        ],
        [
          "another indicator",
          (t) => r.answerWith(r.relinquishment(t, (b) => (b.indicatorDigest = "d".repeat(64)))),
        ],
        [
          "another acceptance",
          (t) => r.answerWith(r.relinquishment(t, (b) => (b.acceptanceDigest = "d".repeat(64)))),
        ],
        [
          "filing assigned to another box",
          (t) => r.answerWith(r.relinquishment(t, (b) => (b.filingAssignedTo = r.m1.nodeId))),
        ],
        [
          "another person",
          (t) => r.answerWith(r.relinquishment(t, (b) => (b.authorisedBy = "someone-else"))),
        ],
      ];
      r.seam.answer = cases[0]![1];
      await r.startAccepting();
      for (const [name, answer] of cases) {
        r.seam.answer = answer;
        const posts = r.posted.length;
        // Two more: the first may have been answered before this case's answer was in place.
        await vi.waitFor(() => expect(r.posted.length).toBeGreaterThanOrEqual(posts + 2), {
          timeout: 15_000,
        });
        await vi.waitFor(
          async () =>
            expect((await r.row()).waitingReason, name).toBe("handover.relinquishment_invalid"),
          { timeout: 15_000 },
        );
        expect((await r.row()).state, name).toBe("copy_accepted");
      }
      expect(await readHandoverEvent(suite.node, r.m2.nodeId, OP, "filing_assumed")).toBeNull();
      expect(new Set(r.posted.map((post) => post.text)).size).toBe(1);

      r.seam.answer = (text) => r.answerWith(r.relinquishment(text));
      await vi.waitFor(async () => expect((await r.row()).state).toBe("filing_assumed"), {
        timeout: 15_000,
      });
      expect((await r.row()).waitingReason).toBeNull();
    }, 120_000);
  });
});
