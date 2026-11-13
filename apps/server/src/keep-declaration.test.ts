import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalDeclarationsSeat } from "@waitron/fiscal";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { keepRunningDeclaration, keptDeclarationsReader } from "./keep-declaration.js";
import { writeDeclarationFolder } from "./testing/declaration-folder.js";

const AT = new Date("2026-11-13T09:30:00.000Z");

let base: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "keep-declaration-"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

function recordingSeat(keep: FiscalDeclarationsSeat["keep"] = async () => {}) {
  const calls: { version: string; text: string; at: Date }[] = [];
  const seat: FiscalDeclarationsSeat = {
    keep: async (tx, entry) => {
      calls.push(entry);
      await keep(tx, entry);
    },
    versions: async () => [],
    text: async () => null,
  };
  return { seat, calls };
}

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("keepRunningDeclaration", () => {
  it("keeps the release the box is running", async () => {
    const root = join(base, "release");
    await writeDeclarationFolder(
      root,
      { version: "1.0.0", releasedOn: "2026-10-22" },
      undefined,
      "1.0.0",
    );
    const { seat, calls } = recordingSeat();
    const log = vi.fn();

    await keepRunningDeclaration({ root, seat, db: suite.db, now: () => AT, log });

    const text = await readFile(join(root, "declaration.txt"), "utf8");
    expect(calls).toEqual([{ version: "1.0.0", text, at: AT }]);
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps nothing from a test build or a damaged folder", async () => {
    const damaged = join(base, "damaged");
    await writeDeclarationFolder(damaged);
    await unlink(join(damaged, "declaration.txt"));
    for (const root of [join(base, "absent"), damaged]) {
      const { seat, calls } = recordingSeat();
      const log = vi.fn();

      await keepRunningDeclaration({ root, seat, db: suite.db, now: () => AT, log });

      expect({ root, calls }).toEqual({ root, calls: [] });
      expect(log).not.toHaveBeenCalled();
    }
  });

  it("a failed keep does not stop the start", async () => {
    const root = join(base, "failing");
    await writeDeclarationFolder(root);
    const { seat, calls } = recordingSeat(async () => {
      throw new AppError("storage.disk_full", {});
    });
    const log = vi.fn();

    await expect(
      keepRunningDeclaration({ root, seat, db: suite.db, now: () => AT, log }),
    ).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(log.mock.calls).toEqual([
      ["warn", "declaration.keep_failed", { errorCode: "storage.disk_full" }],
    ]);
  });
});

describe("keptDeclarationsReader", () => {
  const seat = FISCAL_SLOT.declarations!;
  const keep = (version: string) =>
    withTransaction(suite.db, (tx) => seat.keep(tx, { version, text: `kept ${version}`, at: AT }));

  it("reads with a change waiting in the change list and leaves it waiting", async () => {
    const db = suite.db;
    await keep("1.0.0");
    // A drained list would be empty afterwards: draining is a write, which a nearly full disk
    // refuses.
    db.run(sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`);
    const reader = keptDeclarationsReader(db, seat);
    expect(await reader.versions()).toEqual(["1.0.0"]);
    expect(await reader.text("1.0.0")).toBe("kept 1.0.0");
    expect(db.all<{ id: string }>(sql`select id from change_log`)).toEqual([{ id: "zz1" }]);
  });

  it("answers while another caller holds the write lock, with committed rows only", async () => {
    const db = suite.db;
    await keep("1.0.0");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const turn = db.withWriteLock(async () => {
      await seat.keep(db, { version: "2.0.0", text: "kept 2.0.0", at: AT });
      await held;
    });
    const reader = keptDeclarationsReader(db, seat);
    const settled = <T>(read: Promise<T>) =>
      Promise.race([
        read.then((answer) => ({ answer })),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 200)),
      ]);
    try {
      expect(await settled(reader.versions())).toEqual({ answer: ["1.0.0"] });
      expect(await settled(reader.text("1.0.0"))).toEqual({ answer: "kept 1.0.0" });
    } finally {
      release();
      await turn;
    }
  });
});
