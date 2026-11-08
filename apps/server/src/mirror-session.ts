import { and, eq, isNull } from "drizzle-orm";
import { nowIso, withTransaction, type Database } from "@waitron/db";
import { managementSessions } from "@waitron/identity";

export const MIRROR_VIEWER_PERSON_ID = "acce55ed-0000-4000-8000-000000000001";
export const MIRROR_VIEWER_SESSION_ID = "acce55ed-0000-4000-8000-000000000002";

export async function endMirrorViewer(db: Database): Promise<void> {
  await withTransaction(db, (tx) =>
    tx
      .update(managementSessions)
      .set({ endedAt: nowIso() })
      .where(
        and(
          eq(managementSessions.id, MIRROR_VIEWER_SESSION_ID),
          isNull(managementSessions.endedAt),
        ),
      ),
  );
}
