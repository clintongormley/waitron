import { readPersonAuthority } from "./authority.js";
import { ensureBuiltInRoles, setPersonAccessRoles } from "./roles.js";
import {
  CORE_MIGRATIONS,
  outgoingMail,
  withTransaction,
  type Transaction,
  persons,
  roles,
  personRoles,
  webauthnCredentials,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { builtInRoleForTest } from "../test/person-rows.js";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  openFreshManagementSession as openManagementSession,
  seedPerson,
} from "../test/fixtures.js";
import {
  completeAccountAction,
  queueInvitation,
  inspectAccountAction,
  issueAccountAction,
} from "./account-action.js";
import {
  clearPersonPin,
  deactivatePerson,
  invitePerson,
  reactivatePersonForInvitation,
  resetPersonLogin,
  updatePersonDetails,
} from "./staff.js";

import {
  declaredPermissions,
  defaultPermissionsFor,
  registerModulePermissions,
} from "./permissions.js";

type Change = (tx: Transaction, managementSessionId: string, personId: string) => Promise<unknown>;
const changes: {
  name: string;
  status: "active" | "suspended";
  change: Change;
  field: "email" | "pinHash" | "passwordHash" | "role" | "status";
  value: string | null;
}[] = [
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
        status: "active",
      }),
    field: "email",
    value: "replacement@example.test",
  },
];
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
const row = async (id: string) => ({
  ...(await suite.db.select().from(persons).where(eq(persons.id, id)))[0]!,
  role: await builtInRoleForTest(suite.db, id),
});

async function managerWithoutAdminAuthority() {
  const actor = await openManagementSession(suite.db, "manager");
  await suite.db
    .update(roles)
    .set({
      permissions: defaultPermissionsFor("manager").filter(
        (permission) => permission !== "person.admin",
      ),
    })
    .where(eq(roles.builtInKey, "manager"));
  return actor;
}

async function changeRole(
  tx: Transaction,
  input: {
    managementSessionId: string;
    personId: string;
    role: "manager" | "admin" | "supervisor";
  },
) {
  const builtIns = await ensureBuiltInRoles(tx);
  await setPersonAccessRoles(tx, {
    managementSessionId: input.managementSessionId,
    personId: input.personId,
    roleIds: [builtIns[input.role]],
    expectedRoleIds: (await readPersonAuthority(tx, input.personId)).roleIds,
  });
}

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
        code: "person.holds_more",
        params: { personId: target },
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
  it.each(["invite", "promote"] as const)(
    "refuses a manager's attempt to %s an admin",
    async (operation) => {
      const actor = await openManagementSession(suite.db, "manager");
      const target = await seedPerson(suite.db, "staff");
      const before = await suite.db.select().from(persons);
      await expect(
        run<unknown>(async (tx) =>
          operation === "invite"
            ? invitePerson(tx, {
                managementSessionId: actor.token,
                displayName: "New Admin",
                firstNames: "New",
                lastNames: "Admin",
                telephone: null,
                roleIds: [(await ensureBuiltInRoles(tx)).admin],
                email: "new-admin@example.test",
              })
            : changeRole(tx, { managementSessionId: actor.token, personId: target, role: "admin" }),
        ),
      ).rejects.toMatchObject({
        code: "role.not_permitted",
        params: { roleId: (await run(ensureBuiltInRoles)).admin },
      });
      expect(await suite.db.select().from(persons)).toEqual(before);
    },
  );
});

