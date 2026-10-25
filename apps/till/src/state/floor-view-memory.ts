export type FloorView = "map" | "list";

export interface FloorViewIdentity {
  origin: string;
  deviceId: string;
}

export interface FloorViewChoices {
  read(zoneId: string): FloorView | undefined;
  remember(zoneId: string, view: FloorView): void;
}

/** List or Map per zone on this device, kept in `storage` and, for this app instance, in memory, so
 * a store that refuses still remembers until the page reloads. */
export function floorViewChoices(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  { origin, deviceId }: FloorViewIdentity,
): FloorViewChoices {
  const entries = new Map<string, FloorView | null>();
  const keyOf = (zoneId: string) =>
    `waitron.floorView.${JSON.stringify([origin, deviceId, zoneId])}`;

  return {
    read(zoneId) {
      const key = keyOf(zoneId);
      if (entries.has(key)) return entries.get(key) ?? undefined;
      let raw: string | null | undefined;
      try {
        raw = storage?.getItem(key);
      } catch {
        entries.set(key, null);
        return undefined;
      }
      if (raw == null) return undefined;
      if (raw === "map" || raw === "list") {
        entries.set(key, raw);
        return raw;
      }
      // Kept even when removal is refused, so this instance never reads the bad value again.
      entries.set(key, null);
      try {
        storage?.removeItem(key);
      } catch {
        // The in-memory tombstone stands in for the removal.
      }
      return undefined;
    },
    remember(zoneId, view) {
      const key = keyOf(zoneId);
      entries.set(key, view);
      try {
        storage?.setItem(key, view);
      } catch {
        // A refused store still lets this app instance remember the choice.
      }
    },
  };
}
