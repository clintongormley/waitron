import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export function withTenantScope(
  tenantIdColumn: PgColumn,
  tenantId: string,
  ...conditions: (SQL | undefined)[]
): SQL {
  return and(eq(tenantIdColumn, tenantId), ...conditions)!;
}
