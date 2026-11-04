import { createDepartment, createServiceZone, listDepartments } from "@waitron/venue-service";
import type { Transaction } from "@waitron/db";

export async function createZone(
  tx: Transaction,
  input: { name: string; displayOrder?: number },
): Promise<{ id: string }> {
  const existing = (await listDepartments(tx)).find((department) => department.active);
  const department =
    existing ??
    (await createDepartment(tx, {
      name: "Test floor department",
      orderStart: "table",
    }));
  return createServiceZone(tx, { ...input, departmentId: department.id });
}
