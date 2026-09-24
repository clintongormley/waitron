import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, captureError, checkFailed, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import {
  clearPersonPin,
  createPerson,
  deactivatePerson,
  invitePerson,
  listPersons,
  reactivatePersonForInvitation,
  resetPersonLogin,
  updatePersonDetails,
} from "./staff.js";
import { loginWithPin } from "./login.js";
import { loginManager } from "./manager-login.js";
import type { PersonRoleValue } from "./permissions.js";
import {
  codeOf,
  openManagementSession,
  openSession,
  seedPerson,
  seedTill,
} from "../test/fixtures.js";

// Reset per test (the default), deliberately: the last-admin guard counts every admin in the
// database, so admins created by earlier tests would be counted too.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

describe("invited person lifecycle", () => {
  it("stores legal and contact details as Pending with no usable PIN", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const { id } = await run((tx) =>
      invitePerson(tx, {
        managementSessionId: token,
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
    const { token } = await openManagementSession(suite.db, "admin");
    const base = {
      managementSessionId: token,
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
    const { token } = await openManagementSession(suite.db, "admin");
    const inactiveId = await seedPerson(suite.db, "staff", "suspended");
    await suite.db.execute(
      sql`update persons set display_name = 'Shared name', email = 'old-shared@example.com' where id = ${inactiveId}`,
    );
    const currentId = await seedPerson(suite.db, "staff");
    await suite.db.execute(
      sql`update persons set display_name = 'Shared name', email = 'new-shared@example.com' where id = ${currentId}`,
    );

    expect(
      await codeOf(() =>
        run((tx) =>
          reactivatePersonForInvitation(tx, {
            managementSessionId: token,
            personId: inactiveId,
          }),
        ),
      ),
    ).toBe("person.display_name_taken");
  });

  it("returns the administrative fields without credential material", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const created = await run((tx) =>
      invitePerson(tx, {
        managementSessionId: token,
        displayName: "Grace",
        firstNames: "Grace Brewster",
        lastNames: "Hopper",
        telephone: null,
        role: "staff",
        email: "grace@example.com",
      }),
    );
    const roster = await run((tx) => listPersons(tx, { managementSessionId: token }));
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
    const { token } = await openManagementSession(suite.db, "admin");
    const created = await run((tx) =>
      invitePerson(tx, {
        managementSessionId: token,
        displayName: "Pending login",
        firstNames: "Pending",
        lastNames: "Login",
        telephone: null,
        role: "staff",
        email: "pending-login@example.com",
      }),
    );
    const tillId = await seedTill(suite.db);
    expect(
      await codeOf(() =>
        run((tx) => loginWithPin(tx, { tillId, personId: created.id, pin: "1234" })),
      ),
    ).toBe("pin.invalid");
    expect(
      await codeOf(() =>
        run((tx) =>
          loginManager(tx, {
            email: "pending-login@example.com",
            password: "correct horse",
          }),
        ),
      ),
    ).toBe("password.invalid");
  });

  it("updates all administrative details in one operation while preserving Pending", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const created = await run((tx) =>
      invitePerson(tx, {
        managementSessionId: token,
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
        managementSessionId: token,
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
    const roster = await run((tx) => listPersons(tx, { managementSessionId: token }));
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

  it("rejects a malformed telephone on both invite and update, but accepts an absent one", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    await expect(
      run((tx) =>
        invitePerson(tx, {
          managementSessionId: token,
          displayName: "Bad Phone",
          firstNames: "Bad",
          lastNames: "Phone",
          telephone: "123",
          role: "staff",
          email: "bad-phone@example.com",
        }),
      ),
    ).rejects.toMatchObject({ code: "person.telephone_invalid" });
    const created = await run((tx) =>
      invitePerson(tx, {
        managementSessionId: token,
        displayName: "Good Phone",
        firstNames: "Good",
        lastNames: "Phone",
        telephone: null,
        role: "staff",
        email: "good-phone@example.com",
      }),
    );
    await expect(
      run((tx) =>
        updatePersonDetails(tx, {
          managementSessionId: token,
          personId: created.id,
          displayName: "Good Phone",
          firstNames: "Good",
          lastNames: "Phone",
          telephone: "12345",
          email: "good-phone@example.com",
          role: "staff",
          status: "pending",
        }),
      ),
    ).rejects.toMatchObject({ code: "person.telephone_invalid" });
  });

  it("does not let the only active admin demote or deactivate themselves", async () => {
    const { personId, token } = await openManagementSession(suite.db, "admin");
    const attempt = (role: "staff" | "admin", status: "active" | "suspended") =>
      withTransaction(suite.db, (tx) =>
        updatePersonDetails(tx, {
          managementSessionId: token,
          personId: personId.toUpperCase(),
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
    const { token } = await openManagementSession(suite.db, "admin");
    const target = await openManagementSession(suite.db, "staff");
    const tillId = await seedTill(suite.db);
    const tillSession = await run((tx) =>
      loginWithPin(tx, { tillId, personId: target.personId, pin: "1234" }),
    );

    await run((tx) =>
      deactivatePerson(tx, { managementSessionId: token, personId: target.personId }),
    );

    // The COLUMN, not `ended_at is not null`, which answers 0 or 1 on this engine.
    const rows = await suite.db.execute<{ ended_at: string | null }>(
      sql`select ended_at from sessions where id = ${tillSession.id}`,
    );
    expect(rows.rows).toEqual([{ ended_at: expect.any(String) }]);
  });

  it("clears a PIN instead of letting an administrator choose its replacement", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const created = await run((tx) =>
      invitePerson(tx, {
        managementSessionId: token,
        displayName: "Reset pin",
        firstNames: "Reset",
        lastNames: "Pin",
        telephone: null,
        role: "staff",
        email: "reset-pin@example.com",
      }),
    );
    await suite.db.execute(sql`update persons set pin_hash = 'old-hash' where id = ${created.id}`);
    await run((tx) => clearPersonPin(tx, { managementSessionId: token, personId: created.id }));
    const row = await suite.db.execute<{ pin_hash: string | null }>(
      sql`select pin_hash from persons where id = ${created.id}`,
    );
    expect(row.rows[0]!.pin_hash).toBeNull();
  });

  it("reset login returns an account to Pending and removes its login credentials", async () => {
    const actor = await openManagementSession(suite.db, "admin");
    const target = await withTransaction(suite.db, (tx) =>
      invitePerson(tx, {
        managementSessionId: actor.token,
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
    await withTransaction(suite.db, (tx) =>
      resetPersonLogin(tx, { managementSessionId: actor.token, personId: target.id }),
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
    const { token } = await openManagementSession(suite.db, "admin");
    const target = await seedPerson(suite.db, "staff", "suspended");
    expect(
      await codeOf(() =>
        run((tx) => resetPersonLogin(tx, { managementSessionId: token, personId: target })),
      ),
    ).toBe("person.transition_invalid");
    await run((tx) =>
      reactivatePersonForInvitation(tx, { managementSessionId: token, personId: target }),
    );
    const row = await suite.db.execute<{ status: string }>(
      sql`select status from persons where id = ${target}`,
    );
    expect(row.rows[0]).toEqual({ status: "pending" });
  });

  it("does not let a manager promote themselves to admin", async () => {
    const actor = await openManagementSession(suite.db, "manager");
    expect(
      await codeOf(() =>
        run((tx) =>
          updatePersonDetails(tx, {
            managementSessionId: actor.token,
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

async function sessionEndedAt(sessionId: string): Promise<string | null> {
  const rows = await suite.db.execute<{ ended_at: string | null }>(
    sql`select ended_at from sessions where id = ${sessionId}`,
  );
  return rows.rows[0]!.ended_at;
}

async function statusOf(personId: string): Promise<string> {
  const rows = await suite.db.execute<{ status: string }>(
    sql`select status from persons where id = ${personId}`,
  );
  return rows.rows[0]!.status;
}

async function seedStaffWithSession(
  email: string,
): Promise<{ personId: string; tillSessionId: string }> {
  const personId = await seedPerson(suite.db, "staff");
  await suite.db.execute(sql`update persons set email = ${email} where id = ${personId}`);
  const tillId = await seedTill(suite.db);
  const tillSessionId = await openSession(suite.db, tillId, personId);
  return { personId, tillSessionId };
}

function details(
  token: string,
  personId: string,
  overrides: Partial<Parameters<typeof updatePersonDetails>[1]> = {},
): Parameters<typeof updatePersonDetails>[1] {
  return {
    managementSessionId: token,
    personId,
    displayName: "Edited",
    firstNames: "Edited",
    lastNames: "Person",
    telephone: null,
    email: "edited@example.com",
    role: "staff",
    status: "active",
    ...overrides,
  };
}

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("updatePersonDetails refusals and side effects", () => {
  it("refuses an edit to a person who does not exist", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    await expect(
      run((tx) => updatePersonDetails(tx, details(token, MISSING_ID))),
    ).rejects.toMatchObject({ code: "person.not_found", params: { personId: MISSING_ID } });
  });

  it("refuses to move a Pending account straight to Active", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const target = await seedPerson(suite.db, "staff", "pending");
    expect(
      await codeOf(() =>
        run((tx) => updatePersonDetails(tx, details(token, target, { status: "active" }))),
      ),
    ).toBe("person.transition_invalid");
    expect(await statusOf(target)).toBe("pending");
  });

  it("keeps the email-verified stamp when the address is unchanged", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const { personId } = await seedStaffWithSession("kept@example.com");
    await suite.db.execute(
      sql`update persons set email_verified_at = '2026-09-01T00:00:00.000Z' where id = ${personId}`,
    );
    await run((tx) =>
      updatePersonDetails(tx, details(token, personId, { email: "kept@example.com" })),
    );
    const rows = await suite.db.execute<{ email_verified_at: string | null }>(
      sql`select email_verified_at from persons where id = ${personId}`,
    );
    expect(rows.rows).toEqual([{ email_verified_at: "2026-09-01T00:00:00.000Z" }]);
  });

  it("leaves the person's sessions open when neither the address nor the status changes", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const { personId, tillSessionId } = await seedStaffWithSession("same@example.com");
    await run((tx) =>
      updatePersonDetails(
        tx,
        details(token, personId, { displayName: "Renamed", email: "same@example.com" }),
      ),
    );
    expect(await sessionEndedAt(tillSessionId)).toBeNull();
  });

  it("ends the person's sessions when only the status changes", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const { personId, tillSessionId } = await seedStaffWithSession("same@example.com");
    await run((tx) =>
      updatePersonDetails(
        tx,
        details(token, personId, { email: "same@example.com", status: "suspended" }),
      ),
    );
    expect(await sessionEndedAt(tillSessionId)).toEqual(expect.any(String));
  });

  it("lets a manager edit the only active admin's details when role and status stay the same", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    const admin = await seedPerson(suite.db, "admin");
    await run((tx) =>
      updatePersonDetails(
        tx,
        details(token, admin, { displayName: "Only admin", role: "admin", status: "active" }),
      ),
    );
    const rows = await suite.db.execute<{ display_name: string; role: string; status: string }>(
      sql`select display_name, role, status from persons where id = ${admin}`,
    );
    expect(rows.rows).toEqual([{ display_name: "Only admin", role: "admin", status: "active" }]);
  });
});

describe("deactivatePerson refusals", () => {
  it("refuses a person who does not exist", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    await expect(
      run((tx) => deactivatePerson(tx, { managementSessionId: token, personId: MISSING_ID })),
    ).rejects.toMatchObject({ code: "person.not_found", params: { personId: MISSING_ID } });
  });

  it("refuses to let a manager deactivate themselves, whatever the case of the id", async () => {
    const { token, personId } = await openManagementSession(suite.db, "manager");
    expect(
      await codeOf(() =>
        run((tx) =>
          deactivatePerson(tx, {
            managementSessionId: token,
            personId: personId.toUpperCase(),
          }),
        ),
      ),
    ).toBe("person.self_deactivation");
    expect(await statusOf(personId)).toBe("active");
  });

  it("refuses to deactivate the only active admin", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    const admin = await seedPerson(suite.db, "admin");
    expect(
      await codeOf(() =>
        run((tx) => deactivatePerson(tx, { managementSessionId: token, personId: admin })),
      ),
    ).toBe("person.last_admin");
    expect(await statusOf(admin)).toBe("active");
  });

  it("deactivates an admin while another active admin remains", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const admin = await seedPerson(suite.db, "admin");
    await run((tx) => deactivatePerson(tx, { managementSessionId: token, personId: admin }));
    expect(await statusOf(admin)).toBe("suspended");
  });

  it("does nothing to an account that is already inactive, its sessions included", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const { personId, tillSessionId } = await seedStaffWithSession("inactive@example.com");
    await suite.db.execute(sql`update persons set status = 'suspended' where id = ${personId}`);
    await run((tx) => deactivatePerson(tx, { managementSessionId: token, personId }));
    expect(await statusOf(personId)).toBe("suspended");
    expect(await sessionEndedAt(tillSessionId)).toBeNull();
  });
});

describe("clearPersonPin refusals", () => {
  it("refuses a person who does not exist", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    await expect(
      run((tx) => clearPersonPin(tx, { managementSessionId: token, personId: MISSING_ID })),
    ).rejects.toMatchObject({ code: "person.not_found", params: { personId: MISSING_ID } });
  });
});

describe("resetPersonLogin refusals", () => {
  it("refuses a person who does not exist", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    await expect(
      run((tx) => resetPersonLogin(tx, { managementSessionId: token, personId: MISSING_ID })),
    ).rejects.toMatchObject({ code: "person.not_found", params: { personId: MISSING_ID } });
  });

  it("refuses to reset the only active admin", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    const admin = await seedPerson(suite.db, "admin");
    expect(
      await codeOf(() =>
        run((tx) => resetPersonLogin(tx, { managementSessionId: token, personId: admin })),
      ),
    ).toBe("person.last_admin");
    expect(await statusOf(admin)).toBe("active");
  });

  it("resets an admin while another active admin remains", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const admin = await seedPerson(suite.db, "admin");
    await run((tx) => resetPersonLogin(tx, { managementSessionId: token, personId: admin }));
    expect(await statusOf(admin)).toBe("pending");
  });
});

describe("reactivatePersonForInvitation refusals", () => {
  it("refuses a person who does not exist", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    await expect(
      run((tx) =>
        reactivatePersonForInvitation(tx, { managementSessionId: token, personId: MISSING_ID }),
      ),
    ).rejects.toMatchObject({ code: "person.not_found", params: { personId: MISSING_ID } });
  });

  it("refuses an account that is not inactive", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const target = await seedPerson(suite.db, "staff");
    expect(
      await codeOf(() =>
        run((tx) =>
          reactivatePersonForInvitation(tx, { managementSessionId: token, personId: target }),
        ),
      ),
    ).toBe("person.transition_invalid");
    expect(await statusOf(target)).toBe("active");
  });
});

describe("invitePerson required text", () => {
  it.each(["displayName", "firstNames", "lastNames"] as const)(
    "refuses a blank %s, naming the field",
    async (field) => {
      const { token } = await openManagementSession(suite.db, "admin");
      await expect(
        run((tx) =>
          invitePerson(tx, {
            managementSessionId: token,
            displayName: "Blank",
            firstNames: "Blank",
            lastNames: "Field",
            telephone: null,
            role: "staff",
            email: "blank@example.com",
            [field]: "   ",
          }),
        ),
      ).rejects.toMatchObject({ code: "profile.invalid", params: { field } });
    },
  );
});

/**
 * A row that lands between a write path's availability pre-check and its write. No second writer
 * can land in that gap for real, so a `before` trigger on `persons` plants it. The trigger text is
 * constant: SQLite binds no value inside a trigger body. It is dropped in `finally` because the
 * per-test reset recreates only the triggers the migrations installed.
 */
const PLANT_RACER = {
  insert: "before insert",
  update: "before update",
} as const;

async function withRacerPlanted<T>(
  event: keyof typeof PLANT_RACER,
  fn: () => Promise<T>,
): Promise<T> {
  await suite.db.execute(
    sql.raw(`create trigger tmp_plant_racer ${PLANT_RACER[event]} on persons
      when new.id <> 'racer' and not exists (select 1 from persons where id = 'racer')
      begin
        insert into persons
          (id, display_name, display_name_folded, email, email_folded, role, status, created_at)
        values
          ('racer', 'Racer', 'racer', 'racer@example.com', 'racer@example.com', 'staff', 'active',
           '2026-09-23T00:00:00.000Z');
      end`),
  );
  try {
    return await fn();
  } finally {
    await suite.db.execute(sql`drop trigger tmp_plant_racer`);
  }
}

async function personCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(sql`select count(*) as n from persons`);
  return rows.rows[0]!.n;
}

describe("a colliding row that lands after the pre-check", () => {
  it("invitePerson reports a display-name collision as person.display_name_taken", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const before = await personCount();
    await expect(
      withRacerPlanted("insert", () =>
        run((tx) =>
          invitePerson(tx, {
            managementSessionId: token,
            displayName: "Racer",
            firstNames: "Late",
            lastNames: "Comer",
            telephone: null,
            role: "staff",
            email: "late@example.com",
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "person.display_name_taken",
      params: { displayName: "Racer" },
    });
    expect(await personCount()).toBe(before);
  });

  it("invitePerson reports a login-email collision as person.email_taken", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    await expect(
      withRacerPlanted("insert", () =>
        run((tx) =>
          invitePerson(tx, {
            managementSessionId: token,
            displayName: "Late comer",
            firstNames: "Late",
            lastNames: "Comer",
            telephone: null,
            role: "staff",
            email: " Racer@Example.com ",
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "person.email_taken", params: { email: "racer@example.com" } });
  });

  it("invitePerson passes a refusal that is not a collision through untranslated", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const error = await captureError(() =>
      run((tx) =>
        invitePerson(tx, {
          managementSessionId: token,
          displayName: "Bad role",
          firstNames: "Bad",
          lastNames: "Role",
          telephone: null,
          role: "owner" as PersonRoleValue,
          email: "bad-role@example.com",
        }),
      ),
    );
    expect(isAppError(error)).toBe(false);
    expect(checkFailed(error, "persons_role_ck")).toBe(true);
  });

  it("createPerson reports a display-name collision as person.display_name_taken", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const before = await personCount();
    await expect(
      withRacerPlanted("insert", () =>
        run((tx) =>
          createPerson(tx, {
            managementSessionId: token,
            displayName: "Racer",
            role: "staff",
            pin: "5678",
            email: "late@example.com",
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "person.display_name_taken",
      params: { displayName: "Racer" },
    });
    expect(await personCount()).toBe(before);
  });

  it("createPerson reports a login-email collision as person.email_taken", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    await expect(
      withRacerPlanted("insert", () =>
        run((tx) =>
          createPerson(tx, {
            managementSessionId: token,
            displayName: "Late comer",
            role: "staff",
            pin: "5678",
            email: " Racer@Example.com ",
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "person.email_taken", params: { email: "racer@example.com" } });
  });

  it("createPerson passes a refusal that is not a collision through untranslated", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const error = await captureError(() =>
      run((tx) =>
        createPerson(tx, {
          managementSessionId: token,
          displayName: "Bad role",
          role: "owner" as PersonRoleValue,
          pin: "5678",
          email: "bad-role@example.com",
        }),
      ),
    );
    expect(isAppError(error)).toBe(false);
    expect(checkFailed(error, "persons_role_ck")).toBe(true);
  });

  it("updatePersonDetails reports a display-name collision as person.display_name_taken", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const { personId } = await seedStaffWithSession("editing@example.com");
    await expect(
      withRacerPlanted("update", () =>
        run((tx) =>
          updatePersonDetails(
            tx,
            details(token, personId, { displayName: "Racer", email: "editing@example.com" }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      code: "person.display_name_taken",
      params: { displayName: "Racer" },
    });
  });

  it("reactivatePersonForInvitation reports a display-name collision as person.display_name_taken", async () => {
    const { token } = await openManagementSession(suite.db, "admin");
    const target = await seedPerson(suite.db, "staff", "suspended");
    await suite.db.execute(sql`update persons set display_name = 'Racer' where id = ${target}`);
    await expect(
      withRacerPlanted("update", () =>
        run((tx) =>
          reactivatePersonForInvitation(tx, { managementSessionId: token, personId: target }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "person.display_name_taken",
      params: { displayName: "Racer" },
    });
    expect(await statusOf(target)).toBe("suspended");
  });
});
