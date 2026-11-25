import type { PinThrottle, PinAttempts } from "@waitron/identity";
import { requireBodyUuid, requireUuidParam } from "@waitron/server-kit";
import { isUuid, AppError, isValidEmail, isValidGuestCount, int4InRange } from "@waitron/shared";
import type { BillCommand } from "./bill-actions.js";
import { invalid } from "./bill-allocation.js";
import { parseBillEditExpecteds } from "./bill-editing.js";
import type { MoveTarget, OtherPartyRead, MoveBillOptions } from "./move-bill.js";
import type { SubmitDraftInput } from "./order-drafts.js";
import type { SubmitGroupsInput, GroupLine } from "./order-group-submission.js";
import type { SplitGuestCounts, TableActionOptions, SplitSelection } from "./table-actions.js";
import "./errors.js";

/** A malformed id is refused with the code the route gives an absent or wrong-state order. */
export function requireUuidId(
  id: string,
  code:
    | "working_order.not_found"
    | "working_order.not_open"
    | "working_order.not_placed"
    | "working_order.not_settled",
): string {
  if (!isUuid(id)) {
    throw new AppError(code, { workingOrderId: id });
  }
  return id;
}
/**
 * An absent override leaves the operator's own role to decide. A malformed one is `pin.invalid`,
 * the one answer the credential gate gives any override that cannot sign in.
 */
export function parseDrawerOverride(
  raw: { personId?: unknown; pin?: unknown } | undefined | null,
): { personId: string; pin: string } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw.personId !== "string" || !isUuid(raw.personId)) {
    throw new AppError("pin.invalid", {}, { reason: "malformed" });
  }
  if (typeof raw.pin !== "string") {
    throw new AppError("pin.invalid", {}, { reason: "malformed" });
  }
  return { personId: raw.personId, pin: raw.pin };
}
const REASON_LIMIT = 500;
/** A reason, trimmed, refused as `reason` when it is not text, is blank or is too long. */
export function parseReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > REASON_LIMIT) {
    throw invalid("reason");
  }
  return value.trim();
}
/** A body's `override`, refused as `override` when it is present and not an object. */
export function parseOverrideField(value: unknown): { personId: string; pin: string } | undefined {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "object" || Array.isArray(value))
  ) {
    throw invalid("override");
  }
  return parseDrawerOverride(value as { personId?: unknown; pin?: unknown } | null | undefined);
}
/**
 * Where the till's override PINs count their wrong tries: one bucket per device, apart from sign-in's
 * per-device one. It is the requesting SESSION's device because that is fixed when the session
 * opens: the device cookie can be left off a request, and anyone can open a fresh session with their
 * own PIN, so keying on either would let a caller start the count again.
 */
export function overridePinAttempts(
  pinThrottle: PinThrottle,
  sessionDeviceId: string,
): PinAttempts {
  return { throttle: pinThrottle, slot: `override:${sessionDeviceId}` };
}
/** A non-UUID names no open tab, so it gets the absent tab's `tab.not_open`. */
export function requireTabParam(id: string): string {
  if (!isUuid(id)) {
    throw new AppError("tab.not_open", { tabId: id });
  }
  return id;
}
/**
 * A revision as a body carries it, an order's or a party's: a whole number from 0, else
 * `management.request_invalid` naming `field`.
 */
export function requireRevision(
  value: unknown,
  field:
    | "revision"
    | "draftRevision"
    | "expectedRevision"
    | "expectedBillRevision"
    | "expectedPartyRevision"
    | "expectedOtherPartyRevision" = "revision",
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError("management.request_invalid", { field });
  }
  return value;
}

export function requireRecipient(value: unknown): string {
  if (typeof value !== "string" || !isValidEmail(value)) {
    throw new AppError("management.request_invalid", { field: "recipient" });
  }
  return value.trim();
}
/** A non-UUID names no party, so it gets the absent party's `party.not_open`. */
export function requirePartyParam(id: string): string {
  if (!isUuid(id)) {
    throw new AppError("party.not_open", { partyId: id });
  }
  return id;
}
/** An optional guest count: absent or null records none, otherwise a whole number from 1. */
export function requireGuestCount(value: unknown, field = "guestCount"): number | null {
  if (value === undefined || value === null) return null;
  if (!isValidGuestCount(value)) throw invalid(field);
  return value;
}
/** A guest count the wire must carry: null clears it, an absent key is refused. */
export function requireGuestCountOrNull(value: unknown, field = "guestCount"): number | null {
  if (value === undefined) throw invalid(field);
  return requireGuestCount(value, field);
}

export function requireSplitGuestCounts(value: unknown): SplitGuestCounts | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalid("guestCounts");
  const { staying, leaving } = value as Record<string, unknown>;
  return {
    staying: requireGuestCountOrNull(staying, "guestCounts.staying"),
    leaving: requireGuestCountOrNull(leaving, "guestCounts.leaving"),
  };
}
/**
 * A bill route's command: the party revision, the party the till read the bill under, and the
 * acting person. A revision may be absent here: the verb refuses its absence only where the bill
 * belongs to a party.
 */
