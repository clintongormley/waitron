import type { DeviceEquipmentRead, StaffNotice } from "../api/client.js";

const RANK: Record<StaffNotice["severity"], number> = { error: 0, warning: 1, notice: 2 };

/** The box's marker that this till may offer "Check the time": never shown as a line of its own. */
const CHECK_TIME = "clock.check_time";
const BOX_CLOCK_OWNER = "box-clock";
/** The box's notice while its start waits for its time: it is sent in place of the marker. */
const WAITING_START = "clock.unconfirmed";

function wellFormed(entry: unknown): StaffNotice | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { owner, key, code, severity, params } = entry as Record<string, unknown>;
  if (typeof owner !== "string" || typeof key !== "string" || typeof code !== "string") return null;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  return {
    owner,
    key,
    code,
    severity: severity === "error" || severity === "warning" ? severity : "notice",
    params: params as Record<string, unknown>,
  };
}

function freshNotices(read: DeviceEquipmentRead): StaffNotice[] {
  return (Array.isArray(read.notices) ? read.notices : [])
    .map(wellFormed)
    .filter((notice): notice is StaffNotice => notice !== null);
}

/** The notices to show after `read`: its own, plus the notices `previous` held from each owner
 * `read` names as unavailable, less any `read` sent again (same owner and key); ordered errors,
 * warnings, then the rest, keeping the order given within each. Entries that are not well formed
 * are dropped, and so is the check-the-time marker; an unknown severity counts as `notice`. */
export function nextNotices(
  previous: readonly StaffNotice[],
  read: DeviceEquipmentRead,
): StaffNotice[] {
  const fresh = freshNotices(read).filter((notice) => notice.code !== CHECK_TIME);
  const unavailable = Array.isArray(read.noticesUnavailable) ? read.noticesUnavailable : [];
  const kept = previous.filter(
    (notice) =>
      unavailable.includes(notice.owner) &&
      !fresh.some((f) => f.owner === notice.owner && f.key === notice.key),
  );
  return [...fresh, ...kept].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/** Whether `read` carries the box's well-formed check-the-time marker or waiting-start notice;
 * `previous` while it names the marker's owner unavailable, as `nextNotices` keeps that owner's
 * lines. */
export function checkTimeOffered(read: DeviceEquipmentRead, previous: boolean): boolean {
  const unavailable = Array.isArray(read.noticesUnavailable) ? read.noticesUnavailable : [];
  if (unavailable.includes(BOX_CLOCK_OWNER)) return previous;
  return freshNotices(read).some(
    (notice) =>
      notice.code === CHECK_TIME ||
      (notice.code === WAITING_START && notice.owner === BOX_CLOCK_OWNER),
  );
}

/** The box's waiting-start notice to show after `read`, through {@link nextNotices}: so a notice
 * that is not well formed is dropped, and `previous` stays while `read` names the box's clock
 * owner unavailable. */
export function waitingStartNotice(
  previous: StaffNotice | undefined,
  read: DeviceEquipmentRead,
): StaffNotice | undefined {
  return nextNotices(previous === undefined ? [] : [previous], read).find(
    (notice) => notice.code === WAITING_START && notice.owner === BOX_CLOCK_OWNER,
  );
}
