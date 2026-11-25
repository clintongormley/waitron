/** What a refusal's banner words it by. */
export interface SeatingRefusal {
  code: string;
  reason?: string;
  advances?: string;
  excess?: string;
  invoiceNumber?: string;
}

function texts<K extends string>(error: object, keys: readonly K[]): Partial<Record<K, string>> {
  const values = error as Record<string, unknown>;
  return Object.fromEntries(
    keys.flatMap((key) => (typeof values[key] === "string" ? [[key, values[key]]] : [])),
  ) as Partial<Record<K, string>>;
}

/** A refused seating of a Counter order, when its sentence is picked or filled in by more than its
 * code: its set menus change what it comes to, and seating it can issue its invoice. */
export function seatingRefusalOf(error: unknown): SeatingRefusal | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code } = error as { code?: unknown };
  if (code === "bill.below_advances")
    return { code, ...texts(error, ["advances", "excess"]), reason: "seating" };
  if (code === "venue.time_zone_not_ready") return { code, ...texts(error, ["reason"]) };
  if (code === "advance.correction_open") return { code, ...texts(error, ["invoiceNumber"]) };
  // Not `clockUnusableText`: that says a payment was not recorded, and seating takes none.
  return code === "clock.unusable" ? { code } : undefined;
}