export function billCommand(personId: string, body: Record<string, unknown>): BillCommand {
  const command: BillCommand = { operatorId: personId };
  if (body.expectedPartyRevision !== undefined) {
    command.expectedPartyRevision = requireRevision(
      body.expectedPartyRevision,
      "expectedPartyRevision",
    );
  }
  if (body.partyId !== undefined) {
    command.partyId = requireBodyUuid(body.partyId, "partyId").toLowerCase();
  }
  return command;
}
/** A plain object whose keys are exactly `keys`. */
function hasExactly(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}
/**
 * A move's target: exactly one of a table's id, or the counter with its zone id or null. A
 * malformed table id is refused as the seat, Move guests and Join tables routes refuse one, a zone
 * id as the sale route.
 */
export function requireMoveTarget(value: unknown): MoveTarget {
  if (hasExactly(value, ["tableId"])) {
    const { tableId } = value;
    if (typeof tableId === "string") {
      if (!isUuid(tableId)) throw new AppError("table.not_found", { tableId });
      return { tableId: tableId.toLowerCase() };
    }
  } else if (hasExactly(value, ["counter"]) && hasExactly(value.counter, ["zoneId"])) {
    const { zoneId } = value.counter;
    if (zoneId === null) return { counter: { zoneId: null } };
    if (typeof zoneId === "string") {
      return { counter: { zoneId: requireUuidParam(zoneId, "ServiceZoneId").toLowerCase() } };
    }
  }
  throw invalid("to");
}
/** The party the till read at the target table, and its revision, as a body carries them. */
function otherPartyRead(body: Record<string, unknown>): OtherPartyRead {
  const read: OtherPartyRead = {};
  if (body.expectedOtherPartyRevision !== undefined) {
    read.expectedOtherPartyRevision = requireRevision(
      body.expectedOtherPartyRevision,
      "expectedOtherPartyRevision",
    );
  }
  if (body.otherPartyId === null) read.otherPartyId = null;
  else if (body.otherPartyId !== undefined) {
    read.otherPartyId = requireBodyUuid(body.otherPartyId, "otherPartyId").toLowerCase();
  }
  return read;
}
/**
 * A move's command: {@link billCommand}'s, with `partyId: null` for a bill read with no party, and
 * the party read at the target table.
 */
export function moveCommand(personId: string, body: Record<string, unknown>): MoveBillOptions {
  const { partyId, ...rest } = body;
  const command: MoveBillOptions = {
    ...billCommand(personId, partyId === null ? rest : body),
    expectedEdits: parseBillEditExpecteds(body.expectedEdits),
  };
  if (partyId === null) command.partyId = null;
  if (body.submissionId !== undefined || body.allergy !== undefined) {
    if (body.submissionId === undefined || body.allergy === undefined) throw invalid("allergy");
    command.submissionId = requireBodyUuid(body.submissionId, "submissionId").toLowerCase();
    command.allergy = body.allergy as MoveBillOptions["allergy"];
  }
  return { ...command, ...otherPartyRead(body) };
}
/**
 * A table action's command: the path party's revision and the party read at the target table.
 */
export function tableActionCommand(
  personId: string,
  body: Record<string, unknown>,
): TableActionOptions {
  return {
    expectedPartyRevision: requireRevision(body.expectedPartyRevision, "expectedPartyRevision"),
    operatorId: personId,
    ...otherPartyRead(body),
    expectedEdits: parseBillEditExpecteds(body.expectedEdits),
  };
}
/**
 * The other bill a bill route names, which the body must carry: a non-UUID names no open bill, as a
 * malformed path id.
 */
