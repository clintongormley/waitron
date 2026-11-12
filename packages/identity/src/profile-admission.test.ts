import { seedPersons, type PersonSeed } from "../test/person-rows.js";
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  staffRoles,
  personStaffRoles,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  canUseDeviceProfile,
  listStaffAdmittedTo,
  profilesAdmitting,
  readProfileAdmissions,
  setProfileAdmission,
} from "./profile-admission.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const run = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, fn);
async function profile() {
  const [row] = await seedDeviceProfiles(suite.db, {
    name: crypto.randomUUID(),
    formFactor: "till",
    capabilities: [],
    admitted: [],
  });
  return row!.id;
}
async function job(name = crypto.randomUUID()) {
  const [row] = await suite.db.insert(staffRoles).values({ name }).returning();
  return row!.id;
}
async function person(jobRoles: string[], extra: Partial<PersonSeed> = {}) {
  const [row] = await seedPersons(suite.db, {
    displayName: crypto.randomUUID(),
    jobRoles,
    ...extra,
  });
  return row!.id;
}
const save = (id: string, ids: string[]) =>
  run((tx) => setProfileAdmission(tx, id, { admittedStaffRoleIds: ids }));
const admits = (id: string, personId: string) => run((tx) => canUseDeviceProfile(tx, id, personId));

describe("job-role admission", () => {
  it("admits an active holder of a ticked job role and follows membership changes", async () => {
    const id = await profile();
    const waiter = await job();
    const chef = await job();
    const holder = await person([chef, waiter]);
    const other = await person([chef]);
    await save(id, [waiter]);
    expect(await admits(id, holder)).toBe(true);
    expect(await admits(id, other)).toBe(false);
    await suite.db.delete(personStaffRoles).where(eq(personStaffRoles.staffRoleId, waiter));
    expect(await admits(id, holder)).toBe(false);
  });

  it("admits nobody when no job role is ticked, including Admin with no job role", async () => {
    const id = await profile();
    const holder = await person([await job()]);
    const admin = await person([], { role: "admin" });
    expect(await admits(id, holder)).toBe(false);
    expect(await admits(id, admin)).toBe(false);
    await save(id, [await job()]);
    expect(await admits(id, admin)).toBe(false);
  });

  it("never admits suspended, pending or missing people, or a missing profile", async () => {
    const id = await profile();
    const role = await job();
    await save(id, [role]);
    for (const status of ["suspended", "pending"] as const)
      expect(await admits(id, await person([role], { status }))).toBe(false);
    expect(await admits(id, crypto.randomUUID())).toBe(false);
    expect(await admits(crypto.randomUUID(), await person([role]))).toBe(false);
    expect(await admits(id, await person([role]))).toBe(true);
  });

  it("a hidden job role admits nobody even if its admission row remains", async () => {
    const id = await profile();
    const role = await job();
    const holder = await person([role]);
    await save(id, [role]);
    await suite.db
      .update(staffRoles)
      .set({ hiddenAt: "2026-11-13T00:00:00Z" })
      .where(eq(staffRoles.id, role));
    expect(await admits(id, holder)).toBe(false);
    expect(await run((tx) => listStaffAdmittedTo(tx, id))).toEqual([]);
    expect(await run((tx) => profilesAdmitting(tx, holder, [id]))).toEqual([]);
  });

  it("lists active holders once, by name, as id and name only", async () => {
    const id = await profile();
    const first = await job();
    const second = await job();
    const zara = await person([first], { displayName: "Zara" });
    const ana = await person([second, first], { displayName: "Ana" });
    await person([second], { displayName: "Bea", status: "suspended" });
    await person([], { displayName: "Carl" });
    await save(id, [first, second]);
    expect(await run((tx) => listStaffAdmittedTo(tx, id))).toEqual([
      { personId: ana, displayName: "Ana" },
      { personId: zara, displayName: "Zara" },
    ]);
    expect(await run((tx) => listStaffAdmittedTo(tx, crypto.randomUUID()))).toEqual([]);
  });

  it("filters profiles in the caller's order using the person's job roles", async () => {
    const first = await profile();
    const second = await profile();
    const empty = await profile();
    const role = await job();
    const holder = await person([role]);
    await save(first, [role]);
    await save(second, [role]);
    expect(
      await run((tx) => profilesAdmitting(tx, holder, [second, empty, crypto.randomUUID(), first])),
    ).toEqual([second, first]);
    expect(await run((tx) => profilesAdmitting(tx, holder, []))).toEqual([]);
    expect(await run((tx) => profilesAdmitting(tx, crypto.randomUUID(), [first]))).toEqual([]);
  });

  it("reads and replaces explicit selections, permits empty, and keeps omitted selections", async () => {
    const first = await profile();
    const empty = await profile();
    const role = await job();
    await save(first, [role]);
    await run((tx) => setProfileAdmission(tx, first, {}));
    expect(await run((tx) => readProfileAdmissions(tx, [empty, first]))).toEqual([
      { profileId: empty, admittedStaffRoleIds: [] },
      { profileId: first, admittedStaffRoleIds: [role] },
    ]);
    await save(first, []);
    expect(await run((tx) => readProfileAdmissions(tx, [first]))).toEqual([
      { profileId: first, admittedStaffRoleIds: [] },
    ]);
    expect(await run((tx) => readProfileAdmissions(tx, []))).toEqual([]);
  });

  it("refuses missing or hidden roles before replacing the saved selection", async () => {
    const id = await profile();
    const kept = await job();
    const hidden = await job();
    await suite.db
      .update(staffRoles)
      .set({ hiddenAt: "2026-11-13T00:00:00Z" })
      .where(eq(staffRoles.id, hidden));
    await save(id, [kept]);
    for (const staffRoleId of [crypto.randomUUID(), hidden]) {
      await expect(save(id, [staffRoleId])).rejects.toMatchObject({
        code: "device_profile.admission_invalid",
        params: { field: "admittedStaffRoleIds", reason: "not_found", staffRoleId },
      });
      expect(await run((tx) => readProfileAdmissions(tx, [id]))).toEqual([
        { profileId: id, admittedStaffRoleIds: [kept] },
      ]);
    }
  });

  it("removes admission rows with their profile or job role", async () => {
    const first = await profile();
    const kept = await profile();
    const removed = await job();
    const role = await job();
    await save(first, [role]);
    await save(kept, [removed, role]);
    await suite.db.delete(deviceProfiles).where(eq(deviceProfiles.id, first));
    await suite.db.delete(staffRoles).where(eq(staffRoles.id, removed));
    expect(await run((tx) => readProfileAdmissions(tx, [first, kept]))).toEqual([
      { profileId: first, admittedStaffRoleIds: [] },
      { profileId: kept, admittedStaffRoleIds: [role] },
    ]);
  });
});
