import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import {
  clearPersonPin,
  deactivatePerson,
  invitePerson,
  listPersons,
  reactivatePersonForInvitation,
  resetPersonLogin,
  updatePersonDetails,
} from "./staff.js";
import { loginWithPin } from "./login.js";
import { loginManager } from "./manager-login.js";
import { codeOf, openManagementSession, seedPerson, seedTill } from "../test/fixtures.js";

let tenantId: string;
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

describe("invited person lifecycle", () => {
  it("stores legal and contact details as Pending with no usable PIN", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const { id } = await run((tx) =>
      invitePerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "  Ada  ",
        firstNames: " Ada ",
        lastNames: " Lovelace ",
        telephone: " +44 20 1234 ",
        role: "manager",
        email: " ADA@example.com ",
      }),
    );

    const result = await suite.db.execute<{
      display_name: string;
      first_names: string;
      last_names: string;
      telephone: string;
      email: string;
      status: string;
      pin_hash: string | null;
    }>(sql`select display_name, first_names, last_names, telephone, email, status, pin_hash
           from persons where id = ${id}`);
    expect(result.rows).toEqual([
      {
        display_name: "Ada",
        first_names: "Ada",
        last_names: "Lovelace",
        telephone: "+44 20 1234",
        email: "ada@example.com",
        status: "pending",
        pin_hash: null,
      },
    ]);
  });

  it("allows duplicate legal names but rejects duplicate active-or-pending display names", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const base = {
      tenantId,
      managementSessionId: sessionId,
      firstNames: "Alex",
      lastNames: "Smith",
      telephone: null,
      role: "staff" as const,
    };
    await run((tx) =>
      invitePerson(tx, { ...base, displayName: "Alex", email: "alex.one@example.com" }),
    );
    await run((tx) =>
      invitePerson(tx, { ...base, displayName: "Alex S", email: "alex.two@example.com" }),
    );
    expect(
      await codeOf(() =>
        run((tx) =>
          invitePerson(tx, {
            ...base,
            displayName: " alex ",
            email: "alex.three@example.com",
          }),
        ),
      ),
    ).toBe("person.display_name_taken");
  });

  it("rejects reactivating an inactive account whose display name is now in use", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const inactiveId = await seedPerson(suite.db, tenantId, "staff", "suspended");
    await suite.db.execute(
      sql`update persons set display_name = 'Shared name', email = 'old-shared@example.com' where id = ${inactiveId}`,
    );
    const currentId = await seedPerson(suite.db, tenantId, "staff");
    await suite.db.execute(
      sql`update persons set display_name = 'Shared name', email = 'new-shared@example.com' where id = ${currentId}`,
    );

    expect(
      await codeOf(() =>
        run((tx) =>
          reactivatePersonForInvitation(tx, {
            managementSessionId: sessionId,
            personId: inactiveId,
          }),
        ),
      ),
    ).toBe("person.display_name_taken");
  });

  it("returns the administrative fields without credential material", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const created = await run((tx) =>
      invitePerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Grace",
        firstNames: "Grace Brewster",
        lastNames: "Hopper",
        telephone: null,
        role: "staff",
        email: "grace@example.com",
      }),
    );
    const roster = await run((tx) => listPersons(tx, { managementSessionId: sessionId }));
    expect(roster.find((person) => person.personId === created.id)).toMatchObject({
      displayName: "Grace",
      firstNames: "Grace Brewster",
      lastNames: "Hopper",
      telephone: null,
      email: "grace@example.com",
      status: "pending",
    });
    expect(JSON.stringify(roster)).not.toContain("pinHash");
  });

  it("does not allow a Pending account through normal password or PIN login", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const created = await run((tx) =>
      invitePerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Pending login",
        firstNames: "Pending",
        lastNames: "Login",
        telephone: null,
        role: "staff",
        email: "pending-login@example.com",
      }),
    );
    const tillId = await seedTill(suite.db, tenantId);
    expect(
      await codeOf(() =>
        run((tx) => loginWithPin(tx, { tenantId, tillId, personId: created.id, pin: "1234" })),
      ),
    ).toBe("pin.invalid");
    expect(
      await codeOf(() =>
        run((tx) =>
          loginManager(tx, {
            tenantId,
            email: "pending-login@example.com",
            password: "correct horse",
          }),
        ),
      ),
    ).toBe("password.invalid");
  });

  it("updates all administrative details in one operation while preserving Pending", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const created = await run((tx) =>
      invitePerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Edit me",
        firstNames: "Edith",
        lastNames: "Old",
        telephone: null,
        role: "staff",
        email: "edit-me@example.com",
      }),
    );
    await run((tx) =>
      updatePersonDetails(tx, {
        managementSessionId: sessionId,
        personId: created.id,
        displayName: "Edie",
        firstNames: "Edith Mary",
        lastNames: "New",
        telephone: "+34 600 000 000",
        email: "edie@example.com",
        role: "supervisor",
        status: "pending",
      }),
    );
    const roster = await run((tx) => listPersons(tx, { managementSessionId: sessionId }));
    expect(roster.find((person) => person.personId === created.id)).toMatchObject({
      displayName: "Edie",
      firstNames: "Edith Mary",
      lastNames: "New",
      telephone: "+34 600 000 000",
      email: "edie@example.com",
      role: "supervisor",
      status: "pending",
    });
  });

  it("does not let the only active admin demote or deactivate themselves", async () => {
    const isolatedTenant = await seedTenant(suite.db);
    const { personId, sessionId } = await openManagementSession(suite.db, isolatedTenant, "admin");
    const attempt = (role: "staff" | "admin", status: "active" | "suspended") =>
      withTenant(suite.db, isolatedTenant, (tx) =>
        updatePersonDetails(tx, {
          managementSessionId: sessionId,
          personId,
          displayName: "Owner",
          firstNames: "Only",
          lastNames: "Owner",
          telephone: null,
          email: "only-owner@example.com",
          role,
          status,
        }),
      );
    expect(await codeOf(() => attempt("staff", "active"))).toBe("person.last_admin");
    expect(await codeOf(() => attempt("admin", "suspended"))).toBe("person.self_deactivation");
  });

  it("ends dashboard and till sessions when an administrator marks a person inactive", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const target = await openManagementSession(suite.db, tenantId, "staff");
    const tillId = await seedTill(suite.db, tenantId);
    const tillSession = await run((tx) =>
      loginWithPin(tx, { tenantId, tillId, personId: target.personId, pin: "1234" }),
    );

    await run((tx) =>
      deactivatePerson(tx, { managementSessionId: sessionId, personId: target.personId }),
    );

    const rows = await suite.db.execute<{ ended: boolean }>(
      sql`select ended_at is not null as ended from sessions where id = ${tillSession.id}`,
    );
    expect(rows.rows).toEqual([{ ended: true }]);
  });

  it("clears a PIN instead of letting an administrator choose its replacement", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const created = await run((tx) =>
      invitePerson(tx, {
        tenantId,
        managementSessionId: sessionId,
        displayName: "Reset pin",
        firstNames: "Reset",
        lastNames: "Pin",
        telephone: null,
        role: "staff",
        email: "reset-pin@example.com",
      }),
    );
    await suite.db.execute(sql`update persons set pin_hash = 'old-hash' where id = ${created.id}`);
    await run((tx) => clearPersonPin(tx, { managementSessionId: sessionId, personId: created.id }));
    const row = await suite.db.execute<{ pin_hash: string | null }>(
      sql`select pin_hash from persons where id = ${created.id}`,
    );
    expect(row.rows[0]!.pin_hash).toBeNull();
  });

  it("reset login returns an account to Pending and removes its login credentials", async () => {
    const isolatedTenant = await seedTenant(suite.db);
    const actor = await openManagementSession(suite.db, isolatedTenant, "admin");
    const target = await withTenant(suite.db, isolatedTenant, (tx) =>
      invitePerson(tx, {
        tenantId: isolatedTenant,
        managementSessionId: actor.sessionId,
        displayName: "Reset login",
        firstNames: "Reset",
        lastNames: "Login",
        telephone: null,
        role: "manager",
        email: "reset-login@example.com",
      }),
    );
    await suite.db.execute(sql`update persons
      set status = 'active', pin_hash = 'pin', password_hash = 'password', totp_secret = 'totp'
      where id = ${target.id}`);
    await withTenant(suite.db, isolatedTenant, (tx) =>
      resetPersonLogin(tx, { managementSessionId: actor.sessionId, personId: target.id }),
    );
    const row = await suite.db.execute<{
      status: string;
      pin_hash: string | null;
      password_hash: string | null;
      totp_secret: string | null;
    }>(
      sql`select status, pin_hash, password_hash, totp_secret from persons where id = ${target.id}`,
    );
    expect(row.rows[0]).toEqual({
      status: "pending",
      pin_hash: null,
      password_hash: null,
      totp_secret: null,
    });
  });

  it("keeps inactive accounts inactive unless the explicit reactivation action is used", async () => {
    const { sessionId } = await openManagementSession(suite.db, tenantId, "admin");
    const target = await seedPerson(suite.db, tenantId, "staff", "suspended");
    expect(
      await codeOf(() =>
        run((tx) => resetPersonLogin(tx, { managementSessionId: sessionId, personId: target })),
      ),
    ).toBe("person.transition_invalid");
    await run((tx) =>
      reactivatePersonForInvitation(tx, { managementSessionId: sessionId, personId: target }),
    );
    const row = await suite.db.execute<{ status: string }>(
      sql`select status from persons where id = ${target}`,
    );
    expect(row.rows[0]).toEqual({ status: "pending" });
  });

  it("does not let a manager promote themselves to admin", async () => {
    const actor = await openManagementSession(suite.db, tenantId, "manager");
    expect(
      await codeOf(() =>
        run((tx) =>
          updatePersonDetails(tx, {
            managementSessionId: actor.sessionId,
            personId: actor.personId,
            displayName: "Manager",
            firstNames: "Manager",
            lastNames: "Person",
            telephone: null,
            email: "manager-promotion@example.com",
            role: "admin",
            status: "active",
          }),
        ),
      ),
    ).toBe("authorization.not_permitted");
  });
});
