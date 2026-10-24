import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openManagementSession, seedPerson } from "../test/fixtures.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { persons } from "./schema/persons.js";
import { webauthnCredentials } from "./schema/webauthn.js";
import {
  completeAccountAction,
  inspectAccountAction,
  issueAccountAction,
} from "./account-action.js";
import {
  clearPersonPin,
  createPerson,
  deactivatePerson,
  invitePerson,
  reactivatePersonForInvitation,
  resetPersonLogin,
  resetPin,
  setEmail,
  setPassword,
  setRole,
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

describe("non-admin sign-in authority", () => {
  it.each(changes.filter(({ name }) => name !== "staff details"))(
    "refuses a manager's $name change to a non-admin without changing the row",
    async ({ status, change }) => {
      const actor = await openManagementSession(suite.db, "manager");
      const target = await seedPerson(suite.db, "staff", status);
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
  it("refuses a manager changing another manager's login email", async () => {
    const actor = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "manager");
    const before = await row(target);
    await expect(
      run((tx) =>
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
      ),
    ).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "person.admin" },
    });
    expect(await row(target)).toEqual(before);
  });
  it.each(changes.filter(({ name }) => name !== "staff details"))(
    "allows an admin's $name change to a non-admin",
    async ({ status, change, field, value }) => {
      const actor = await openManagementSession(suite.db, "admin");
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
  it.each(
    changes.filter(({ name }) =>
      ["email", "password", "PIN replacement", "PIN clearing"].includes(name),
    ),
  )("keeps a manager's own $name change available", async ({ change, field }) => {
    const actor = await openManagementSession(suite.db, "manager");
    const before = await row(actor.personId);
    await run((tx) => change(tx, actor.token, actor.personId.toUpperCase()));
    expect((await row(actor.personId))[field]).not.toEqual(before[field]);
  });
  it.each(["staff", "admin"] as const)(
    "lets a manager edit a %s person's names and telephone",
    async (role) => {
      const actor = await openManagementSession(suite.db, "manager");
      const target = await seedPerson(suite.db, role);
      await suite.db
        .update(persons)
        .set({ email: "unchanged@example.test" })
        .where(eq(persons.id, target));
      await run((tx) =>
        updatePersonDetails(tx, {
          managementSessionId: actor.token,
          personId: target,
          displayName: "Changed name",
          firstNames: "Changed",
          lastNames: "Name",
          telephone: "+44 20 1234",
          email: "unchanged@example.test",
          role,
          status: "active",
        }),
      );
      expect(await row(target)).toMatchObject({
        displayName: "Changed name",
        firstNames: "Changed",
        lastNames: "Name",
        telephone: "+44 20 1234",
        email: "unchanged@example.test",
        role,
        status: "active",
      });
    },
  );
  it("lets a manager edit an inactive admin's names without deleting their PIN or passkeys", async () => {
    const actor = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "admin", "suspended");
    await suite.db
      .update(persons)
      .set({ email: "unchanged@example.test" })
      .where(eq(persons.id, target));
    await suite.db
      .insert(webauthnCredentials)
      .values({ personId: target, credentialId: `cred-${target}`, publicKey: "public-key" });
    const pinHash = (await row(target)).pinHash;
    expect(pinHash).not.toBeNull();
    await run((tx) =>
      updatePersonDetails(tx, {
        managementSessionId: actor.token,
        personId: target,
        displayName: "Changed name",
        firstNames: "Changed",
        lastNames: "Name",
        telephone: null,
        email: "unchanged@example.test",
        role: "admin",
        status: "suspended",
      }),
    );
    expect(await row(target)).toMatchObject({
      displayName: "Changed name",
      status: "suspended",
      pinHash,
    });
    expect(
      await suite.db
        .select({ id: webauthnCredentials.credentialId })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.personId, target)),
    ).toEqual([{ id: `cred-${target}` }]);
  });
  it.each(["create", "invite"] as const)(
    "refuses a manager's attempt to %s a non-admin account",
    async (operation) => {
      const actor = await openManagementSession(suite.db, "manager");
      const before = await suite.db.select().from(persons);
      await expect(
        run((tx) =>
          operation === "create"
            ? createPerson(tx, {
                managementSessionId: actor.token,
                displayName: "New Staff",
                role: "staff",
                pin: "4321",
                email: "new@example.test",
              })
            : invitePerson(tx, {
                managementSessionId: actor.token,
                displayName: "New Staff",
                firstNames: "New",
                lastNames: "Staff",
                telephone: null,
                role: "staff",
                email: "new@example.test",
              }),
        ),
      ).rejects.toMatchObject({
        code: "authorization.not_permitted",
        params: { permission: "person.admin" },
      });
      expect(await suite.db.select().from(persons)).toEqual(before);
    },
  );
});

