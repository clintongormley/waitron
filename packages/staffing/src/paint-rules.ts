import { AppError, isUuid } from "@waitron/shared";
import { blockSpan, type AreaRef, type StaffingBlock } from "./slots.js";
import "./errors.js";

const invalid = (field: string) => new AppError("staffing.invalid", { field });
const STEP_TIME = /^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/;
const BLOCK_KEYS = new Set(["staffRoleId", "headcount", "startsAt", "endsAt"]);
const AREA_KEYS = new Set(["kind", "id"]);

function record(value: unknown, field: string, keys: ReadonlySet<string>): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(field);
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown !== undefined) throw invalid(`${field}.${unknown}`);
  return value as Record<string, unknown>;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw invalid(field);
  return value.toLowerCase();
}

function stepTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !STEP_TIME.test(value)) throw invalid(field);
  return value;
}

function parseBlock(value: unknown, field: string, cutover: string): StaffingBlock {
  const raw = record(value, field, BLOCK_KEYS);
  const staffRoleId = uuid(raw.staffRoleId, `${field}.staffRoleId`);
  const { headcount } = raw;
  if (
    typeof headcount !== "number" ||
    !Number.isInteger(headcount) ||
    headcount < 1 ||
    headcount > 50
  )
    throw invalid(`${field}.headcount`);
  const startsAt = stepTime(raw.startsAt, `${field}.startsAt`);
  const endsAt = stepTime(raw.endsAt, `${field}.endsAt`);
  // A block stays inside its business day.
  const span = blockSpan({ startsAt, endsAt }, cutover);
  if (startsAt === endsAt || span.end <= span.start) throw invalid(`${field}.endsAt`);
  return { staffRoleId, headcount, startsAt, endsAt };
}

/** A day's painted blocks from a request body; `cutover` is the location's `HH:MM` changeover. */
export function parseBlocks(value: unknown, field: string, cutover: string): StaffingBlock[] {
  if (!Array.isArray(value)) throw invalid(field);
  return value.map((item, index) => parseBlock(item, `${field}.${index}`, cutover));
}

export function parseArea(value: unknown, field: string): AreaRef {
  const raw = record(value, field, AREA_KEYS);
  if (raw.kind !== "department" && raw.kind !== "station") throw invalid(`${field}.kind`);
  return { kind: raw.kind, id: uuid(raw.id, `${field}.id`) };
}
