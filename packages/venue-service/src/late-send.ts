import { and, asc, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { departments } from "./schema/service.js";
import "./errors.js";

export async function readLateSendNeedsManager(
  tx: Transaction,
  departmentId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ lateSendNeedsManager: departments.lateSendNeedsManager })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.active, true)));
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
  return row.lateSendNeedsManager;
}

export async function listLateSendManagerDepartmentIds(tx: Transaction): Promise<string[]> {
  const rows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.active, true), eq(departments.lateSendNeedsManager, true)))
    .orderBy(asc(departments.id));
  return rows.map((row) => row.id);
}
