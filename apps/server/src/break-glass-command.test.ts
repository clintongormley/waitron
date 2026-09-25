import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowIso, openVenueDatabase, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  hashPassword,
  hashPin,
  persons,
  verifyPassword,
  webauthnCredentials,
} from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { openBreakGlassVenue, runBreakGlassReset } from "./break-glass-command.js";
import { ALL_MODULES } from "./modules.js";

// `useVenueDb` empties the data after every test, so each case provisions its own venue.
const LOCALE = "es-ES";
const OLD_PASSWORD = "dashPass123";
const NEW_PASSWORD = "brandNewSecret";
const NIF = "73000001K";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** Provisioning seeds exactly one admin with the given password. */
async function setupTenant(adminPassword: string = OLD_PASSWORD): Promise<{ adminId: string }> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: NIF,
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(adminPassword),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  return { adminId: await readSoleAdminId() };
}

async function readSoleAdminId(): Promise<string> {
  const rows = await suite.db.execute<{ id: string }>(
    sql`select id from persons where role = 'admin'`,
  );
  return rows.rows[0]!.id;
}

async function readPerson(
  personId: string,
): Promise<{ passwordHash: string | null; status: string } | undefined> {
  const rows = await suite.db.execute<{ password_hash: string | null; status: string }>(
    sql`select password_hash, status from persons where id = ${personId}`,
  );
  const row = rows.rows[0];
  return row === undefined ? undefined : { passwordHash: row.password_hash, status: row.status };
}

/**
 * The stub's `close` leaves the suite's handle open but is COUNTED, because releasing the venue
 * files is the command's own obligation. `directories` pins the env-to-directory resolution.
 */
async function run(
  env: Record<string, string | undefined>,
  argv: string[] = [],
): Promise<{ code: number; out: string[]; directories: string[]; closes: number }> {
  const out: string[] = [];
  const directories: string[] = [];
  let closes = 0;
  const code = await runBreakGlassReset({
    argv,
    env,
    out: (line) => out.push(line),
    openDb: (directory: string) => {
      directories.push(directory);
      return Promise.resolve({
        db: suite.db as Database,
        close: () => {
          closes += 1;
          return Promise.resolve();
        },
      });
    },
  });
  return { code, out, directories, closes };
}

// `null` omits the password: `undefined` would take the default.
function baseEnv(password: string | null = NEW_PASSWORD) {
  return {
    WAITRON_VENUE_DIR: "/tmp/break-glass-venue-dir-is-ignored-by-the-stub",
    ...(password === null ? {} : { WAITRON_BREAKGLASS_PASSWORD: password }),
  };
}

