// Real Postgres, not PGlite: this suite exercises the form-factor drift-guard trigger
// (device_profile_form_factor_locked), and CLAUDE.md §4 requires the real target for anything
// about triggers firing. The clone carries CORE_MIGRATIONS, which includes the drift-guard migration
// under test. The mutating cases each create their OWN profile so the suite stays order-independent.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { seedKitchenStation, seedTenant } from "../testing/seed.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import type { LocationId, TenantId } from "@waitron/shared";

const TOKEN_HASH = "scrypt$00$00";

describe("device_profiles form-factor drift guard (locked while an active device uses it)", () => {
  const suite = useTemplateDb({ template: "core" });
  let admin: Database;
  let tenantId: TenantId;
  let locationId: LocationId;
  let stationId: string;
  let profileSeq = 0;

  beforeAll(async () => {
    admin = suite.admin;
    tenantId = await seedTenant(admin);
    const location = await admin.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Loc', array['es'], 'Hostelería') returning id`);
    locationId = location.rows[0]!.id as LocationId;
    stationId = await seedKitchenStation(admin, { tenantId, locationId });
  });

  // A fresh `kds` profile per case, so a form_factor mutation in one case never leaks into another.
  async function freshKdsProfile(): Promise<string> {
    profileSeq += 1;
    const p = await admin.execute<{ id: string }>(sql`
      insert into device_profiles (tenant_id, name, form_factor)
      values (${tenantId}, ${`KDS profile ${profileSeq}`}, 'kds') returning id`);
    return p.rows[0]!.id;
  }

  // A kds device bound to the station (the binding rule needs a station and no till for a kds profile).
  async function insertKdsDevice(profileId: string, active: boolean, label: string): Promise<void> {
    await admin.execute(sql`
      insert into devices (tenant_id, location_id, device_profile_id, station_id, till_id, label, token_hash, active)
      values (${tenantId}, ${locationId}, ${profileId}, ${stationId}, ${null}, ${label}, ${TOKEN_HASH}, ${active})`);
  }

  // Poll (bounded) until a backend in THIS clone is waiting on a lock while running `querySubstr`. The
  // proof that the FOR SHARE row lock conflicts. On the un-fixed code the query never blocks, so this
  // times out and returns — the caller's assertions then detect the bug.
  async function waitUntilBlocked(db: Database, querySubstr: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const { rows } = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from pg_stat_activity
         where datname = current_database()
           and wait_event_type = 'Lock'
           and query ilike ${`%${querySubstr}%`}`);
      if (rows[0]!.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("rejects changing form_factor while an ACTIVE device references the profile", async () => {
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, true, "Active kds");
    const error = await captureError(() =>
      admin.execute(sql`update device_profiles set form_factor = 'till' where id = ${profileId}`),
    );
    expect(pgErrorMessage(error)).toMatch(/cannot change form factor of a profile in use/);
  });

  it("allows changing form_factor when the referencing device is INACTIVE (negative control)", async () => {
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, false, "Inactive kds");
    await expect(
      admin.execute(sql`update device_profiles set form_factor = 'till' where id = ${profileId}`),
    ).resolves.toBeDefined();
    // Confirm the control succeeded for the reason we think: the value really changed.
    const [row] = (
      await admin.execute<{ form_factor: string }>(
        sql`select form_factor from device_profiles where id = ${profileId}`,
      )
    ).rows;
    expect(row!.form_factor).toBe("till");
  });

  it("allows changing form_factor when NO device references the profile (negative control)", async () => {
    const profileId = await freshKdsProfile();
    await expect(
      admin.execute(sql`update device_profiles set form_factor = 'till' where id = ${profileId}`),
    ).resolves.toBeDefined();
    const [row] = (
      await admin.execute<{ form_factor: string }>(
        sql`select form_factor from device_profiles where id = ${profileId}`,
      )
    ).rows;
    expect(row!.form_factor).toBe("till");
  });

  it("allows a no-op UPDATE that leaves form_factor unchanged, even with an active device", async () => {
    // The guard fires only when NEW.form_factor <> OLD.form_factor. An UPDATE that re-writes the same
    // value (e.g. touching updated_at) with an active device present must pass — proving the guard keys
    // on the CHANGE, not the mere presence of an active device.
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, true, "Active kds no-op");
    await expect(
      admin.execute(sql`update device_profiles set updated_at = now() where id = ${profileId}`),
    ).resolves.toBeDefined();
  });

  it("serialises a concurrent device INSERT against a form_factor change (BUG C — FOR SHARE)", async () => {
    // Two transactions race: tx1 inserts an ACTIVE kds device on profile P (its binding rule row-locks P
    // FOR SHARE); tx2 changes P.form_factor kds→till. Without the FOR SHARE lock both commit interleaved
    // and leave an active device whose binding contradicts its profile — the drift guard cannot see tx1's
    // uncommitted insert, and the insert trigger read P's form factor without locking it. With FOR SHARE
    // the UPDATE (a FOR NO KEY UPDATE row lock) blocks on tx1; once tx1 commits, tx2 re-evaluates, the
    // drift guard sees the now-committed active device, and tx2 is REJECTED. Real Postgres only — PGlite
    // serialises onto one backend and cannot express the race (CLAUDE.md §4).
    const profileId = await freshKdsProfile();

    // A second, independent connection (its own backend) so both transactions can be held open at once.
    const conn2 = await suite.pg.connect();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let signalInserted!: () => void;
      const inserted = new Promise<void>((resolve) => (signalInserted = resolve));

      // tx1: insert the active kds device (acquires FOR SHARE on P through the binding trigger), signal,
      // then HOLD until released, then commit.
      const p1 = admin.transaction(async (tx) => {
        await tx.execute(sql`
          insert into devices (tenant_id, location_id, device_profile_id, station_id, till_id, label, token_hash, active)
          values (${tenantId}, ${locationId}, ${profileId}, ${stationId}, ${null}, 'Race kds', ${TOKEN_HASH}, true)`);
        signalInserted();
        await gate;
      });
      await inserted;

      // tx2: change P's form factor. With FOR SHARE it BLOCKS on tx1; without it, it commits immediately.
      const p2 = conn2
        .transaction(async (tx) => {
          await tx.execute(
            sql`update device_profiles set form_factor = 'till' where id = ${profileId}`,
          );
        })
        .then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );

      // Bounded wait until tx2 is actually blocked on the lock — the proof the FOR SHARE lock conflicts.
      await waitUntilBlocked(admin, "update device_profiles");
      // Release tx1 so it commits and drops the lock; tx2 then re-evaluates under the drift guard.
      release();
      await p1;
      const outcome = await p2;

      // With the fix tx2 was rejected by the drift guard; without it, tx2 committed → outcome.ok === true.
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(pgErrorMessage(outcome.error)).toMatch(
          /cannot change form factor of a profile in use/,
        );
      }
      // End state consistent: P is still kds, never a till profile carrying an active kds-bound device.
      const [prof] = (
        await admin.execute<{ form_factor: string }>(
          sql`select form_factor from device_profiles where id = ${profileId}`,
        )
      ).rows;
      expect(prof!.form_factor).toBe("kds");
    } finally {
      await conn2.close();
    }
  });

  // Prove by deletion (CLAUDE.md §1/§4): with the trigger dropped, the form_factor change the guard
  // rejects above now SUCCEEDS — so the trigger is provably what enforces the rule. Done inside a
  // ROLLED-BACK transaction so the drop (and the mutated row) never outlive this test.
  it("prove-by-deletion: dropping the trigger lets the locked change succeed", async () => {
    const profileId = await freshKdsProfile();
    await insertKdsDevice(profileId, true, "Active kds for deletion");
    const sentinel = new Error("rollback sentinel");
    const outcome = await captureError(() =>
      admin.transaction(async (tx) => {
        await tx.execute(sql`drop trigger device_profile_form_factor_locked on device_profiles`);
        await tx.execute(
          sql`update device_profiles set form_factor = 'till' where id = ${profileId}`,
        );
        const { rows } = await tx.execute<{ form_factor: string }>(
          sql`select form_factor from device_profiles where id = ${profileId}`,
        );
        expect(rows[0]!.form_factor).toBe("till");
        throw sentinel; // roll the drop + the mutated row back
      }),
    );
    expect(outcome).toBe(sentinel);
  });
});
