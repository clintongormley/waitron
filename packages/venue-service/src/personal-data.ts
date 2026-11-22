import { departmentTransferRequests, workingOrders } from "@waitron/db";
import { jsonFile, type ModulePersonalData } from "@waitron/module";
import { asc, eq } from "drizzle-orm";

const FILE = "department-transfers.json";

export const VENUE_SERVICE_PERSONAL_DATA: ModulePersonalData = {
  files: [FILE],
  async prepare(tx, { personId }) {
    const rows = await tx
      .select({
        order: workingOrders.orderNumber,
        sourceDepartmentId: departmentTransferRequests.sourceDepartmentId,
        destinationDepartmentId: departmentTransferRequests.destinationDepartmentId,
        status: departmentTransferRequests.status,
        resolvedAt: departmentTransferRequests.resolvedAt,
      })
      .from(departmentTransferRequests)
      .innerJoin(workingOrders, eq(workingOrders.id, departmentTransferRequests.tabId))
      .where(eq(departmentTransferRequests.resolvedBy, personId))
      .orderBy(asc(departmentTransferRequests.resolvedAt), asc(departmentTransferRequests.id));

    return async () => (rows.length === 0 ? [] : [jsonFile(FILE, rows)]);
  },
};
