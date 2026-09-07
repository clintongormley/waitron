// Real Postgres, not PGlite: the binding-rule triggers (device_binding_rule_insert +
// device_binding_rule_update) are what this suite
// exercises, and CLAUDE.md §4 requires the real target for anything about triggers firing under the
// deployment role. The trigger fires on both targets, but the seeds run as the owner and the inserts
// are the app-role write path, so the realism is the point. The clone carries CORE_MIGRATIONS, which
// includes the drop-device_kind + device_binding_rule migrations under test.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { seedKitchenStation, seedTenant } from "../testing/seed.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import type { LocationId, TenantId } from "@waitron/shared";

const TOKEN_HASH = "scrypt$00$00";

describe("devices binding-rule trigger (form factor → station XOR register)", () => {
  const suite = useTemplateDb({ template: "core" });
  let admin: Database;
  let tenantId: TenantId;
  let locationId: LocationId;
  let stationId: string;
  let tillId: string;
  let kdsProfileId: string;
  let tillProfileId: string;

  beforeAll(async () => {
    admin = suite.admin;
    tenantId = await seedTenant(admin);
    const location = await admin.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Loc', array['es'], 'Hostelería') returning id`);
    locationId = location.rows[0]!.id as LocationId;
    stationId = await seedKitchenStation(admin, { tenantId, locationId });
    const till = await admin.execute<{ id: string }>(sql`
      insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till') returning id`);
    tillId = till.rows[0]!.id;
    const kds = await admin.execute<{ id: string }>(sql`
      insert into device_profiles (tenant_id, name, form_factor) values (${tenantId}, 'KDS profile', 'kds') returning id`);
    kdsProfileId = kds.rows[0]!.id;
    const tillProfile = await admin.execute<{ id: string }>(sql`
      insert into device_profiles (tenant_id, name, form_factor) values (${tenantId}, 'Till profile', 'till') returning id`);
    tillProfileId = tillProfile.rows[0]!.id;
  });

  async function insertDevice(fields: {
    profileId: string;
    stationId: string | null;
    tillId: string | null;
    label: string;
  }): Promise<void> {
    await admin.execute(sql`
      insert into devices (tenant_id, location_id, device_profile_id, station_id, till_id, label, token_hash)
      values (${tenantId}, ${locationId}, ${fields.profileId}, ${fields.stationId}, ${fields.tillId},
              ${fields.label}, ${TOKEN_HASH})`);
  }

  it("accepts a kds-profile device bound to a station and no register", async () => {
    await expect(
      insertDevice({ profileId: kdsProfileId, stationId, tillId: null, label: "KDS ok" }),
    ).resolves.toBeUndefined();
  });

  it("accepts a till-profile device bound to a register and no station", async () => {
    await expect(
      insertDevice({ profileId: tillProfileId, stationId: null, tillId, label: "Till ok" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a kds-profile device with a NULL station", async () => {
    const error = await captureError(() =>
      insertDevice({ profileId: kdsProfileId, stationId: null, tillId: null, label: "KDS bad" }),
    );
    expect(pgErrorMessage(error)).toMatch(/kds device binds a station/);
  });

  it("rejects a till-profile device with a NULL register", async () => {
    const error = await captureError(() =>
      insertDevice({ profileId: tillProfileId, stationId: null, tillId: null, label: "Till bad" }),
    );
    expect(pgErrorMessage(error)).toMatch(/binds a register and no station/);
  });

  it("rejects a kds-profile device that also names a register", async () => {
    const error = await captureError(() =>
      insertDevice({ profileId: kdsProfileId, stationId, tillId, label: "KDS with till" }),
    );
    expect(pgErrorMessage(error)).toMatch(/kds device binds a station/);
  });

  it("rejects a register (non-kds) device that also names a station", async () => {
    // The symmetric ELSE-branch case: a till-profile device that names a valid register AND a stray
    // station. This exercises the `station_id IS NOT NULL` disjunct of the ELSE branch, which the
    // NULL-register case above cannot reach.
    const error = await captureError(() =>
      insertDevice({ profileId: tillProfileId, stationId, tillId, label: "Till with station" }),
    );
    expect(pgErrorMessage(error)).toMatch(/binds a register and no station/);
  });

  it("a binding-changing UPDATE is still enforced (the WHEN did not disable it)", async () => {
    // Seed a valid till device, then UPDATE it into a bad state (add a stray station). The update
    // trigger's WHEN sees station_id change, fires, and the ELSE branch rejects — proving the WHEN
    // gate narrows WHEN the trigger runs, not WHETHER it enforces.
    await insertDevice({
      profileId: tillProfileId,
      stationId: null,
      tillId,
      label: "Till to break",
    });
    const error = await captureError(() =>
      admin.execute(
        sql`update devices set station_id = ${stationId} where label = 'Till to break'`,
      ),
    );
    expect(pgErrorMessage(error)).toMatch(/binds a register and no station/);
  });

  it("reactivation re-validates the binding: the WHEN watches active false→true (BUG D)", async () => {
    // A device deactivated, its profile then changed to an incompatible form factor (permitted WHILE the
    // device is inactive — the drift guard blocks only ACTIVE devices), must be re-validated when it is
    // switched back on. Without the `active false→true` disjunct in the update trigger's WHEN, the
    // trigger never re-runs on an active-only change and the invalid binding lands.
    const profile = (
      await admin.execute<{ id: string }>(sql`
        insert into device_profiles (tenant_id, name, form_factor)
        values (${tenantId}, 'Reactivate till', 'till') returning id`)
    ).rows[0]!.id;
    // A valid till device (register, no station) on that profile, then deactivated.
    await insertDevice({ profileId: profile, stationId: null, tillId, label: "Reactivate me" });
    await admin.execute(sql`update devices set active = false where label = 'Reactivate me'`);
    // Flip the profile to kds — allowed because the referencing device is now inactive.
    await admin.execute(sql`update device_profiles set form_factor = 'kds' where id = ${profile}`);
    // Reactivating must now be REJECTED: the profile is kds but the device binds a register and no
    // station. Before the WHEN fix this active-only UPDATE slipped through and left the bad binding.
    const error = await captureError(() =>
      admin.execute(sql`update devices set active = true where label = 'Reactivate me'`),
    );
    expect(pgErrorMessage(error)).toMatch(/kds device binds a station/);
  });

  it("a non-binding UPDATE (last_seen_at touch) does not fire the trigger", async () => {
    // requireDevice touches last_seen_at on every authenticated request. That UPDATE changes no
    // binding column, so the update trigger's WHEN is false and the device_profiles lookup never
    // runs — the performance point of the two-trigger split. It must succeed.
    await insertDevice({
      profileId: tillProfileId,
      stationId: null,
      tillId,
      label: "Till heartbeat",
    });
    await expect(
      admin.execute(sql`update devices set last_seen_at = now() where label = 'Till heartbeat'`),
    ).resolves.toBeDefined();
  });

  // Prove by deletion (CLAUDE.md §1/§4): with the trigger dropped, the insert the trigger rejects
  // above now SUCCEEDS — so the trigger is provably what enforces the rule, not an FK or CHECK. Done
  // inside a transaction that ROLLBACKs, so the drop (and the bad row) never outlive this test and the
  // suite stays order-independent.
  it("prove-by-deletion: dropping the trigger lets the bad insert succeed", async () => {
    const sentinel = new Error("rollback sentinel");
    const outcome = await captureError(() =>
      admin.transaction(async (tx) => {
        await tx.execute(sql`drop trigger device_binding_rule_insert on devices`);
        // The exact insert the "rejects a kds-profile device with a NULL station" case refuses.
        await tx.execute(sql`
          insert into devices (tenant_id, location_id, device_profile_id, station_id, till_id, label, token_hash)
          values (${tenantId}, ${locationId}, ${kdsProfileId}, ${null}, ${null}, 'KDS no-trigger', ${TOKEN_HASH})`);
        const { rows } = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from devices where label = 'KDS no-trigger'`,
        );
        expect(rows[0]!.n).toBe(1);
        throw sentinel; // roll the drop + the bad row back
      }),
    );
    expect(outcome).toBe(sentinel);
  });
});
