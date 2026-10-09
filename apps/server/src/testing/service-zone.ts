import { createDepartment, createServiceZone, listDepartments } from "@waitron/venue-service";
import type { Transaction } from "@waitron/db";
import type { TillConfig } from "../till-config.js";

export async function createZone(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
  input: { name: string; displayOrder?: number },
): Promise<{ id: string }> {
  const existing = (await listDepartments(tx, cfg)).find((department) => department.active);
  const department =
    existing ??
    (await createDepartment(tx, cfg, {
      name: "Test floor department",
      orderStart: "table",
    }));
  return createServiceZone(tx, cfg, { ...input, departmentId: department.id });
}