describe("account links across admin role changes", () => {
  it.each([
    { method: "details", purpose: "password_reset" },
    { method: "details", purpose: "invitation" },
    { method: "setRole", purpose: "password_reset" },
    { method: "setRole", purpose: "invitation" },
  ] as const)(
    "refuses a $purpose link issued before $method promotes the person",
    async ({ method, purpose }) => {
      const actor = await openManagementSession(suite.db, "admin");
      const target = await seedPerson(
        suite.db,
        "manager",
        purpose === "invitation" ? "pending" : "active",
      );
      await suite.db
        .update(persons)
        .set({ email: "manager-controlled@example.test" })
        .where(eq(persons.id, target));
      const issued = await run((tx) => issueAccountAction(tx, { personId: target, purpose }));
      const person = await row(target);
      await run((tx) =>
        method === "setRole"
          ? setRole(tx, { managementSessionId: actor.token, personId: target, role: "admin" })
          : updatePersonDetails(tx, {
              managementSessionId: actor.token,
              personId: target,
              displayName: person.displayName,
              firstNames: "Future",
              lastNames: "Admin",
              telephone: null,
              email: person.email!,
              role: "admin",
              status: person.status,
            }),
      );
      const promoted = await row(target);
      await expect(
        run((tx) =>
          completeAccountAction(tx, {
            token: issued.token,
            purpose,
            password: "manager chosen password",
            pin: "4321",
          }),
        ),
      ).rejects.toMatchObject({ code: "account_action.invalid" });
      expect(await row(target)).toEqual(promoted);
      await expect(
        run((tx) => inspectAccountAction(tx, { token: issued.token, purpose })),
      ).rejects.toMatchObject({ code: "account_action.invalid" });
    },
  );
});

it("serves an invitation issued after an admin approves the promotion", async () => {
  const actor = await openManagementSession(suite.db, "admin");
  const target = await seedPerson(suite.db, "manager", "pending");
  await suite.db
    .update(persons)
    .set({ email: "future-owner@example.test" })
    .where(eq(persons.id, target));
  await run((tx) =>
    setRole(tx, { managementSessionId: actor.token, personId: target, role: "admin" }),
  );
  const issued = await run((tx) =>
    issueAccountAction(tx, { personId: target, purpose: "invitation" }),
  );
  const completed = await run((tx) =>
    completeAccountAction(tx, {
      token: issued.token,
      purpose: "invitation",
      password: "new owner password",
      pin: "4321",
    }),
  );
  expect(completed).toMatchObject({
    personId: target,
    session: { personId: target, token: expect.any(String) },
  });
  expect((await row(target)).role).toBe("admin");
  expect((await row(target)).status).toBe("active");
});

it("preserves an unused reset when a non-admin becomes a manager", async () => {
  const actor = await openManagementSession(suite.db, "admin");
  const target = await seedPerson(suite.db, "staff");
  await suite.db
    .update(persons)
    .set({ email: "future-manager@example.test" })
    .where(eq(persons.id, target));
  const issued = await run((tx) =>
    issueAccountAction(tx, { personId: target, purpose: "password_reset" }),
  );
  await run((tx) =>
    setRole(tx, { managementSessionId: actor.token, personId: target, role: "manager" }),
  );
  await expect(
    run((tx) =>
      completeAccountAction(tx, {
        token: issued.token,
        purpose: "password_reset",
        password: "new manager password",
      }),
    ),
  ).resolves.toEqual({ personId: target, session: null });
  expect((await row(target)).role).toBe("manager");
});

