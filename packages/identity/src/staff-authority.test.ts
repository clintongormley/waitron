import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openManagementSession, seedPerson } from "../test/fixtures.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { persons } from "./schema/persons.js";
import {
  clearPersonPin,
  createPerson,
  deactivatePerson,
  invitePerson,
  reactivatePerson,
  reactivatePersonForInvitation,
  resetPersonLogin,
  resetPin,
  setEmail,
  setPassword,
  setRole,
  suspendPerson,
  updatePersonDetails,
} from "./staff.js";

type Change = (tx: Transaction, managementSessionId: string, personId: string) => Promise<unknown>;
const changes: {
  name: string;
  status: "active" | "suspended";
  change: Change;
  field: "email" | "pinHash" | "passwordHash" | "role" | "status";
  value: string | null;
}[] = [
  {
    name: "email",
    status: "active",
    change: (tx, managementSessionId, personId) =>
      setEmail(tx, { managementSessionId, personId, email: "replacement@example.test" }),
    field: "email",
    value: "replacement@example.test",
  },
  {
    name: "password",
    status: "active",
    change: (tx, managementSessionId, personId) =>
      setPassword(tx, { managementSessionId, personId, password: "replacement password" }),
    field: "passwordHash",
    value: null,
  },
  {
    name: "PIN replacement",
    status: "active",
    change: (tx, managementSessionId, personId) =>
      resetPin(tx, { managementSessionId, personId, pin: "4321" }),
    field: "pinHash",
    value: null,
  },
  {
    name: "PIN clearing",
    status: "active",
    change: (tx, managementSessionId, personId) =>
      clearPersonPin(tx, { managementSessionId, personId }),
    field: "pinHash",
    value: null,
  },
  {
    name: "login reset",
    status: "active",
    change: (tx, managementSessionId, personId) =>
      resetPersonLogin(tx, { managementSessionId, personId }),
    field: "status",
    value: "pending",
  },
  {
    name: "invitation reactivation",
    status: "suspended",
    change: (tx, managementSessionId, personId) =>
      reactivatePersonForInvitation(tx, { managementSessionId, personId }),
    field: "status",
    value: "pending",
  },
  {
    name: "reactivation",
    status: "suspended",
    change: (tx, managementSessionId, personId) =>
      reactivatePerson(tx, { managementSessionId, personId }),
    field: "status",
    value: "active",
  },
  {
    name: "suspension",
    status: "active",
    change: (tx, managementSessionId, personId) =>
      suspendPerson(tx, { managementSessionId, personId }),
    field: "status",
    value: "suspended",
  },
  {
    name: "deactivation",
    status: "active",
    change: (tx, managementSessionId, personId) =>
      deactivatePerson(tx, { managementSessionId, personId }),
    field: "status",
    value: "suspended",
  },
  {
    name: "role",
    status: "active",
    change: (tx, managementSessionId, personId) =>
      setRole(tx, { managementSessionId, personId, role: "supervisor" }),
    field: "role",
    value: "supervisor",
  },
  {
    name: "staff details",
    status: "active",
    change: (tx, managementSessionId, personId) =>
      updatePersonDetails(tx, {
        managementSessionId,
        personId,
        displayName: "Updated",
        firstNames: "Updated",
        lastNames: "Person",
        telephone: null,
        email: "replacement@example.test",
        role: "admin",
        status: "active",
      }),
    field: "email",
    value: "replacement@example.test",
  },
];
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const row = async (id: string) =>
  (await suite.db.select().from(persons).where(eq(persons.id, id)))[0]!;

describe("admin sign-in authority", () => {
  it.each(changes)(
    "refuses a manager's $name change to an admin without changing the row",
    async ({ status, change }) => {
      const actor = await openManagementSession(suite.db, "manager");
      await seedPerson(suite.db, "admin");
      const target = await seedPerson(suite.db, "admin", status);
      const before = await row(target);
      await expect(
        run((tx) => change(tx, actor.token, target.toUpperCase())),
      ).rejects.toMatchObject({
        code: "authorization.not_permitted",
        params: { permission: "person.admin" },
      });
      expect(await row(target)).toEqual(before);
    },
  );
  it.each(changes)(
    "allows an admin's $name change to another admin",
    async ({ status, change, field, value }) => {
      const actor = await openManagementSession(suite.db, "admin");
      const target = await seedPerson(suite.db, "admin", status);
      const before = await row(target);
      await run((tx) => change(tx, actor.token, target));
      const after = await row(target);
      expect(after[field]).not.toEqual(before[field]);
      if (
        field !== "passwordHash" &&
        !(field === "pinHash" && value === null && after.pinHash !== null)
      )
        expect(after[field]).toBe(value);
    },
  );
  it.each(["create", "invite", "promote"] as const)(
    "refuses a manager's attempt to %s an admin",
    async (operation) => {
      const actor = await openManagementSession(suite.db, "manager");
      const target = await seedPerson(suite.db, "staff");
      const before = await suite.db.select().from(persons);
      await expect(
        run<unknown>((tx) =>
          operation === "create"
            ? createPerson(tx, {
                managementSessionId: actor.token,
                displayName: "New Admin",
                role: "admin",
                pin: "4321",
                email: "new-admin@example.test",
              })
            : operation === "invite"
              ? invitePerson(tx, {
                  managementSessionId: actor.token,
                  displayName: "New Admin",
                  firstNames: "New",
                  lastNames: "Admin",
                  telephone: null,
                  role: "admin",
                  email: "new-admin@example.test",
                })
              : setRole(tx, { managementSessionId: actor.token, personId: target, role: "admin" }),
        ),
      ).rejects.toMatchObject({
        code: "authorization.not_permitted",
        params: { permission: "person.admin" },
      });
      expect(await suite.db.select().from(persons)).toEqual(before);
    },
  );
});

describe("manager staff changes remain available", () => {
  it.each(changes.filter(({ name }) => name !== "staff details"))(
    "allows a manager's $name change to a non-admin",
    async ({ status, change, field, value }) => {
      const actor = await openManagementSession(suite.db, "manager");
      const target = await seedPerson(suite.db, "staff", status);
      const before = await row(target);
      await run((tx) => change(tx, actor.token, target));
      const after = await row(target);
      expect(after[field]).not.toEqual(before[field]);
      if (
        field !== "passwordHash" &&
        !(field === "pinHash" && value === null && after.pinHash !== null)
      )
        expect(after[field]).toBe(value);
    },
  );
  it("allows a manager to change another manager's email", async () => {
    const actor = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "manager");
    await run((tx) =>
      updatePersonDetails(tx, {
        managementSessionId: actor.token,
        personId: target,
        displayName: "Updated Manager",
        firstNames: "Updated",
        lastNames: "Manager",
        telephone: null,
        email: "changed-manager@example.test",
        role: "manager",
        status: "active",
      }),
    );
    expect((await row(target)).email).toBe("changed-manager@example.test");
  });
});
