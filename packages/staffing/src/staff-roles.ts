import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";
import {
  personStaffRoles,
  shiftAssignments,
  staffingBlocks,
  staffRoles,
} from "./schema/staffing.js";
import type { CalendarColour, StaffRole } from "./staffing-types.js";
import "./errors.js";

type Cfg = { locationId: string };
export interface StaffRoleInput {
  name: string;
  colour: CalendarColour;
}

const invalid = (field: string) => new AppError("staffing.invalid", { field });
const notFound = (staffRoleId: string) => new AppError("staff_role.not_found", { staffRoleId });
const tally = sql<number>`count(*)`.mapWith(Number);

function roleValues(input: StaffRoleInput): StaffRoleInput {
  const name = input.name.trim();
  if (name === "") throw invalid("name");
  if (!(CALENDAR_COLOURS as readonly string[]).includes(input.colour)) throw invalid("colour");
  return { name, colour: input.colour };
}

/** Names compare exactly after trimming, as the unique index does. */
async function assertNameFree(tx: Transaction, cfg: Cfg, name: string, except: string | null) {
  const [clash] = await tx
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.locationId, cfg.locationId),
        eq(staffRoles.name, name),
        except === null ? undefined : ne(staffRoles.id, except),
      ),
    );
  if (clash) throw new AppError("staff_role.name_taken", { name });
}

async function assertRoleHere(tx: Transaction, cfg: Cfg, staffRoleId: string): Promise<void> {
  const [row] = await tx
    .select({ id: staffRoles.id })
    .from(staffRoles)
    .where(and(eq(staffRoles.id, staffRoleId), eq(staffRoles.locationId, cfg.locationId)));
  if (row === undefined) throw notFound(staffRoleId);
}

/** Only after the caller has checked or written the row in this transaction. */
async function readStaffRole(tx: Transaction, cfg: Cfg, staffRoleId: string): Promise<StaffRole> {
  return (await listStaffRoles(tx, cfg)).find(({ id }) => id === staffRoleId)!;
}

async function countsByRole(
  tx: Transaction,
  cfg: Cfg,
  table: typeof staffingBlocks | typeof shiftAssignments,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ staffRoleId: table.staffRoleId, n: tally })
    .from(table)
    .innerJoin(staffRoles, eq(staffRoles.id, table.staffRoleId))
    .where(eq(staffRoles.locationId, cfg.locationId))
    .groupBy(table.staffRoleId);
  return new Map(rows.map((row) => [row.staffRoleId, row.n]));
}

/** The location's staff roles in position order, with who holds each and how much uses it. */
export async function listStaffRoles(tx: Transaction, cfg: Cfg): Promise<StaffRole[]> {
  const roles = await tx
    .select({
      id: staffRoles.id,
      name: staffRoles.name,
      colour: staffRoles.colour,
      position: staffRoles.position,
    })
    .from(staffRoles)
    .where(eq(staffRoles.locationId, cfg.locationId))
    .orderBy(asc(staffRoles.position), asc(staffRoles.name));
  const holders = await tx
    .select({ staffRoleId: personStaffRoles.staffRoleId, personId: personStaffRoles.personId })
    .from(personStaffRoles)
    .innerJoin(staffRoles, eq(staffRoles.id, personStaffRoles.staffRoleId))
    .where(eq(staffRoles.locationId, cfg.locationId))
    .orderBy(asc(personStaffRoles.personId));
  const blocks = await countsByRole(tx, cfg, staffingBlocks);
  const shiftsUsing = await countsByRole(tx, cfg, shiftAssignments);
  return roles.map((role) => ({
    ...role,
    holderIds: holders.filter((h) => h.staffRoleId === role.id).map((h) => h.personId),
    blockCount: blocks.get(role.id) ?? 0,
    shiftCount: shiftsUsing.get(role.id) ?? 0,
  }));
}

/** Adds a staff role after the location's last one. */
export async function createStaffRole(
  tx: Transaction,
  cfg: Cfg,
  input: StaffRoleInput,
): Promise<StaffRole> {
  const values = roleValues(input);
  await assertNameFree(tx, cfg, values.name, null);
  const [next] = await tx
    .select({ position: sql<number>`coalesce(max(${staffRoles.position}) + 1, 0)`.mapWith(Number) })
    .from(staffRoles)
    .where(eq(staffRoles.locationId, cfg.locationId));
  const [row] = await tx
    .insert(staffRoles)
    .values({ locationId: cfg.locationId, ...values, position: next!.position })
    .returning({ id: staffRoles.id });
  return readStaffRole(tx, cfg, row!.id);
}

export async function updateStaffRole(
  tx: Transaction,
  cfg: Cfg,
  staffRoleId: string,
  input: StaffRoleInput,
): Promise<StaffRole> {
  const values = roleValues(input);
  await assertRoleHere(tx, cfg, staffRoleId);
  await assertNameFree(tx, cfg, values.name, staffRoleId);
  await tx.update(staffRoles).set(values).where(eq(staffRoles.id, staffRoleId));
  return readStaffRole(tx, cfg, staffRoleId);
}

/** Replaces who holds the role. Nothing references a `person_staff_roles` row, so delete-then-insert is safe. */
export async function setStaffRoleHolders(
  tx: Transaction,
  cfg: Cfg,
  staffRoleId: string,
  personIds: readonly string[],
): Promise<StaffRole> {
  await assertRoleHere(tx, cfg, staffRoleId);
  const unique = [...new Set(personIds)];
  if (unique.length > 0) {
    const found = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(inArray(persons.id, unique));
    if (found.length !== unique.length) throw invalid("personIds");
  }
  await tx.delete(personStaffRoles).where(eq(personStaffRoles.staffRoleId, staffRoleId));
  if (unique.length > 0)
    await tx.insert(personStaffRoles).values(unique.map((personId) => ({ personId, staffRoleId })));
  return readStaffRole(tx, cfg, staffRoleId);
}

/** Puts the location's roles in the order given; the list must name each of them exactly once. */
export async function reorderStaffRoles(
  tx: Transaction,
  cfg: Cfg,
  staffRoleIds: readonly string[],
): Promise<void> {
  const rows = await tx
    .select({ id: staffRoles.id, position: staffRoles.position })
    .from(staffRoles)
    .where(eq(staffRoles.locationId, cfg.locationId));
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

/** Deletes the role with its holders and painted blocks; refused while a shift fills it. */
export async function deleteStaffRole(
  tx: Transaction,
  cfg: Cfg,
  staffRoleId: string,
): Promise<void> {
  await assertRoleHere(tx, cfg, staffRoleId);
  const [used] = await tx
    .select({ n: tally })
    .from(shiftAssignments)
    .where(eq(shiftAssignments.staffRoleId, staffRoleId));
  const shiftCount = used!.n;
  if (shiftCount > 0) throw new AppError("staff_role.in_use", { staffRoleId, shiftCount });
  await tx.delete(staffRoles).where(eq(staffRoles.id, staffRoleId));
}
