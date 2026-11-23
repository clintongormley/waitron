import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { triggerRaised } from "./constraint-target.js";
import { insertMasterKey, readCurrentMasterKey } from "./master-keys.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { masterKeys } from "./schema/master-keys.js";
import { FOREIGN_KEY_VIOLATION } from "./sql-state.js";
import { withTransaction } from "./tenancy.js";
import { captureError, engineErrorMessage } from "./testing/errors.js";
import { seedPerson } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";
import { isRefusal } from "./unique-violation.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const madeAt = new Date("2026-11-23T09:00:00.000Z");

function key(n: number, madeBy: string | null = null) {
  return {
    name: `2026-11-2${n} · ABC${n}`,
    checkValue: String(n).repeat(64),
    publicKey: new Uint8Array([0x30, 0x2a, n, 0xff]),
    madeAt,
    madeBy,
  };
}

const insert = (row: ReturnType<typeof key>) =>
  withTransaction(suite.db, (tx) => insertMasterKey(tx, row));

describe("master keys", () => {
  it("has none before the first is written", async () => {
    expect(await readCurrentMasterKey(suite.db)).toBeNull();
  });

  it("numbers keys from 1 and reads back what was written, public key bytes included", async () => {
    const person = await seedPerson(suite.db);
    expect(await insert(key(1, person))).toBe(1);
    expect(await readCurrentMasterKey(suite.db)).toEqual({ number: 1, ...key(1, person) });
  });

  it("reads the highest-numbered key as the current one", async () => {
    await insert(key(1));
    expect(await insert(key(2))).toBe(2);
    expect(await insert(key(3))).toBe(3);
    expect(await withTransaction(suite.db, (tx) => readCurrentMasterKey(tx))).toEqual({
      number: 3,
      ...key(3),
    });
  });

  it("refuses a maker who is not a person on this venue", async () => {
    const error = await captureError(() => insert(key(1, "nobody")));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(await readCurrentMasterKey(suite.db)).toBeNull();
  });

  it("master_keys rejects update and delete", async () => {
    await insert(key(1));
    const updated = await captureError(() =>
      suite.db.update(masterKeys).set({ name: "forged" }).where(eq(masterKeys.number, 1)),
    );
    expect(triggerRaised(updated, "master_keys is append-only")).toBe(true);
    expect(engineErrorMessage(updated)).toBe("master_keys is append-only");
    const deleted = await captureError(() =>
      suite.db.delete(masterKeys).where(eq(masterKeys.number, 1)),
    );
    expect(triggerRaised(deleted, "master_keys is append-only")).toBe(true);
    expect(engineErrorMessage(deleted)).toBe("master_keys is append-only");
    expect(await readCurrentMasterKey(suite.db)).toEqual({ number: 1, ...key(1) });
  });
});
