import type { TillZoneMenu } from "../api/client.js";

export interface ZoneMenuIdentity {
  origin: string;
  deviceId: string;
  profileId: string;
  zoneId: string;
}

export class ZoneMenuMemory {
  readonly #storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  readonly #entries = new Map<string, { occurrenceKey: string; menuId: string } | null>();

  constructor(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null) {
    this.#storage = storage;
  }

  remember(identity: ZoneMenuIdentity, occurrenceKey: string, menuId: string): void {
    const key = this.#key(identity);
    const entry = { occurrenceKey, menuId };
    this.#entries.set(key, entry);
    try {
      this.#storage?.setItem(key, JSON.stringify(entry));
    } catch {
      // A blocked store still permits this app instance to remember its choices.
    }
  }

  resolve(
    identity: ZoneMenuIdentity,
    occurrenceKey: string | null,
    menus: readonly TillZoneMenu[],
    defaultMenuId: string | null,
  ): string {
    const key = this.#key(identity);
    const entry = this.#read(key);
    const orderable = (id: string | null): id is string =>
      menus.some((menu) => menu.id === id && menu.orderable);
    if (entry !== null) {
      if (
        occurrenceKey !== null &&
        entry.occurrenceKey === occurrenceKey &&
        orderable(entry.menuId)
      )
        return entry.menuId;
      this.#forget(key);
    }
    return orderable(defaultMenuId) ? defaultMenuId : "";
  }

  #key({ origin, deviceId, profileId, zoneId }: ZoneMenuIdentity): string {
    return `waitron.zoneMenu.${JSON.stringify([origin, deviceId, profileId, zoneId])}`;
  }

  #forget(key: string): void {
    // Keep the tombstone even when removal is refused, so this instance cannot revive stale storage.
    this.#entries.set(key, null);
    try {
      this.#storage?.removeItem(key);
    } catch {
      // The in-memory tombstone remains authoritative for this instance.
    }
  }

  #read(key: string): { occurrenceKey: string; menuId: string } | null {
    if (this.#entries.has(key)) return this.#entries.get(key) ?? null;
    try {
      const raw = this.#storage?.getItem(key);
      if (raw == null) return null;
      const value: unknown = JSON.parse(raw);
      if (
        value !== null &&
        typeof value === "object" &&
        "occurrenceKey" in value &&
        typeof value.occurrenceKey === "string" &&
        "menuId" in value &&
        typeof value.menuId === "string"
      ) {
        const entry = { occurrenceKey: value.occurrenceKey, menuId: value.menuId };
        this.#entries.set(key, entry);
        return entry;
      }
    } catch {
      // Invalid JSON and refused reads both fall back to the server's current default.
    }
    this.#forget(key);
    return null;
  }
}
