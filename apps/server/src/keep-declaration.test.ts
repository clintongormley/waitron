import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalDeclarationsSeat } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { keepRunningDeclaration } from "./keep-declaration.js";
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

describe("keepRunningDeclaration", () => {
  // `withTransaction` drains the core set's `change_log` on every transaction, so even a fake seat
  // needs a real database under it.
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

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

  it("keeps nothing without the seat", async () => {
    const root = join(base, "no-seat");
    await writeDeclarationFolder(root);
    const log = vi.fn();

    await expect(
      keepRunningDeclaration({ root, seat: undefined, db: suite.db, now: () => AT, log }),
    ).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
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
