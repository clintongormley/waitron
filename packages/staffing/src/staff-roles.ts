import { insertInChunks, recordActivity, personStaffRoles, staffRoles } from "@waitron/db";
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { type Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { AppError, createLabelComparator } from "@waitron/shared";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";
import { shiftAssignments, staffingBlocks } from "@waitron/workforce";
import type { CalendarColour, ListedStaffRole, StaffRole } from "./staffing-types.js";
import "./errors.js";

type Actor = { personId: string | null };

export interface StaffRoleInput {
  name: string;
  colour: CalendarColour;
}

const invalid = (field: string) => new AppError("staffing.invalid", { field });
const notFound = (staffRoleId: string) => new AppError("staff_role.not_found", { staffRoleId });

function staffRoleValues(input: StaffRoleInput): StaffRoleInput {
  const name = input.name.trim();
  if (name === "") throw invalid("name");
  if (!(CALENDAR_COLOURS as readonly string[]).includes(input.colour)) throw invalid("colour");
  return { name, colour: input.colour };
}

export function staffRolesNamed(tx: Transaction, name: string, except: string | null) {
  return tx
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.name, name),
        isNull(staffRoles.hiddenAt),
        except === null ? undefined : ne(staffRoles.id, except),
      ),
    );
}

/** Names compare exactly after trimming, as the unique index does. */
async function assertNameFree(tx: Transaction, name: string, except: string | null) {
  const [clash] = await staffRolesNamed(tx, name, except);
  if (clash) throw new AppError("staff_role.name_taken", { name });
}

async function assertStaffRoleExists(tx: Transaction, staffRoleId: string): Promise<void> {
  const [row] = await tx
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(and(eq(staffRoles.id, staffRoleId), isNull(staffRoles.hiddenAt)));
  if (row === undefined) throw notFound(staffRoleId);
}

/** Only after the caller has checked or written the row in this transaction. */
async function readStaffRole(tx: Transaction, staffRoleId: string): Promise<StaffRole> {
  return (await readStaffRoles(tx, staffRoleId))[0]!;
}

function staffRoleRows(tx: Transaction, scope: SQL | undefined) {
  return tx
    .select({
      id: staffRoles.id,
      name: staffRoles.name,
      colour: staffRoles.colour,
      position: staffRoles.position,
    })
    .from(staffRoles)
    .where(scope)
    .orderBy(asc(staffRoles.position), asc(staffRoles.name));
}

function byStaffRole<Row extends { staffRoleId: string }>(
  rows: readonly Row[],
): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const held = grouped.get(row.staffRoleId);
    if (held) held.push(row);
    else grouped.set(row.staffRoleId, [row]);
  }
  return grouped;
}

/** Every query is narrowed to `only` when it is given, so a write's answer reads one staff role. */
async function readStaffRoles(tx: Transaction, only: string | null): Promise<StaffRole[]> {
  const scope = and(
    isNull(staffRoles.hiddenAt),
    only === null ? undefined : eq(staffRoles.id, only),
  );
  const rows = await staffRoleRows(tx, scope);
  const holders = byStaffRole(
    await tx
      .select({ staffRoleId: personStaffRoles.staffRoleId, personId: personStaffRoles.personId })
      .from(personStaffRoles)
      .innerJoin(staffRoles, eq(staffRoles.id, personStaffRoles.staffRoleId))
      .where(scope)
      .orderBy(asc(personStaffRoles.personId)),
  );
  return rows.map((staffRole) => ({
    ...staffRole,
    holderIds: (holders.get(staffRole.id) ?? []).map((h) => h.personId),
  }));
}

/** The staff roles in position order, with who holds each. */
export function listStaffRoles(tx: Transaction): Promise<StaffRole[]> {
  return readStaffRoles(tx, null);
}

