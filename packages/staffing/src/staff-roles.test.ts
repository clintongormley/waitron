import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, venueLocationId, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS, shifts } from "@waitron/workforce";
import { persons } from "@waitron/identity";
import { createLabelComparator } from "@waitron/shared";
import { seedVenue } from "../test/seed.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import {
  personStaffRoles,
  shiftAssignments,
  staffingBlocks,
  staffingDays,
  staffRoles,
} from "./schema/staffing.js";
import {
  createStaffRole,
  deleteStaffRole,
  listStaffRoles,
  listStaffRolesWithHolderNames,
  readStaffRoleDeleteImpact,
  reorderStaffRoles,
  setStaffRoleHolders,
  staffRolesNamed,
  updateStaffRole,
} from "./staff-roles.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    WORKFORCE_MIGRATIONS,
    STAFFING_MIGRATIONS,
  ],
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

type Venue = Awaited<ReturnType<typeof seedVenue>>;

/** One painted block for `staffRoleId` on the venue's department, on `weekday` of its season. */
async function paintBlock(v: Venue, staffRoleId: string, weekday = 1) {
  await inTx(async (tx) => {
    const [day] = await tx
      .insert(staffingDays)
      .values({ departmentId: v.departmentId, seasonId: v.seasonId, weekday })
      .returning({ id: staffingDays.id });
    await tx.insert(staffingBlocks).values({
      dayId: day!.id,
      staffRoleId,
      headcount: 2,
      startsAt: "12:00:00",
      endsAt: "16:00:00",
    });
  });
}

/** A shift for `personId` that fills `staffRoleId` in the venue's department. */
async function assignShift(v: Venue, personId: string, staffRoleId: string) {
  await inTx(async (tx) => {
    const [shift] = await tx
      .insert(shifts)
      .values({
        personId,
        locationId: v.cfg.locationId,
        startsAt: "2026-10-14T08:00:00Z",
        startsOffsetMinutes: 120,
        endsAt: "2026-10-14T16:00:00Z",
        endsOffsetMinutes: 120,
      })
      .returning({ id: shifts.id });
    await tx
      .insert(shiftAssignments)
      .values({ shiftId: shift!.id, departmentId: v.departmentId, staffRoleId });
  });
}

