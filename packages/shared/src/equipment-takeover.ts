/** How a device asked for an item: a scanned label, a pick from its list, or a manager's edit. */
export type EquipmentVia = "scan" | "list" | "manage";

/**
 * Whether a choice may take an item another device holds: a scan may, a list pick only once the
 * person confirms the takeover, and a manager never.
 */
export function mayTakeOver(via: EquipmentVia, takeOver: boolean | undefined): boolean {
  return via === "scan" || (via === "list" && takeOver === true);
}
