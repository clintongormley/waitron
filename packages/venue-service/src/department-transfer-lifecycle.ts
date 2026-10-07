import { and, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { departmentTransferRequests } from "./schema/department-transfers.js";

export async function withdrawPendingDepartmentTransfers(
  tx: Transaction,
  tabIds: readonly string[],
): Promise<void> {
  if (tabIds.length === 0) return;
  await tx
    .update(departmentTransferRequests)
    .set({
      status: "withdrawn",
      resolvedAt: new Date().toISOString(),
      revision: sql`${departmentTransferRequests.revision} + 1`,
    })
    .where(
      and(
        inArray(departmentTransferRequests.tabId, [...tabIds]),
        eq(departmentTransferRequests.status, "pending"),
      ),
    );
}