describe("runBreakGlassReset (SQLite venue directory)", () => {
  it("resets the admin's password: the new one verifies, the old one fails (login restored)", async () => {
    const { adminId } = await setupTenant();

    const { code, out, closes } = await run(baseEnv());

    expect(code).toBe(0);
    const person = await readPerson(adminId);
    expect(person).toBeDefined();
    expect(verifyPassword(NEW_PASSWORD, person!.passwordHash!)).toBe(true);
    expect(verifyPassword(OLD_PASSWORD, person!.passwordHash!)).toBe(false);
    expect(out.join("\n")).toMatch(adminId);
    expect(out.join("\n")).not.toMatch(NEW_PASSWORD);
    expect(closes).toBe(1);
  });

  it("opens the directory WAITRON_VENUE_DIR names, and an EMPTY value takes <stateDir>/venue", async () => {
    await setupTenant();

    const named = await run({ ...baseEnv(), WAITRON_VENUE_DIR: "/tmp/break-glass-named-venue" });
    expect(named.code).toBe(0);
    expect(named.directories).toEqual(["/tmp/break-glass-named-venue"]);

    // Never `resolve("")`, which is the working directory (CLAUDE.md §3).
    await setupTenant();
    const empty = await run({
      ...baseEnv(),
      WAITRON_STATE_DIR: "/tmp/break-glass-state",
      WAITRON_VENUE_DIR: "",
    });
    expect(empty.code).toBe(0);
    expect(empty.directories).toEqual(["/tmp/break-glass-state/venue"]);
  });

  it("optionally resets the PIN when WAITRON_BREAKGLASS_PIN is set", async () => {
    const { adminId } = await setupTenant();
    const before = await readPerson(adminId);

    const { code } = await run({ ...baseEnv(), WAITRON_BREAKGLASS_PIN: "9999" });
    expect(code).toBe(0);

    const rows = await suite.db.execute<{ pin_hash: string }>(
      sql`select pin_hash from persons where id = ${adminId}`,
    );
    const after = rows.rows[0]!.pin_hash;
    expect(before).toBeDefined();
    const { verifyPin } = await import("@waitron/identity");
    expect(verifyPin("9999", after)).toBe(true);
    expect(verifyPin("1234", after)).toBe(false);
  });

  it("reactivates a suspended admin (status → active)", async () => {
    const { adminId } = await setupTenant();
    await suite.db.execute(sql`update persons set status = 'suspended' where id = ${adminId}`);
    expect((await readPerson(adminId))!.status).toBe("suspended");

    const { code } = await run(baseEnv());
    expect(code).toBe(0);
    expect((await readPerson(adminId))!.status).toBe("active");
  });

  it("clears second factors and linked login methods so the replacement password restores access", async () => {
    const { adminId } = await setupTenant();
    await suite.db.execute(
      sql`update persons set totp_secret = 'sealed', google_subject = 'subject' where id = ${adminId}`,
    );
    // Through the table definition: a raw insert never reaches the `$defaultFn` generators for `id`
    // and `created_at`.
    await suite.db
      .insert(webauthnCredentials)
      .values({ personId: adminId, credentialId: "credential", publicKey: "key" });
    // Raw because `@waitron/identity` does not export `recoveryCodes`, so it supplies both columns.
    await suite.db.execute(
      sql`insert into recovery_codes (id, person_id, code_hash, created_at)
          values (${randomUUID()}, ${adminId}, ${"a".repeat(64)}, ${nowIso()})`,
    );

    expect((await run(baseEnv())).code).toBe(0);

    const state = await suite.db.execute<{
      totp_secret: string | null;
      google_subject: string | null;
      passkeys: number;
      recovery_codes: number;
    }>(sql`select p.totp_secret, p.google_subject,
      -- cast(x as int) rather than the PostgreSQL cast operator, which this engine refuses with
      -- unrecognized token ":" -- the same rewrite working-order.ts took.
      (select cast(count(*) as int) from webauthn_credentials w where w.person_id=p.id) as passkeys,
      (select cast(count(*) as int) from recovery_codes r where r.person_id=p.id) as recovery_codes
      from persons p where p.id=${adminId}`);
    expect(state.rows[0]).toEqual({
      totp_secret: null,
      google_subject: null,
      passkeys: 0,
      recovery_codes: 0,
    });
  });

  it("missing new-password env → returns 2 (usage), opens nothing and does NOT touch the row", async () => {
    const { adminId } = await setupTenant();
    const before = await readPerson(adminId);

    const { code, directories } = await run(baseEnv(null));
    expect(code).toBe(2);
    // Refused before the venue is opened.
    expect(directories).toEqual([]);

    const after = await readPerson(adminId);
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it("too-short new password → returns 2, row untouched", async () => {
    const { adminId } = await setupTenant();
    const before = await readPerson(adminId);

    const { code } = await run(baseEnv("short"));
    expect(code).toBe(2);

    const after = await readPerson(adminId);
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it("too-short PIN → returns 2, row untouched (same floor as the gated resetPin)", async () => {
    const { adminId } = await setupTenant();
    const before = await readPerson(adminId);

    // A valid password rides along, so only the PIN floor can be what refuses.
    const { code } = await run({ ...baseEnv(), WAITRON_BREAKGLASS_PIN: "12" });
    expect(code).toBe(2);

    const after = await readPerson(adminId);
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it("no admin on the box → returns 1, and the message says so", async () => {
    const { code, out } = await run(baseEnv());
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/no admin/i);
  });

  it("two admins, no --person → returns 1 and lists both ids; --person resets exactly one", async () => {
    const { adminId } = await setupTenant();
    // Through the table definition, for the `$defaultFn` reason above (`persons.id`).
    const [inserted] = await suite.db
      .insert(persons)
      .values({
        displayName: "Second Admin",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword(OLD_PASSWORD),
        role: "admin",
      })
      .returning({ id: persons.id });
    const secondId = inserted!.id;

    const ambiguous = await run(baseEnv());
    expect(ambiguous.code).toBe(1);
    const joined = ambiguous.out.join("\n");
    expect(joined).toMatch(adminId);
    expect(joined).toMatch(secondId);
    expect(verifyPassword(OLD_PASSWORD, (await readPerson(adminId))!.passwordHash!)).toBe(true);
    expect(verifyPassword(OLD_PASSWORD, (await readPerson(secondId))!.passwordHash!)).toBe(true);

    const targeted = await run(baseEnv(), ["--person", secondId]);
    expect(targeted.code).toBe(0);
    expect(verifyPassword(NEW_PASSWORD, (await readPerson(secondId))!.passwordHash!)).toBe(true);
    expect(verifyPassword(OLD_PASSWORD, (await readPerson(adminId))!.passwordHash!)).toBe(true);
  });

  it("--person as the last token (no following id) → returns 2 (usage), nothing reset", async () => {
    const { adminId } = await setupTenant();
    const before = await readPerson(adminId);
    const { code, out } = await run(baseEnv(), ["--person"]);
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/--person/);
    const after = await readPerson(adminId);
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it("--person naming a non-admin/absent id → returns 1, nothing reset", async () => {
    const { adminId } = await setupTenant();
    const { code } = await run(baseEnv(), ["--person", "33333333-3333-4333-8333-333333333333"]);
    expect(code).toBe(1);
    expect(verifyPassword(OLD_PASSWORD, (await readPerson(adminId))!.passwordHash!)).toBe(true);
  });

  it("the new credential is read from env, never argv: a password in argv is ignored", async () => {
    const { adminId } = await setupTenant();
    const before = await readPerson(adminId);
    const { code } = await run(baseEnv(null), ["--person", adminId, NEW_PASSWORD]);
    expect(code).toBe(2);
    const after = await readPerson(adminId);
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });
});

describe("runBreakGlassReset — refusals inside the reset", () => {
  it("returns 1 and leaves the admin suspended when reactivating them would duplicate a live display name", async () => {
    const { adminId } = await setupTenant();
    await suite.db.execute(sql`update persons set status = 'suspended' where id = ${adminId}`);
    // The suspended admin's name is outside the live-name index, so another person may take it.
    await suite.db.insert(persons).values({
      displayName: "Administradora",
      pinHash: hashPin("5678"),
      role: "staff",
    });

    const { code, out, closes } = await run(baseEnv());

    expect(code).toBe(1);
    expect(out).toEqual(["break-glass: that display name is already used by an active account"]);
    const after = await readPerson(adminId);
    expect(after!.status).toBe("suspended");
    expect(verifyPassword(OLD_PASSWORD, after!.passwordHash!)).toBe(true);
    expect(closes).toBe(1);
  });

  it("returns 1 and removes no login factor when the update touches no row", async () => {
    const { adminId } = await setupTenant();
    await suite.db
      .insert(webauthnCredentials)
      .values({ personId: adminId, credentialId: "credential", publicKey: "key" });
    // Stands in for the row vanishing between the read and the write: the engine skips the update.
    await suite.db.execute(
      sql`create trigger break_glass_skip_update before update on persons begin select raise(ignore); end`,
    );
    try {
      const { code, out, closes } = await run(baseEnv());

      expect(code).toBe(1);
      expect(out).toEqual(["break-glass: expected to reset one admin, affected 0"]);
      expect(closes).toBe(1);
    } finally {
      await suite.db.execute(sql`drop trigger break_glass_skip_update`);
    }
    const passkeys = await suite.db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from webauthn_credentials where person_id = ${adminId}`,
    );
    expect(passkeys.rows[0]!.n).toBe(1);
    expect(verifyPassword(OLD_PASSWORD, (await readPerson(adminId))!.passwordHash!)).toBe(true);
  });

  it("rethrows a refusal that is not a duplicate name, and still closes the venue", async () => {
    const { adminId } = await setupTenant();
    await suite.db.execute(
      sql`create trigger break_glass_refuse_update before update on persons begin select raise(abort, 'refused by test trigger'); end`,
    );
    let closes = 0;
    try {
      await expect(
        runBreakGlassReset({
          argv: [],
          env: baseEnv(),
          out: () => {},
          openDb: () =>
            Promise.resolve({
              db: suite.db as Database,
              close: () => {
                closes += 1;
                return Promise.resolve();
              },
            }),
        }),
      ).rejects.toThrow("refused by test trigger");
    } finally {
      await suite.db.execute(sql`drop trigger break_glass_refuse_update`);
    }
    expect(closes).toBe(1);
    expect(verifyPassword(OLD_PASSWORD, (await readPerson(adminId))!.passwordHash!)).toBe(true);
  });

  it("with no injected opener, resets the admin in the real venue directory WAITRON_VENUE_DIR names", async () => {
    const directory = await mkdtemp(join(tmpdir(), "break-glass-live-"));
    try {
      await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
      const seeded = await openVenueDatabase(directory);
      const [admin] = await seeded.venue
        .insert(persons)
        .values({
          displayName: "Live Admin",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword(OLD_PASSWORD),
          role: "admin",
        })
        .returning({ id: persons.id });
      await seeded.close();

      const out: string[] = [];
      const code = await runBreakGlassReset({
        argv: [],
        env: { WAITRON_VENUE_DIR: directory, WAITRON_BREAKGLASS_PASSWORD: NEW_PASSWORD },
        out: (line) => out.push(line),
      });

      expect(code).toBe(0);
      expect(out).toEqual([`break-glass: reset admin ${admin!.id} (password, reactivated)`]);
      const reread = await openVenueDatabase(directory);
      try {
        const rows = await reread.venue.execute<{ password_hash: string }>(
          sql`select password_hash from persons where id = ${admin!.id}`,
        );
        expect(verifyPassword(NEW_PASSWORD, rows.rows[0]!.password_hash)).toBe(true);
      } finally {
        await reread.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("openBreakGlassVenue", () => {
  it("opens a venue folder a running server holds, because break-glass runs beside it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "break-glass-beside-"));
    const script = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1]);
db.exec("begin immediate");
process.stdout.write("held");
setInterval(() => db, 1000);`;
    const holder = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, join(directory, "venue.lock")],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.on("data", (c: Buffer) => c.toString().includes("held") && resolve());
        holder.on("exit", (code) => reject(new Error(`holder exited early (${code})`)));
      });
      const opened = await openBreakGlassVenue(directory);
      await opened.close();
    } finally {
      holder.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
