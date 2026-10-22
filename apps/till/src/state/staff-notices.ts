import type { DeviceEquipmentRead, StaffNotice } from "../api/client.js";

const RANK: Record<StaffNotice["severity"], number> = { error: 0, warning: 1, notice: 2 };

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

/** The notices to show after `read`: its own, plus the notices `previous` held from each owner
 * `read` names as unavailable, less any `read` sent again (same owner and key); ordered errors,
 * warnings, then the rest, keeping the order given within each. Entries that are not well formed
 * are dropped; an unknown severity counts as `notice`. */
export function nextNotices(
  previous: readonly StaffNotice[],
  read: DeviceEquipmentRead,
): StaffNotice[] {
  const fresh = (Array.isArray(read.notices) ? read.notices : [])
    .map(wellFormed)
    .filter((notice): notice is StaffNotice => notice !== null);
  const unavailable = Array.isArray(read.noticesUnavailable) ? read.noticesUnavailable : [];
  const kept = previous.filter(
    (notice) =>
      unavailable.includes(notice.owner) &&
      !fresh.some((f) => f.owner === notice.owner && f.key === notice.key),
  );
  return [...fresh, ...kept].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
