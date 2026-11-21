import { eq, sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { drawerEntries } from "./schema/drawer-entries.js";

type NewDrawerEntry = Omit<typeof drawerEntries.$inferInsert, "sequence">;

export async function appendDrawerEntry(tx: Transaction, entry: NewDrawerEntry) {
  // The venue write transaction covers both the position and the money it records.
  const [position] = await tx
    .select({ next: sql<number>`coalesce(max(${drawerEntries.sequence}), 0) + 1` })
    .from(drawerEntries)
    .where(eq(drawerEntries.printerId, entry.printerId));
  const [saved] = await tx
    .insert(drawerEntries)
    .values({
      ...entry,
      sequence: position!.next,
    })
    .returning();
  return saved!;
}
