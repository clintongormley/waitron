import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBackupQuery } from "@waitron/store";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import * as identity from "./index.js";
import { seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

describe("person authority", () => {
  it.each([
    ["staff", false, false],
    ["supervisor", true, false],
    ["manager", true, true],
    ["admin", true, true],
  ] as const)(
    "reads %s permissions without changing their grants",
    async (role, refund, exports) => {
      const personId = await seedPerson(suite.db, role);
      const authority = await identity.readPersonAuthority(suite.db, personId);
      expect(authority.personId).toBe(personId);
      expect(authority.admin).toBe(role === "admin");
      expect(identity.holds(authority, "sale.refund")).toBe(refund);
      expect(identity.holds(authority, "report.export")).toBe(exports);
      expect(authority.permissions.has("payment.take")).toBe(true);
    },
  );

  it("lists Admin holders with their password hashes, optionally active only", async () => {
    const admin = await seedPerson(suite.db, "admin");
    const suspended = await seedPerson(suite.db, "admin", "suspended");
    const pending = await seedPerson(suite.db, "admin", "pending");
    await seedPerson(suite.db, "manager");
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`update persons set password_hash = 'stored-verifier' where id = ${admin}`),
    );
    expect(await identity.listAdminHolders(suite.db)).toEqual(
      expect.arrayContaining([
        { id: admin, passwordHash: "stored-verifier" },
        { id: suspended, passwordHash: null },
        { id: pending, passwordHash: null },
      ]),
    );
    expect(await identity.listAdminHolders(suite.db)).toHaveLength(3);
    expect(await identity.listAdminHolders(suite.db, { status: "active" })).toEqual([
      { id: admin, passwordHash: "stored-verifier" },
    ]);
  });

  it("an unknown person holds nothing", async () => {
    const personId = crypto.randomUUID();
    const authority = await identity.readPersonAuthority(suite.db, personId);
    expect(authority).toEqual({ personId, admin: false, permissions: new Set() });
    expect(identity.holds(authority, "payment.take")).toBe(false);
  });

  it("Admin holds a permission declared after its authority was read, but no undeclared permission", async () => {
    const personId = await seedPerson(suite.db, "admin");
    const authority = await identity.readPersonAuthority(suite.db, personId);
    expect(identity.holds(authority, "authority_test.later")).toBe(false);
    identity.registerModulePermissions([
      { permission: "authority_test.later", defaultHolders: [] },
    ]);
    expect(identity.holds(authority, "authority_test.later")).toBe(true);
    expect(identity.holds(authority, "authority_test.unknown")).toBe(false);
  });

  it("checks the offered copy rather than the live person's authority", async () => {
    const admin = await seedPerson(suite.db, "admin");
    const manager = await seedPerson(suite.db, "manager");
    const suspended = await seedPerson(suite.db, "admin", "suspended");
    const directory = await mkdtemp(join(tmpdir(), "authority-copy-"));
    try {
      const path = join(directory, "copy.db");
      await withTransaction(suite.db, (tx) =>
        tx.execute(sql`update persons set password_hash = 'copy-verifier' where id = ${admin}`),
      );
      await suite.db.archiveTo(path);
      await withTransaction(suite.db, (tx) =>
        tx.execute(sql`update persons set role = 'staff' where id = ${admin}`),
      );
      const copy = await openBackupQuery(path);
      try {
        expect(await identity.listAdminHolders(copy.query, { status: "active" })).toEqual([
          { id: admin, passwordHash: "copy-verifier" },
        ]);
        expect(await identity.listAdminHolders(copy.query)).toEqual(
          expect.arrayContaining([
            { id: admin, passwordHash: "copy-verifier" },
            { id: suspended, passwordHash: null },
          ]),
        );
        expect(await identity.listAdminHolders(copy.query)).toHaveLength(2);
        expect(await identity.holdsInCopy(copy.query, admin, "node.manage")).toBe(true);
        expect(await identity.holdsInCopy(copy.query, manager, "node.manage")).toBe(false);
        expect(await identity.holdsInCopy(copy.query, suspended, "node.manage")).toBe(false);
        expect(await identity.holdsInCopy(copy.query, crypto.randomUUID(), "node.manage")).toBe(
          false,
        );
        expect(await identity.holdsInCopy(copy.query, admin, "authority_test.unknown")).toBe(false);
      } finally {
        await copy.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("an undeclared stored permission grants nothing", () => {
    expect(
      identity.holds(
        { personId: "unused", admin: false, permissions: new Set(["authority_test.retired"]) },
        "authority_test.retired",
      ),
    ).toBe(false);
  });
});