export function requireOtherBill(value: unknown, field: string): string {
  if (value === undefined) throw invalid(field);
  if (typeof value !== "string" || !isUuid(value)) {
    throw new AppError("tab.not_open", { tabId: String(value) });
  }
  return value;
}
/** What Split a table takes, every id lower-cased; a bad shape is the request's fault. */
export function requireSplitSelection(value: unknown): SplitSelection {
  const { wholeBillIds, loose } = selectionObject(value);
  if (!Array.isArray(wholeBillIds) || !Array.isArray(loose)) throw invalid("selection");
  return {
    wholeBillIds: wholeBillIds.map(selectionId),
    loose: loose.map((entry: unknown) => {
      const { billId, lineIds } = selectionObject(entry);
      if (!Array.isArray(lineIds)) throw invalid("selection");
      return { billId: selectionId(billId), lineIds: lineIds.map(selectionId) };
    }),
  };
}
function selectionObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid("selection");
  return value as Record<string, unknown>;
}
function selectionId(value: unknown): string {
  return requireBodyUuid(value, "selection").toLowerCase();
}
/** A list of line ids: a non-UUID is the request's fault, not a line the bill lacks. */
export function requireLineIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalid("lineIds");
  return value.map((id) => requireBodyUuid(id, "lineIds").toLowerCase());
}
/** A submission's held group to add to, when it names one. */
export function joinGroupOf(body: Record<string, unknown>): { joinGroupId?: string } {
  const { joinGroupId } = body;
  if (joinGroupId === undefined) return {};
  if (typeof joinGroupId !== "string") throw invalid("joinGroupId");
  return { joinGroupId };
}
function groupDestinationOf(body: Record<string, unknown>): {
  joinGroupId?: string;
  afterGroupId?: string;
} {
  const result: { joinGroupId?: string; afterGroupId?: string } = {};
  for (const field of ["joinGroupId", "afterGroupId"] as const) {
    if (body[field] !== undefined)
      result[field] = requireBodyUuid(body[field], field).toLowerCase();
  }
  return result;
}
/** A submission's bill, when it names one: a UUID, in lower case as ids are stored. */
export function billOf(body: Record<string, unknown>): { billId?: string } {
  const { billId } = body;
  if (billId === undefined) return {};
  return { billId: requireBodyUuid(billId, "billId").toLowerCase() };
}
/**
 * Submitted groups: each a release and a list of round lines. Only the shape is screened; pricing
 * refuses a line's contents.
 */
export function parseSubmittedGroups(value: unknown): SubmitGroupsInput["groups"] {
  if (!Array.isArray(value)) throw invalid("groups");
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw invalid("groups");
    }
    const { lines, release } = entry as Record<string, unknown>;
    if (
      !Array.isArray(lines) ||
      !lines.every((line) => typeof line === "object" && line !== null && !Array.isArray(line))
    ) {
      throw invalid("lines");
    }
    if (release !== "fire" && release !== "hold") throw invalid("release");
    return {
      lines: lines as GroupLine[],
      release,
      ...groupDestinationOf(entry as Record<string, unknown>),
    };
  });
}
/** A draft route's party, in lower case as ids are stored, so a draft on it compares equal. */
export function requireDraftPartyParam(id: string): string {
  return requirePartyParam(id).toLowerCase();
}
/** A draft route's draft, in lower case as ids are stored: an id that is no UUID names none. */
export function requireDraftParam(draftId: string): string {
  if (!isUuid(draftId)) throw new AppError("draft.not_found", { draftId });
  return draftId.toLowerCase();
}
/** A step route's step, in lower case as ids are stored: an id that is no UUID names none. */
export function requireStepParam(stepId: string): string {
  if (!isUuid(stepId)) throw new AppError("service_step.not_found", { stepId });
  return stepId.toLowerCase();
}
/** When the till showed a step as due, as the floor read sent it, in milliseconds. */
export function requireShownDueAt(value: unknown): number {
  const at = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value) throw invalid("dueAt");
  return at;
}
/** A save's draft: null for the operator's new one, else a UUID. */
export function requireDraftId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !isUuid(value)) throw invalid("draftId");
  return value;
}
/** Groups of draft line ids, each with its release. Only the shape is screened. */
export function parseDraftGroups(value: unknown): SubmitDraftInput["groups"] {
  if (!Array.isArray(value)) throw invalid("groups");
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw invalid("groups");
    }
    const { lineIds, release } = entry as Record<string, unknown>;
    if (!Array.isArray(lineIds) || !lineIds.every((id) => typeof id === "string")) {
      throw invalid("lineIds");
    }
    if (release !== "fire" && release !== "hold") throw invalid("release");
    return {
      lineIds: lineIds as string[],
      release,
      ...groupDestinationOf(entry as Record<string, unknown>),
    };
  });
}
/** A list of `{ lineId, quantity }`, both strings; anything else is refused naming `field`. */
export function parseLineQuantities(
  value: unknown,
  field: string,
): { lineId: string; quantity: string }[] {
  if (!Array.isArray(value)) throw invalid(field);
  return value.map((entry: unknown) => {
    const item =
      typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
    if (item === null || typeof item.lineId !== "string" || typeof item.quantity !== "string") {
      throw invalid(field);
    }
    return { lineId: item.lineId, quantity: item.quantity };
  });
}

export function parseMoveTarget(value: unknown): { groupId: string } | "new" {
  if (value === "new") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { groupId?: unknown }).groupId === "string"
  ) {
    return { groupId: (value as { groupId: string }).groupId };
  }
  throw invalid("target");
}
/** A value that cannot be a line number gets the absent line's `tab.line_not_found`. */
export function requireLineNo(tabId: string, raw: string): number {
  const lineNo = Number(raw);
  if (!int4InRange(lineNo, 1)) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  return lineNo;
}
