// Imported first: its `vi.mock` of the internet clock must be in place before any fiscal module loads.
import { heldSetup } from "./held-setup-database.js";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import type { Database } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { MODULE } from "./first-fiscal.js";
import { readSetupDatabase } from "../src/first-setup-database-holdings.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp), rm: vi.fn(actual.rm) };
});

vi.mock("@waitron/provisioning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/provisioning")>();
  return { ...actual, openImmutableWhenWalEmpty: vi.fn(actual.openImmutableWhenWalEmpty) };
});

afterEach(() => vi.restoreAllMocks());

const ADJUSTMENT_REFUND = `insert into adjustment_refunds
  (id, adjustment_id, tender_refund_id, amount, created_at)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000003', 1, '2026-10-28T00:00:00.000Z')`;

// The rows a real activation stopped at `committed` leaves with the helper's module set.
const ACTIVATION_ROWS = 105;

type Held = Pick<Awaited<ReturnType<typeof heldSetup>>, "roots" | "host">;

function readDatabase(held: Held, modules: readonly WaitronModule[] = held.host.modules!) {
  return held.host.resolution.withVenueExclusion(() => readSetupDatabase(held.roots, modules));
}

async function read(held: Held, modules?: readonly WaitronModule[]) {
  const answer = await readDatabase(held, modules);
  if (answer.kind !== "read") throw new Error(`read as ${JSON.stringify(answer)}`);
  return answer.holdings;
}

const venueDb = (held: Held) => join(held.roots.venueDir, "venue.db");

async function files(dir: string) {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile());
  return Promise.all(
    entries
      .map(({ name }) => name)
      .sort()
      .map(async (name) => [name, await readFile(join(dir, name))] as const),
  );
}

/** Writes beside the reader, with foreign keys off, so a single row needs no parent rows. */
function write(held: Held, statements: readonly string[]) {
  const db = new DatabaseSync(join(held.roots.venueDir, "venue.db"));
  try {
    db.exec("pragma foreign_keys = off");
    for (const statement of statements) db.exec(statement);
  } finally {
    db.close();
  }
}

/** The fiscal module with its holdings seat replaced. */
function withHoldings(
  held: Held,
  seat: (db: Pick<Database, "execute">) => Promise<{ records: number; accepted: number }>,
) {
  return held.host.modules!.map((module) =>
    module.name !== MODULE
      ? module
      : {
          ...module,
          provisioning: {
            ...module.provisioning!,
            initialSetup: { ...module.provisioning!.initialSetup!, startAgainHoldings: seat },
          },
        },
  );
}

async function mainFile(db: Pick<Database, "execute">) {
  const rows = (await db.execute<{ name: string; file: string }>("pragma database_list")).rows;
  return rows.find((row) => row.name === "main")!.file;
}

const PRIVATE_COPY = /waitron-setup-holdings-/;
export {
  ADJUSTMENT_REFUND,
  ACTIVATION_ROWS,
  readDatabase,
  read,
  venueDb,
  files,
  write,
  withHoldings,
  mainFile,
  PRIVATE_COPY,
};