describe("staff roles", () => {
  it("creates and lists in position order with each role's holders", async () => {
    const v = await seedVenue(suite.db);
    const chef = await inTx((tx) => createStaffRole(tx, { name: "Head chef", colour: "purple" }));
    const sous = await inTx((tx) => createStaffRole(tx, { name: "  Sous chef ", colour: "green" }));
    expect(chef).toEqual({
      id: chef.id,
      name: "Head chef",
      colour: "purple",
      position: 0,
      holderIds: [],
    });
    expect(sous).toMatchObject({ name: "Sous chef", position: 1 });
    const held = await inTx((tx) => setStaffRoleHolders(tx, sous.id, [v.ana, v.marc]));
    expect(held.holderIds).toEqual([v.ana, v.marc].sort());
    const listed = await inTx((tx) => listStaffRoles(tx));
    expect(listed.map((r) => r.name)).toEqual(["Head chef", "Sous chef"]);
    expect(listed).toEqual([{ ...chef }, { ...sous, holderIds: [v.ana, v.marc].sort() }]);
  });

  it("counts only the role's own painted blocks and shifts in a delete's impact", async () => {
    const v = await seedVenue(suite.db);
    const chef = await inTx((tx) => createStaffRole(tx, { name: "Head chef", colour: "purple" }));
    const sous = await inTx((tx) => createStaffRole(tx, { name: "Sous chef", colour: "green" }));
    await paintBlock(v, chef.id, 1);
    await paintBlock(v, chef.id, 2);
    await assignShift(v, v.ana, chef.id);
    const chefImpact = await inTx((tx) => readStaffRoleDeleteImpact(tx, chef.id));
    expect(chefImpact.refusals).toEqual([
      { code: "staff_role.in_use", params: { staffRoleId: chef.id, shiftCount: 1 }, targets: [] },
    ]);
    expect(chefImpact.removes).toEqual([{ key: "staff_role_blocks", count: 2, targets: [] }]);
    const sousImpact = await inTx((tx) => readStaffRoleDeleteImpact(tx, sous.id));
    expect(sousImpact).toMatchObject({ refusals: [], removes: [] });
  });

  it("lists the venue's roles", async () => {
    await seedVenue(suite.db);
    const waiter = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    expect(await inTx((tx) => listStaffRoles(tx))).toEqual([waiter]);
  });

  it("refuses a duplicate name as staff_role.name_taken", async () => {
    await seedVenue(suite.db);
    await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    await expect(
      inTx((tx) => createStaffRole(tx, { name: " Waiter ", colour: "red" })),
    ).rejects.toMatchObject({ code: "staff_role.name_taken", params: { name: "Waiter" } });
  });

  it("plans the name check on the location and name index, not a scan", async () => {
    await seedVenue(suite.db);
    for (const except of [null, randomUUID()]) {
      const plan = await inTx(async (tx) => {
        const emitted = staffRolesNamed(tx, await venueLocationId(tx), "Waiter", except).toSQL();
        const parts = emitted.sql.split("?");
        const statement = sql.raw(`explain query plan ${parts[0]}`);
        emitted.params.forEach((param, i) => {
          statement.append(sql`${param}`);
          statement.append(sql.raw(parts[i + 1]!));
        });
        return tx.execute<{ detail: string }>(statement);
      });
      const details = plan.rows.map((row) => row.detail);
      expect(details.some((d) => d.includes("USING INDEX staff_roles_location_name_key"))).toBe(
        true,
      );
      expect(details.some((d) => d.includes("SCAN staff_roles"))).toBe(false);
    }
  });

  it("refuses a blank name and an unknown colour as staffing.invalid", async () => {
    await seedVenue(suite.db);
    await expect(
      inTx((tx) => createStaffRole(tx, { name: "   ", colour: "blue" })),
    ).rejects.toMatchObject({ code: "staffing.invalid", params: { field: "name" } });
    await expect(
      inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "beige" as "blue" })),
    ).rejects.toMatchObject({ code: "staffing.invalid", params: { field: "colour" } });
    const staffRole = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    await expect(
      inTx((tx) => updateStaffRole(tx, staffRole.id, { name: "", colour: "blue" })),
    ).rejects.toMatchObject({ code: "staffing.invalid", params: { field: "name" } });
  });

  it("saves a role in a newer calendar colour and reads it back", async () => {
    await seedVenue(suite.db);
    const created = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "teal" }));
    expect(created.colour).toBe("teal");
    expect(
      (await inTx((tx) => listStaffRoles(tx))).map(({ name, colour }) => [name, colour]),
    ).toEqual([["Waiter", "teal"]]);
    await inTx((tx) => updateStaffRole(tx, created.id, { name: "Waiter", colour: "pink" }));
    expect(
      (await inTx((tx) => listStaffRoles(tx))).map(({ name, colour }) => [name, colour]),
    ).toEqual([["Waiter", "pink"]]);
    await inTx((tx) => updateStaffRole(tx, created.id, { name: "Waiter", colour: "yellow" }));
    expect(
      (await inTx((tx) => listStaffRoles(tx))).map(({ name, colour }) => [name, colour]),
    ).toEqual([["Waiter", "yellow"]]);
  });

  it("updates a role's name and colour, keeping its own name free to itself", async () => {
    const v = await seedVenue(suite.db);
    const waiter = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    await inTx((tx) => createStaffRole(tx, { name: "Runner", colour: "red" }));
    await inTx((tx) => setStaffRoleHolders(tx, waiter.id, [v.ana]));
    const same = await inTx((tx) =>
      updateStaffRole(tx, waiter.id, { name: "Waiter", colour: "amber" }),
    );
    expect(same).toMatchObject({
      name: "Waiter",
      colour: "amber",
      position: 0,
      holderIds: [v.ana],
    });
    const renamed = await inTx((tx) =>
      updateStaffRole(tx, waiter.id, { name: " Head waiter ", colour: "amber" }),
    );
    expect(renamed.name).toBe("Head waiter");
    await expect(
      inTx((tx) => updateStaffRole(tx, waiter.id, { name: "Runner", colour: "amber" })),
    ).rejects.toMatchObject({ code: "staff_role.name_taken", params: { name: "Runner" } });
  });

  it("answers staff_role.not_found for an unknown id", async () => {
    const v = await seedVenue(suite.db);
    await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    for (const staffRoleId of [randomUUID()]) {
      const notFound = { code: "staff_role.not_found", params: { staffRoleId } };
      await expect(
        inTx((tx) => updateStaffRole(tx, staffRoleId, { name: "X", colour: "blue" })),
      ).rejects.toMatchObject(notFound);
      await expect(
        inTx((tx) => setStaffRoleHolders(tx, staffRoleId, [v.ana])),
      ).rejects.toMatchObject(notFound);
      await expect(inTx((tx) => deleteStaffRole(tx, staffRoleId))).rejects.toMatchObject(notFound);
    }
    expect(await inTx((tx) => listStaffRoles(tx))).toHaveLength(1);
  });

  it("replaces the holder set, de-duplicating repeated ids", async () => {
    const v = await seedVenue(suite.db);
    const staffRole = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    await inTx((tx) => setStaffRoleHolders(tx, staffRole.id, [v.ana, v.marc]));
    const replaced = await inTx((tx) => setStaffRoleHolders(tx, staffRole.id, [v.marc, v.marc]));
    expect(replaced.holderIds).toEqual([v.marc]);
    const emptied = await inTx((tx) => setStaffRoleHolders(tx, staffRole.id, []));
    expect(emptied.holderIds).toEqual([]);
  });

  it("refuses holders that are not persons as staffing.invalid {field: personIds}", async () => {
    const v = await seedVenue(suite.db);
    const staffRole = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    await inTx((tx) => setStaffRoleHolders(tx, staffRole.id, [v.ana]));
    await expect(
      inTx((tx) => setStaffRoleHolders(tx, staffRole.id, [v.marc, randomUUID()])),
    ).rejects.toMatchObject({ code: "staffing.invalid", params: { field: "personIds" } });
    const [kept] = await inTx((tx) => listStaffRoles(tx));
    expect(kept!.holderIds).toEqual([v.ana]);
  });

  it("deleting a staff role deletes its blocks and holders", async () => {
    const v = await seedVenue(suite.db);
    const staffRole = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    const kept = await inTx((tx) => createStaffRole(tx, { name: "Cook", colour: "red" }));
    await inTx((tx) => setStaffRoleHolders(tx, staffRole.id, [v.ana]));
    await inTx((tx) => setStaffRoleHolders(tx, kept.id, [v.ana]));
    await paintBlock(v, staffRole.id);
    const impact = await inTx((tx) => readStaffRoleDeleteImpact(tx, staffRole.id));
    expect(impact.removes.map(({ key, count }) => [key, count])).toEqual([
      ["staff_role_blocks", 1],
      ["staff_role_holders", 1],
    ]);
    expect(await inTx((tx) => deleteStaffRole(tx, staffRole.id))).toEqual(impact);
    expect((await inTx((tx) => listStaffRoles(tx))).map((r) => r.id)).toEqual([kept.id]);
    expect(
      await suite.db
        .select()
        .from(staffingBlocks)
        .where(eq(staffingBlocks.staffRoleId, staffRole.id)),
    ).toEqual([]);
    expect(
      await suite.db
        .select()
        .from(personStaffRoles)
        .where(eq(personStaffRoles.staffRoleId, staffRole.id)),
    ).toEqual([]);
  });

  it("refuses to delete a staff role a shift uses as staff_role.in_use with the shift count", async () => {
    const v = await seedVenue(suite.db);
    const staffRole = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    await assignShift(v, v.ana, staffRole.id);
    await assignShift(v, v.marc, staffRole.id);
    await expect(inTx((tx) => deleteStaffRole(tx, staffRole.id))).rejects.toMatchObject({
      code: "staff_role.in_use",
      params: { staffRoleId: staffRole.id, shiftCount: 2 },
    });
    expect(
      await suite.db
        .select({ id: staffRoles.id })
        .from(staffRoles)
        .where(eq(staffRoles.id, staffRole.id)),
    ).toEqual([{ id: staffRole.id }]);
  });

  it("reads what deleting a staff role would remove: its painted blocks and who holds it", async () => {
    const v = await seedVenue(suite.db);
    const staffRole = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    expect(await inTx((tx) => readStaffRoleDeleteImpact(tx, staffRole.id))).toEqual({
      target: { id: staffRole.id, name: "Waiter" },
      refusals: [],
      ends: [],
      removes: [],
    });
    await inTx((tx) => setStaffRoleHolders(tx, staffRole.id, [v.marc, v.ana]));
    await paintBlock(v, staffRole.id, 1);
    await paintBlock(v, staffRole.id, 2);
    const name = async (id: string) =>
      (await suite.db.select().from(persons).where(eq(persons.id, id)))[0]!.displayName;
    expect(await inTx((tx) => readStaffRoleDeleteImpact(tx, staffRole.id))).toEqual({
      target: { id: staffRole.id, name: "Waiter" },
      refusals: [],
      ends: [],
      removes: [
        { key: "staff_role_blocks", count: 2, targets: [] },
        {
          key: "staff_role_holders",
          count: 2,
          targets: [
            { id: v.ana, name: await name(v.ana) },
            { id: v.marc, name: await name(v.marc) },
          ],
        },
      ],
    });
  });

  it("reads a staff role that shifts use as refused, with the shift count", async () => {
    const v = await seedVenue(suite.db);
    const staffRole = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    await assignShift(v, v.ana, staffRole.id);
    await assignShift(v, v.marc, staffRole.id);
    const impact = await inTx((tx) => readStaffRoleDeleteImpact(tx, staffRole.id));
    expect(impact.refusals).toEqual([
      {
        code: "staff_role.in_use",
        params: { staffRoleId: staffRole.id, shiftCount: 2 },
        targets: [],
      },
    ]);
  });

  it("reads no delete impact for an unknown id", async () => {
    await seedVenue(suite.db);
    for (const staffRoleId of [randomUUID()])
      await expect(inTx((tx) => readStaffRoleDeleteImpact(tx, staffRoleId))).rejects.toMatchObject({
        code: "staff_role.not_found",
        params: { staffRoleId },
      });
  });

  it("reorders by the given ids and refuses a list that is not exactly the venue's roles", async () => {
    await seedVenue(suite.db);
    const make = (name: string) => inTx((tx) => createStaffRole(tx, { name, colour: "grey" }));
    const a = await make("A");
    const b = await make("B");
    const c = await make("C");
    const unknown = randomUUID();
    await inTx((tx) => reorderStaffRoles(tx, [c.id, a.id, b.id]));
    const listed = await inTx((tx) => listStaffRoles(tx));
    expect(listed.map((r) => [r.name, r.position])).toEqual([
      ["C", 0],
      ["A", 1],
      ["B", 2],
    ]);
    await inTx((tx) => reorderStaffRoles(tx, [c.id, b.id, a.id]));
    expect((await inTx((tx) => listStaffRoles(tx))).map((r) => r.name)).toEqual(["C", "B", "A"]);
    await expect(inTx((tx) => reorderStaffRoles(tx, [c.id, a.id, unknown]))).rejects.toMatchObject({
      code: "staff_role.not_found",
      params: { staffRoleId: unknown },
    });
    for (const ids of [
      [c.id, a.id],
      [c.id, a.id, a.id],
      [c.id, a.id, b.id, b.id],
    ])
      await expect(inTx((tx) => reorderStaffRoles(tx, ids))).rejects.toMatchObject({
        code: "staffing.invalid",
        params: { field: "staffRoleIds" },
      });
    // A new role still goes last after a reorder.
    expect(await make("E")).toMatchObject({ position: 3 });
  });

  it("names every holder of each role in label order", async () => {
    await seedVenue(suite.db);
    const person = (
      displayName: string,
      status: "active" | "pending" | "suspended" = "active",
      id: string = randomUUID(),
    ) =>
      inTx(async (tx) => {
        const [row] = await tx
          .insert(persons)
          .values({ id, displayName, role: "staff", status })
          .returning({ id: persons.id });
        return row!.id;
      });
    const marc = await person("Marc");
    const alvaro = await person("Álvaro", "suspended");
    const ana = await person("ana", "pending");
    // The comparator ignores case, so the three Paus tie and only the person id orders them.
    // Here the engine scans person_staff_roles in write order (its query plan printed SCAN psr),
    // so the higher ids are written first and that order cannot pass for id order.
    const [lowId, midId, highId] = [randomUUID(), randomUUID(), randomUUID()].sort();
    const twinA = await person("Pau", "active", highId);
    const twinB = await person("pau", "suspended", lowId);
    const twinC = await person("Pau", "suspended", midId);
    const sous = await inTx((tx) => createStaffRole(tx, { name: "Sous chef", colour: "green" }));
    const head = await inTx((tx) => createStaffRole(tx, { name: "Head chef", colour: "purple" }));
    const waiter = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }));
    await inTx((tx) => setStaffRoleHolders(tx, sous.id, [marc, alvaro, ana]));
    await inTx((tx) => setStaffRoleHolders(tx, waiter.id, [twinA, ana, twinC, twinB]));

    const listed = await inTx((tx) => listStaffRolesWithHolderNames(tx));
    const plain = await inTx((tx) => listStaffRoles(tx));
    const compare = createLabelComparator();
    const sousNames = ["Marc", "Álvaro", "ana"].sort(compare);
    expect(compare("Pau", "pau")).toBe(0);
    expect(twinB < twinC && twinC < twinA).toBe(true);
    const waiterNames = ["ana", "pau", "Pau", "Pau"];
    expect(listed).toEqual([
      { ...plain[0]!, holderNames: sousNames },
      { ...plain[1]!, holderNames: [] },
      { ...plain[2]!, holderNames: waiterNames },
    ]);
    expect(plain.map((r) => r.id)).toEqual([sous.id, head.id, waiter.id]);
  });
});