it.each(["details", "setRole"] as const)(
  "retires an admin's unused reset on demotion through %s",
  async (method) => {
    const actor = await openManagementSession(suite.db, "admin");
    const target = await seedPerson(suite.db, "admin");
    await suite.db
      .update(persons)
      .set({ email: "former-admin@example.test" })
      .where(eq(persons.id, target));
    const issued = await run((tx) =>
      issueAccountAction(tx, { personId: target, purpose: "password_reset" }),
    );
    const person = await row(target);
    await run((tx) =>
      method === "setRole"
        ? setRole(tx, { managementSessionId: actor.token, personId: target, role: "manager" })
        : updatePersonDetails(tx, {
            managementSessionId: actor.token,
            personId: target,
            displayName: person.displayName,
            firstNames: "Former",
            lastNames: "Admin",
            telephone: null,
            email: person.email!,
            role: "manager",
            status: "active",
          }),
    );
    await expect(
      run((tx) =>
        completeAccountAction(tx, {
          token: issued.token,
          purpose: "password_reset",
          password: "new manager password",
        }),
      ),
    ).rejects.toMatchObject({ code: "account_action.invalid" });
    expect((await row(target)).role).toBe("manager");
  },
);

it.each(["role", "status"] as const)(
  "refuses a manager's %s-only edit of non-admin staff",
  async (field) => {
    const actor = await openManagementSession(suite.db, "manager");
    const target = await seedPerson(suite.db, "staff");
    await suite.db
      .update(persons)
      .set({ email: "unchanged@example.test" })
      .where(eq(persons.id, target));
    const before = await row(target);
    await expect(
      run((tx) =>
        updatePersonDetails(tx, {
          managementSessionId: actor.token,
          personId: target,
          displayName: before.displayName,
          firstNames: "Existing",
          lastNames: "Person",
          telephone: null,
          email: before.email!,
          role: field === "role" ? "manager" : "staff",
          status: field === "status" ? "suspended" : "active",
        }),
      ),
    ).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "person.admin" },
    });
    expect(await row(target)).toEqual(before);
  },
);

it.each(["details", "setRole"] as const)(
  "preserves a manager's own non-admin role change through %s",
  async (method) => {
    const actor = await openManagementSession(suite.db, "manager");
    const before = await row(actor.personId);
    await run((tx) =>
      method === "setRole"
        ? setRole(tx, {
            managementSessionId: actor.token,
            personId: actor.personId,
            role: "supervisor",
          })
        : updatePersonDetails(tx, {
            managementSessionId: actor.token,
            personId: actor.personId,
            displayName: before.displayName,
            firstNames: "Own",
            lastNames: "Account",
            telephone: null,
            email: before.email!,
            role: "supervisor",
            status: "active",
          }),
    );
    expect((await row(actor.personId)).role).toBe("supervisor");
  },
);
it.each(["details", "setRole"] as const)(
  "refuses a manager promoting themselves through %s",
  async (method) => {
    const actor = await openManagementSession(suite.db, "manager");
    const before = await row(actor.personId);
    await expect(
      run((tx) =>
        method === "setRole"
          ? setRole(tx, {
              managementSessionId: actor.token,
              personId: actor.personId,
              role: "admin",
            })
          : updatePersonDetails(tx, {
              managementSessionId: actor.token,
              personId: actor.personId,
              displayName: before.displayName,
              firstNames: "Own",
              lastNames: "Account",
              telephone: null,
              email: before.email!,
              role: "admin",
              status: "active",
            }),
      ),
    ).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "person.admin" },
    });
    expect(await row(actor.personId)).toEqual(before);
  },
);
