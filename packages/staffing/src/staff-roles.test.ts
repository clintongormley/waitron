import { activityLog, personStaffRoles, staffRoles } from "@waitron/db";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  WORKFORCE_MIGRATIONS,
  shiftAssignments,
  shifts,
  staffingBlocks,
  staffingDays,
} from "@waitron/workforce";
import { createLabelComparator } from "@waitron/shared";
import { seedVenueWithStaff } from "../test/seed.js";
import {
  createStaffRole,
  deleteStaffRole,
  listStaffRoles,
  listStaffRolesWithHolderNames,
  reorderStaffRoles,
  setStaffRoleHolders,
  setPersonStaffRoles,
  staffRolesNamed,
  updateStaffRole,
} from "./staff-roles.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);

type Venue = Awaited<ReturnType<typeof seedVenueWithStaff>>;

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
  it("logs lifecycle and each holder change by id, but no-op saves log nothing", async () => {
    const v = await seedVenueWithStaff(suite.db);
    const actor = { personId: v.ana };
    const role = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }, actor));
    await inTx((tx) => updateStaffRole(tx, role.id, { name: "Runner", colour: "red" }, actor));
    await inTx((tx) => setStaffRoleHolders(tx, role.id, [v.ana, v.marc], actor));
    const before = await suite.db.select().from(activityLog);
    await inTx((tx) => setStaffRoleHolders(tx, role.id, [v.marc, v.ana], actor));
    await inTx((tx) => updateStaffRole(tx, role.id, { name: "Runner", colour: "red" }, actor));
    expect(await suite.db.select().from(activityLog)).toEqual(before);
    await inTx((tx) => setStaffRoleHolders(tx, role.id, [v.marc], actor));
    await inTx((tx) => deleteStaffRole(tx, role.id, actor));
    const logs = await suite.db.select().from(activityLog);
    expect(
      logs.map(({ kind, subjectKind, subjectId, personId, data }) => ({
        kind,
        subjectKind,
        subjectId,
        personId,
        data,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "job_role.created",
          subjectKind: "job_role",
          subjectId: role.id,
          personId: v.ana,
          data: { name: "Waiter" },
        },
        {
          kind: "job_role.renamed",
          subjectKind: "job_role",
          subjectId: role.id,
          personId: v.ana,
          data: { from: "Waiter", to: "Runner" },
        },
        ...[v.ana, v.marc].flatMap((subjectId) =>
          ["job_role.member_added", "job_role.member_removed"].map((kind) => ({
            kind,
            subjectKind: "person",
            subjectId,
            personId: v.ana,
            data: { staffRoleId: role.id, name: "Runner" },
          })),
        ),
        {
          kind: "job_role.deleted",
          subjectKind: "job_role",
          subjectId: role.id,
          personId: v.ana,
          data: { name: "Runner" },
        },
      ]),
    );
    expect(logs.filter((l) => l.kind.startsWith("job_role."))).toHaveLength(7);
  });

  it("hiding a role logs a removal for each of its three holders", async () => {
    const v = await seedVenueWithStaff(suite.db);
    const [third] = await inTx((tx) =>
      seedPersons(tx, { jobRoles: [], displayName: "Alex", role: "staff" }),
    );
    const actor = { personId: v.ana };
    const role = await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }, actor));
    const holders = [v.ana, v.marc, third!.id];
    await inTx((tx) => setStaffRoleHolders(tx, role.id, holders, actor));
    await assignShift(v, v.ana, role.id);
    await inTx((tx) => deleteStaffRole(tx, role.id, actor));
    const logs = await suite.db.select().from(activityLog);
    expect(
      logs
        .filter((l) => l.kind === "job_role.member_removed")
        .map((l) => l.subjectId)
        .sort(),
    ).toEqual(holders.sort());
    expect(logs.find((l) => l.kind === "job_role.hidden")).toMatchObject({
      personId: v.ana,
      subjectId: role.id,
      data: { name: "Waiter" },
    });
    const ordered = await suite.db.execute<{ kind: string }>(
      sql`select kind from activity_log where kind like 'job_role.%' order by rowid`,
    );
    expect(ordered.rows.map((row) => row.kind).slice(-4)).toEqual([
      "job_role.member_removed",
      "job_role.member_removed",
      "job_role.member_removed",
      "job_role.hidden",
    ]);
  });

  it("refuses stale per-person saves and treats reordered sets as no change", async () => {
    const v = await seedVenueWithStaff(suite.db);
    const a = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }),
    );
    const b = await inTx((tx) =>
      createStaffRole(tx, { name: "Cook", colour: "red" }, { personId: null }),
    );
    const save = (staffRoleIds: string[], expectedStaffRoleIds: string[]) =>
      inTx((tx) =>
        setPersonStaffRoles(tx, {
          personId: v.marc,
          staffRoleIds,
          expectedStaffRoleIds,
          actorId: v.ana,
        }),
      );
    expect(await save([a.id, b.id], [])).toEqual([a.id, b.id].sort());
    const before = await suite.db.select().from(activityLog);
    expect(await save([b.id, a.id], [b.id, a.id])).toEqual([a.id, b.id].sort());
    expect(await suite.db.select().from(activityLog)).toEqual(before);
    await expect(save([], [])).rejects.toMatchObject({
      code: "person.job_roles_changed",
      params: {},
    });
    await expect(save([randomUUID()], [a.id, b.id])).rejects.toMatchObject({
      code: "staff_role.not_found",
    });
    expect(await save([b.id], [a.id, b.id])).toEqual([b.id]);
    expect(
      (await suite.db.select().from(activityLog)).filter(
        (l) => l.kind === "job_role.member_removed",
      ),
    ).toEqual([
      expect.objectContaining({
        subjectId: v.marc,
        personId: v.ana,
        data: { staffRoleId: a.id, name: "Waiter" },
      }),
    ]);
    await expect(
      inTx((tx) =>
        setPersonStaffRoles(tx, {
          personId: randomUUID(),
          staffRoleIds: [],
          expectedStaffRoleIds: [],
          actorId: v.ana,
        }),
      ),
    ).rejects.toMatchObject({ code: "person.not_found" });
  });

  it("creates and lists in position order with each role's holders", async () => {
    const v = await seedVenueWithStaff(suite.db);
    const chef = await inTx((tx) =>
      createStaffRole(tx, { name: "Head chef", colour: "purple" }, { personId: null }),
    );
    const sous = await inTx((tx) =>
      createStaffRole(tx, { name: "  Sous chef ", colour: "green" }, { personId: null }),
    );
    expect(chef).toEqual({
      id: chef.id,
      name: "Head chef",
      colour: "purple",
      position: 0,
      holderIds: [],
    });
    expect(sous).toMatchObject({ name: "Sous chef", position: 1 });
    const held = await inTx((tx) =>
      setStaffRoleHolders(tx, sous.id, [v.ana, v.marc], { personId: null }),
    );
    expect(held.holderIds).toEqual([v.ana, v.marc].sort());
    const listed = await inTx((tx) => listStaffRoles(tx));
    expect(listed.map((r) => r.name)).toEqual(["Head chef", "Sous chef"]);
    expect(listed).toEqual([{ ...chef }, { ...sous, holderIds: [v.ana, v.marc].sort() }]);
  });

  it("lists the venue's roles", async () => {
    await seedVenueWithStaff(suite.db);
    const waiter = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }),
    );
    expect(await inTx((tx) => listStaffRoles(tx))).toEqual([waiter]);
  });

  it("refuses a duplicate name as staff_role.name_taken", async () => {
    await seedVenueWithStaff(suite.db);
    await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }));
    await expect(
      inTx((tx) => createStaffRole(tx, { name: " Waiter ", colour: "red" }, { personId: null })),
    ).rejects.toMatchObject({ code: "staff_role.name_taken", params: { name: "Waiter" } });
  });

  it("plans the name check on the name index, not a scan", async () => {
    await seedVenueWithStaff(suite.db);
    for (const except of [null, randomUUID()]) {
      const plan = await inTx(async (tx) => {
        const emitted = staffRolesNamed(tx, "Waiter", except).toSQL();
        const parts = emitted.sql.split("?");
        const statement = sql.raw(`explain query plan ${parts[0]}`);
        emitted.params.forEach((param, i) => {
          statement.append(sql`${param}`);
          statement.append(sql.raw(parts[i + 1]!));
        });
        return tx.execute<{ detail: string }>(statement);
      });
      const details = plan.rows.map((row) => row.detail);
      expect(details.some((d) => d.includes("USING INDEX staff_roles_name_key"))).toBe(true);
      expect(details.some((d) => d.includes("SCAN staff_roles"))).toBe(false);
    }
  });

  it("refuses a blank name and an unknown colour as staffing.invalid", async () => {
    await seedVenueWithStaff(suite.db);
    await expect(
      inTx((tx) => createStaffRole(tx, { name: "   ", colour: "blue" }, { personId: null })),
    ).rejects.toMatchObject({ code: "staffing.invalid", params: { field: "name" } });
    await expect(
      inTx((tx) =>
        createStaffRole(tx, { name: "Waiter", colour: "beige" as "blue" }, { personId: null }),
      ),
    ).rejects.toMatchObject({ code: "staffing.invalid", params: { field: "colour" } });
    const staffRole = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }),
    );
    await expect(
      inTx((tx) =>
        updateStaffRole(tx, staffRole.id, { name: "", colour: "blue" }, { personId: null }),
      ),
    ).rejects.toMatchObject({ code: "staffing.invalid", params: { field: "name" } });
  });

  it("saves a role in a newer calendar colour and reads it back", async () => {
    await seedVenueWithStaff(suite.db);
    const created = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "teal" }, { personId: null }),
    );
    expect(created.colour).toBe("teal");
    expect(
      (await inTx((tx) => listStaffRoles(tx))).map(({ name, colour }) => [name, colour]),
    ).toEqual([["Waiter", "teal"]]);
    await inTx((tx) =>
      updateStaffRole(tx, created.id, { name: "Waiter", colour: "pink" }, { personId: null }),
    );
    expect(
      (await inTx((tx) => listStaffRoles(tx))).map(({ name, colour }) => [name, colour]),
    ).toEqual([["Waiter", "pink"]]);
    await inTx((tx) =>
      updateStaffRole(tx, created.id, { name: "Waiter", colour: "yellow" }, { personId: null }),
    );
    expect(
      (await inTx((tx) => listStaffRoles(tx))).map(({ name, colour }) => [name, colour]),
    ).toEqual([["Waiter", "yellow"]]);
  });

  it("updates a role's name and colour, keeping its own name free to itself", async () => {
    const v = await seedVenueWithStaff(suite.db);
    const waiter = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }),
    );
    await inTx((tx) => createStaffRole(tx, { name: "Runner", colour: "red" }, { personId: null }));
    await inTx((tx) => setStaffRoleHolders(tx, waiter.id, [v.ana], { personId: null }));
    const same = await inTx((tx) =>
      updateStaffRole(tx, waiter.id, { name: "Waiter", colour: "amber" }, { personId: null }),
    );
    expect(same).toMatchObject({
      name: "Waiter",
      colour: "amber",
      position: 0,
      holderIds: [v.ana],
    });
    const renamed = await inTx((tx) =>
      updateStaffRole(
        tx,
        waiter.id,
        { name: " Head waiter ", colour: "amber" },
        { personId: null },
      ),
    );
    expect(renamed.name).toBe("Head waiter");
    await expect(
      inTx((tx) =>
        updateStaffRole(tx, waiter.id, { name: "Runner", colour: "amber" }, { personId: null }),
      ),
    ).rejects.toMatchObject({ code: "staff_role.name_taken", params: { name: "Runner" } });
  });

  it("answers staff_role.not_found for an unknown id", async () => {
    const v = await seedVenueWithStaff(suite.db);
    await inTx((tx) => createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }));
    for (const staffRoleId of [randomUUID()]) {
      const notFound = { code: "staff_role.not_found", params: { staffRoleId } };
      await expect(
        inTx((tx) =>
          updateStaffRole(tx, staffRoleId, { name: "X", colour: "blue" }, { personId: null }),
        ),
      ).rejects.toMatchObject(notFound);
      await expect(
        inTx((tx) => setStaffRoleHolders(tx, staffRoleId, [v.ana], { personId: null })),
      ).rejects.toMatchObject(notFound);
      await expect(
        inTx((tx) => deleteStaffRole(tx, staffRoleId, { personId: null })),
      ).rejects.toMatchObject(notFound);
    }
    expect(await inTx((tx) => listStaffRoles(tx))).toHaveLength(1);
  });

  it("replaces the holder set, de-duplicating repeated ids", async () => {
    const v = await seedVenueWithStaff(suite.db);
    const staffRole = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }),
    );
    await inTx((tx) => setStaffRoleHolders(tx, staffRole.id, [v.ana, v.marc], { personId: null }));
    const replaced = await inTx((tx) =>
      setStaffRoleHolders(tx, staffRole.id, [v.marc, v.marc], { personId: null }),
    );
    expect(replaced.holderIds).toEqual([v.marc]);
    const emptied = await inTx((tx) =>
      setStaffRoleHolders(tx, staffRole.id, [], { personId: null }),
    );
    expect(emptied.holderIds).toEqual([]);
  });

  it("refuses holders that are not persons as staffing.invalid {field: personIds}", async () => {
    const v = await seedVenueWithStaff(suite.db);
    const staffRole = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }),
    );
    await inTx((tx) => setStaffRoleHolders(tx, staffRole.id, [v.ana], { personId: null }));
    await expect(
      inTx((tx) =>
        setStaffRoleHolders(tx, staffRole.id, [v.marc, randomUUID()], { personId: null }),
      ),
    ).rejects.toMatchObject({ code: "staffing.invalid", params: { field: "personIds" } });
    const [kept] = await inTx((tx) => listStaffRoles(tx));
    expect(kept!.holderIds).toEqual([v.ana]);
  });

  it("deleting a staff role deletes its blocks and holders", async () => {
    const v = await seedVenueWithStaff(suite.db);
    const staffRole = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }),
    );
    const kept = await inTx((tx) =>
      createStaffRole(tx, { name: "Cook", colour: "red" }, { personId: null }),
    );
    await inTx((tx) => setStaffRoleHolders(tx, staffRole.id, [v.ana], { personId: null }));
    await inTx((tx) => setStaffRoleHolders(tx, kept.id, [v.ana], { personId: null }));
    await paintBlock(v, staffRole.id);
    expect(await inTx((tx) => deleteStaffRole(tx, staffRole.id, { personId: null }))).toEqual({
      outcome: "deleted",
      removedFrom: 1,
    });
    expect(await suite.db.select().from(staffRoles).where(eq(staffRoles.id, staffRole.id))).toEqual(
      [],
    );
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

  it("hides a role a shift has used, clears its holders and blocks and permits its name again", async () => {
    const v = await seedVenueWithStaff(suite.db);
    const role = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }),
    );
    await inTx((tx) => setStaffRoleHolders(tx, role.id, [v.ana, v.marc], { personId: null }));
    await paintBlock(v, role.id);
    await assignShift(v, v.ana, role.id);
    expect(await inTx((tx) => deleteStaffRole(tx, role.id, { personId: null }))).toEqual({
      outcome: "hidden",
      removedFrom: 2,
    });
    const [stored] = await suite.db.select().from(staffRoles).where(eq(staffRoles.id, role.id));
    expect(stored).toMatchObject({ name: "Waiter", hiddenAt: expect.any(String) });
    expect(await suite.db.select().from(personStaffRoles)).toEqual([]);
    expect(await suite.db.select().from(staffingBlocks)).toEqual([]);
    expect(
      await suite.db.select({ staffRoleId: shiftAssignments.staffRoleId }).from(shiftAssignments),
    ).toEqual([{ staffRoleId: role.id }]);
    expect(await inTx(listStaffRoles)).toEqual([]);
    expect(await inTx(listStaffRolesWithHolderNames)).toEqual([]);
    await expect(
      inTx((tx) =>
        setPersonStaffRoles(tx, {
          personId: v.ana,
          staffRoleIds: [role.id],
          expectedStaffRoleIds: [],
          actorId: v.marc,
        }),
      ),
    ).rejects.toMatchObject({ code: "staff_role.not_found", params: { staffRoleId: role.id } });
    const replacement = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "red" }, { personId: null }),
    );
    await inTx((tx) => reorderStaffRoles(tx, [replacement.id]));
    expect((await inTx(listStaffRoles)).map((r) => r.id)).toEqual([replacement.id]);
    for (const write of [
      (tx: Transaction) => setStaffRoleHolders(tx, role.id, [v.ana], { personId: null }),
      (tx: Transaction) =>
        updateStaffRole(tx, role.id, { name: "Other", colour: "blue" }, { personId: null }),
      (tx: Transaction) => reorderStaffRoles(tx, [role.id]),
      (tx: Transaction) => deleteStaffRole(tx, role.id, { personId: null }),
    ])
      await expect(inTx<unknown>(write)).rejects.toMatchObject({ code: "staff_role.not_found" });
  });

  it("reorders by the given ids and refuses a list that is not exactly the venue's roles", async () => {
    await seedVenueWithStaff(suite.db);
    const make = (name: string) =>
      inTx((tx) => createStaffRole(tx, { name, colour: "grey" }, { personId: null }));
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
    await seedVenueWithStaff(suite.db);
    const person = (
      displayName: string,
      status: "active" | "pending" | "suspended" = "active",
      id: string = randomUUID(),
    ) =>
      inTx(async (tx) => {
        const [row] = await seedPersons(tx, {
          jobRoles: [],
          id,
          displayName,
          role: "staff",
          status,
        });
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
    const sous = await inTx((tx) =>
      createStaffRole(tx, { name: "Sous chef", colour: "green" }, { personId: null }),
    );
    const head = await inTx((tx) =>
      createStaffRole(tx, { name: "Head chef", colour: "purple" }, { personId: null }),
    );
    const waiter = await inTx((tx) =>
      createStaffRole(tx, { name: "Waiter", colour: "blue" }, { personId: null }),
    );
    await inTx((tx) => setStaffRoleHolders(tx, sous.id, [marc, alvaro, ana], { personId: null }));
    await inTx((tx) =>
      setStaffRoleHolders(tx, waiter.id, [twinA, ana, twinC, twinB], { personId: null }),
    );

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