/** The staff roles as `listStaffRoles` gives them, each with its holders' names. */
export async function listStaffRolesWithHolderNames(tx: Transaction): Promise<ListedStaffRole[]> {
  const rows = await staffRoleRows(tx, isNull(staffRoles.hiddenAt));
  const holders = byStaffRole(
    await tx
      .select({
        staffRoleId: personStaffRoles.staffRoleId,
        personId: personStaffRoles.personId,
        name: persons.displayName,
      })
      .from(personStaffRoles)
      .innerJoin(persons, eq(persons.id, personStaffRoles.personId))
      .orderBy(asc(personStaffRoles.personId)),
  );
  const compare = createLabelComparator();
  return rows.map((staffRole) => {
    const held = holders.get(staffRole.id) ?? [];
    return {
      ...staffRole,
      holderIds: held.map((h) => h.personId),
      holderNames: held.map((h) => h.name).sort(compare),
    };
  });
}

/** Adds a staff role after the last one. */
export async function createStaffRole(
  tx: Transaction,
  input: StaffRoleInput,
  actor: Actor,
): Promise<StaffRole> {
  const values = staffRoleValues(input);
  await assertNameFree(tx, values.name, null);
  const [next] = await tx
    .select({ position: sql<number>`coalesce(max(${staffRoles.position}) + 1, 0)`.mapWith(Number) })
    .from(staffRoles);
  const [row] = await tx
    .insert(staffRoles)
    .values({ ...values, position: next!.position })
    .returning({ id: staffRoles.id });
  await recordActivity(tx, {
    kind: "job_role.created",
    subjectId: row!.id,
    personId: actor.personId,
    data: { name: values.name },
  });
  return readStaffRole(tx, row!.id);
}

export async function updateStaffRole(
  tx: Transaction,
  staffRoleId: string,
  input: StaffRoleInput,
  actor: Actor,
): Promise<StaffRole> {
  const values = staffRoleValues(input);
  await assertStaffRoleExists(tx, staffRoleId);
  await assertNameFree(tx, values.name, staffRoleId);
  const previous = await readStaffRole(tx, staffRoleId);
  await tx.update(staffRoles).set(values).where(eq(staffRoles.id, staffRoleId));
  if (previous.name !== values.name)
    await recordActivity(tx, {
      kind: "job_role.renamed",
      subjectId: staffRoleId,
      personId: actor.personId,
      data: { from: previous.name, to: values.name },
    });
  return readStaffRole(tx, staffRoleId);
}

/** Replaces who holds the role. Nothing references a `person_staff_roles` row, so delete-then-insert is safe. */
export async function setStaffRoleHolders(
  tx: Transaction,
  staffRoleId: string,
  personIds: readonly string[],
  actor: Actor,
): Promise<StaffRole> {
  await assertStaffRoleExists(tx, staffRoleId);
  const unique = [...new Set(personIds)];
  if (unique.length > 0) {
    const found = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(inArray(persons.id, unique));
    if (found.length !== unique.length) throw invalid("personIds");
  }
  const previous = await readStaffRole(tx, staffRoleId);
  for (const personId of previous.holderIds) {
    if (!unique.includes(personId))
      await recordActivity(tx, {
        kind: "job_role.member_removed",
        subjectId: personId,
        personId: actor.personId,
        data: { staffRoleId, name: previous.name },
      });
  }
  for (const personId of unique) {
    if (!previous.holderIds.includes(personId))
      await recordActivity(tx, {
        kind: "job_role.member_added",
        subjectId: personId,
        personId: actor.personId,
        data: { staffRoleId, name: previous.name },
      });
  }
  if (
    previous.holderIds.length !== unique.length ||
    unique.some((id) => !previous.holderIds.includes(id))
  ) {
    await tx.delete(personStaffRoles).where(eq(personStaffRoles.staffRoleId, staffRoleId));
    await insertInChunks(
      tx,
      personStaffRoles,
      unique.map((personId) => ({ personId, staffRoleId })),
    );
  }
  return readStaffRole(tx, staffRoleId);
}