describe("non-admin sign-in authority", () => {
  it.each(changes.filter(({ name }) => name !== "staff details"))(
    "refuses a $name change to a non-admin when the Manager lacks person.admin",
    async ({ status, change }) => {
      const actor = await managerWithoutAdminAuthority();
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
          status: "active",
        }),
      ),
    ).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "person.email" },
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
      await openManagementSession(suite.db, "admin");
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
    await openManagementSession(suite.db, "admin");
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
  it.each(["invite"] as const)(
    "refuses a Manager without person.admin attempting to %s a non-admin account",
    async () => {
      const actor = await managerWithoutAdminAuthority();
      const before = await suite.db.select().from(persons);
      await expect(
        run(async (tx) =>
          invitePerson(tx, {
            managementSessionId: actor.token,
            displayName: "New Staff",
            firstNames: "New",
            lastNames: "Staff",
            telephone: null,
            roleIds: [(await ensureBuiltInRoles(tx)).staff],
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
    { method: "access roles", purpose: "password_reset" },
    { method: "access roles", purpose: "invitation" },
  ] as const)(
    "serves a $purpose link issued before $method promotes the person",
    async ({ purpose }) => {
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
      await run((tx) =>
        changeRole(tx, { managementSessionId: actor.token, personId: target, role: "admin" }),
      );
      await expect(
        run((tx) =>
          completeAccountAction(tx, {
            token: issued.token,
            purpose,
            password: "manager chosen password",
            pin: "4321",
          }),
        ),
      ).resolves.toMatchObject({ personId: target });
      expect((await row(target)).role).toBe("admin");
      expect((await row(target)).status).toBe("active");
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
    changeRole(tx, { managementSessionId: actor.token, personId: target, role: "admin" }),
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
    changeRole(tx, { managementSessionId: actor.token, personId: target, role: "manager" }),
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

it.each(["access roles"] as const)(
  "preserves an admin's unused reset on demotion through %s",
  async () => {
    const actor = await openManagementSession(suite.db, "admin");
    const target = await seedPerson(suite.db, "admin");
    await suite.db
      .update(persons)
      .set({ email: "former-admin@example.test" })
      .where(eq(persons.id, target));
    const issued = await run((tx) =>
      issueAccountAction(tx, { personId: target, purpose: "password_reset" }),
    );
    await run((tx) =>
      changeRole(tx, { managementSessionId: actor.token, personId: target, role: "manager" }),
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
  },
);

it.each(["role", "status"] as const)(
  "refuses a %s-only edit of non-admin staff when the Manager lacks person.admin",
  async (field) => {
    const actor = await managerWithoutAdminAuthority();
    const target = await seedPerson(suite.db, "staff");
    await suite.db
      .update(persons)
      .set({ email: "unchanged@example.test" })
      .where(eq(persons.id, target));
    const before = await row(target);
    await expect(
      run((tx) =>
        field === "role"
          ? changeRole(tx, { managementSessionId: actor.token, personId: target, role: "manager" })
          : updatePersonDetails(tx, {
              managementSessionId: actor.token,
              personId: target,
              displayName: before.displayName,
              firstNames: "Existing",
              lastNames: "Person",
              telephone: null,
              email: before.email!,
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

it.each(["access roles"] as const)(
  "preserves a manager's own non-admin role change through %s",
  async () => {
    await openManagementSession(suite.db, "admin");
    const actor = await openManagementSession(suite.db, "manager");
    await run((tx) =>
      changeRole(tx, {
        managementSessionId: actor.token,
        personId: actor.personId,
        role: "supervisor",
      }),
    );
    expect((await row(actor.personId)).role).toBe("supervisor");
  },
);
it.each(["access roles"] as const)(
  "refuses a manager promoting themselves through %s",
  async () => {
    const actor = await openManagementSession(suite.db, "manager");
    const before = await row(actor.personId);
    await expect(
      run((tx) =>
        changeRole(tx, {
          managementSessionId: actor.token,
          personId: actor.personId,
          role: "admin",
        }),
      ),
    ).rejects.toMatchObject({
      code: "role.not_permitted",
      params: { roleId: (await run(ensureBuiltInRoles)).admin },
    });
    expect(await row(actor.personId)).toEqual(before);
  },
);

it.each(["invite", "access roles"] as const)(
  "only an Admin holder grants Admin through %s, even with person.admin",
  async (method) => {
    const actor = await openManagementSession(suite.db, "manager");
    await suite.db
      .update(roles)
      .set({ permissions: declaredPermissions() })
      .where(eq(roles.builtInKey, "manager"));
    const target = await seedPerson(suite.db, "staff");
    const before = await row(target);
    await expect(
      run<unknown>(async (tx) =>
        method === "invite"
          ? invitePerson(tx, {
              managementSessionId: actor.token,
              displayName: "New Admin",
              firstNames: "New",
              lastNames: "Admin",
              telephone: null,
              email: "new-admin@example.test",
              roleIds: [(await ensureBuiltInRoles(tx)).admin],
            })
          : changeRole(tx, { managementSessionId: actor.token, personId: target, role: "admin" }),
      ),
    ).rejects.toMatchObject({
      code: "role.not_permitted",
      params: { roleId: (await run(ensureBuiltInRoles)).admin },
    });
    expect(await row(target)).toEqual(before);
  },
);

it("does not rewrite an unchanged built-in membership when saving details", async () => {
  const actor = await openManagementSession(suite.db, "admin");
  const personId = await seedPerson(suite.db, "staff");
  await suite.db
    .update(persons)
    .set({ email: "target@example.test", emailFolded: "target@example.test" })
    .where(eq(persons.id, personId));
  const before = await row(personId);
  await run(async (tx) => {
    const writes = vi.spyOn(tx, "delete");
    try {
      await updatePersonDetails(tx, {
        managementSessionId: actor.token,
        personId,
        displayName: "Renamed",
        firstNames: "First",
        lastNames: "Last",
        telephone: null,
        email: before.email!,
        status: "active",
      });
      expect(writes.mock.calls.filter(([table]) => table === personRoles)).toHaveLength(0);
    } finally {
      writes.mockRestore();
    }
  });
  expect((await row(personId)).displayName).toBe("Renamed");
});

it("recognises Admin membership when another built-in membership sorts first", async () => {
  await suite.db.insert(roles).values([
    { id: "a-staff", builtInKey: "staff", permissions: [] },
    { id: "z-admin", builtInKey: "admin", permissions: [] },
  ]);
  const actor = await openManagementSession(suite.db, "manager");
  const personId = await seedPerson(suite.db, "staff");
  await suite.db.insert(personRoles).values({ personId, roleId: "z-admin" });
  await suite.db
    .update(persons)
    .set({ email: "target@example.test", emailFolded: "target@example.test" })
    .where(eq(persons.id, personId));
  const before = await row(personId);
  await expect(
    run((tx) =>
      updatePersonDetails(tx, {
        managementSessionId: actor.token,
        personId,
        displayName: before.displayName,
        firstNames: "First",
        lastNames: "Last",
        telephone: null,
        email: before.email!,
        status: "suspended",
      }),
    ),
  ).rejects.toMatchObject({ code: "person.holds_more", params: { personId } });
  expect(await builtInRoleForTest(suite.db, personId)).toBe("admin");
});

describe("Rule 2 at the invitation writer", () => {
  it.each(["accountant", "admin"] as const)(
    "refuses a Manager's invitation to %s even outside the route",
    async (kind) => {
      registerModulePermissions([{ permission: "fiscal.remedy", defaultHolders: [] }]);
      const actor = await openManagementSession(suite.db, "manager");
      await suite.db
        .update(roles)
        .set({
          permissions:
            kind === "admin"
              ? declaredPermissions()
              : ["person.manage", "person.admin", "report.view"],
        })
        .where(eq(roles.builtInKey, "manager"));
      const target = await seedPerson(suite.db, kind === "admin" ? "admin" : "staff", "pending");
      if (kind === "accountant") {
        const [role] = await suite.db
          .insert(roles)
          .values({
            name: "Accountant",
            nameFolded: "accountant",
            permissions: ["report.view", "fiscal.remedy"],
          })
          .returning();
        await suite.db.insert(personRoles).values({ personId: target, roleId: role!.id });
      }
      await expect(
        run((tx) =>
          queueInvitation(tx, {
            managementSessionId: actor.token,
            personId: target,
            origin: "http://localhost",
          }),
        ),
      ).rejects.toMatchObject({ code: "person.holds_more", params: { personId: target } });
      expect(await suite.db.select().from(outgoingMail)).toEqual([]);
    },
  );
  it("requires person.admin even when the actor covers the other person", async () => {
    const actor = await managerWithoutAdminAuthority();
    const target = await seedPerson(suite.db, "staff", "pending");
    await expect(
      run((tx) =>
        queueInvitation(tx, {
          managementSessionId: actor.token,
          personId: target,
          origin: "http://localhost",
        }),
      ),
    ).rejects.toMatchObject({
      code: "authorization.not_permitted",
      params: { permission: "person.admin" },
    });
    expect(await suite.db.select().from(outgoingMail)).toEqual([]);
  });
});