/** Puts the roles in the order given; the list must name each of them exactly once. */
export async function reorderStaffRoles(
  tx: Transaction,
  staffRoleIds: readonly string[],
): Promise<void> {
  const rows = await tx
    .select({ id: staffRoles.id, position: staffRoles.position })
    .from(staffRoles)
    .where(isNull(staffRoles.hiddenAt));
  const current = new Map(rows.map((row) => [row.id, row.position]));
  const unknown = staffRoleIds.find((id) => !current.has(id));
  if (unknown !== undefined) throw notFound(unknown);
  if (new Set(staffRoleIds).size !== staffRoleIds.length || staffRoleIds.length !== rows.length)
    throw invalid("staffRoleIds");
  for (const [position, staffRoleId] of staffRoleIds.entries()) {
    if (current.get(staffRoleId) === position) continue;
    await tx.update(staffRoles).set({ position }).where(eq(staffRoles.id, staffRoleId));
  }
}

export async function deleteStaffRole(
  tx: Transaction,
  staffRoleId: string,
  actor: Actor,
): Promise<{ outcome: "deleted" | "hidden"; removedFrom: number }> {
  await assertStaffRoleExists(tx, staffRoleId);
  const [used] = await tx
    .select({ id: shiftAssignments.shiftId })
    .from(shiftAssignments)
    .where(eq(shiftAssignments.staffRoleId, staffRoleId))
    .limit(1);
  const previous = await readStaffRole(tx, staffRoleId);
  await setStaffRoleHolders(tx, staffRoleId, [], actor);
  if (used) {
    await tx.delete(staffingBlocks).where(eq(staffingBlocks.staffRoleId, staffRoleId));
    await tx
      .update(staffRoles)
      .set({ hiddenAt: new Date().toISOString() })
      .where(eq(staffRoles.id, staffRoleId));
  } else {
    await tx.delete(staffRoles).where(eq(staffRoles.id, staffRoleId));
  }
  await recordActivity(tx, {
    kind: used ? "job_role.hidden" : "job_role.deleted",
    subjectId: staffRoleId,
    personId: actor.personId,
    data: { name: previous.name },
  });
  return { outcome: used ? "hidden" : "deleted", removedFrom: previous.holderIds.length };
}

export async function setPersonStaffRoles(
  tx: Transaction,
  input: {
    personId: string;
    staffRoleIds: readonly string[];
    expectedStaffRoleIds: readonly string[];
    actorId: string;
  },
): Promise<string[]> {
  const [person] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.id, input.personId));
  if (!person) throw new AppError("person.not_found", { personId: input.personId });
  const current = await tx
    .select({ id: staffRoles.id, name: staffRoles.name })
    .from(personStaffRoles)
    .innerJoin(staffRoles, eq(staffRoles.id, personStaffRoles.staffRoleId))
    .where(eq(personStaffRoles.personId, input.personId));
  const ids = [...new Set(input.staffRoleIds)].sort();
  const expected = [...new Set(input.expectedStaffRoleIds)].sort();
  const saved = current.map((r) => r.id).sort();
  if (saved.length !== expected.length || saved.some((id, i) => id !== expected[i]))
    throw new AppError("person.job_roles_changed", {});
  const roles = await listStaffRoles(tx);
  for (const id of ids) if (!roles.some((r) => r.id === id)) throw notFound(id);
  if (saved.length === ids.length && saved.every((id, i) => id === ids[i])) return ids;
  for (const role of current)
    if (!ids.includes(role.id))
      await recordActivity(tx, {
        kind: "job_role.member_removed",
        subjectId: input.personId,
        personId: input.actorId,
        data: { staffRoleId: role.id, name: role.name },
      });
  for (const id of ids)
    if (!saved.includes(id))
      await recordActivity(tx, {
        kind: "job_role.member_added",
        subjectId: input.personId,
        personId: input.actorId,
        data: { staffRoleId: id, name: roles.find((r) => r.id === id)!.name },
      });
  await tx.delete(personStaffRoles).where(eq(personStaffRoles.personId, input.personId));
  await insertInChunks(
    tx,
    personStaffRoles,
    ids.map((staffRoleId) => ({ personId: input.personId, staffRoleId })),
  );
  return ids;
}
