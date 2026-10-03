import { sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { SALE_SOURCES, SOURCES } from "@waitron/shared";
import { enumCheck, enumType } from "./columns.js";

export const sourceColumn = enumType(SOURCES);
export const saleSourceColumn = enumType(SALE_SOURCES);

/**
 * The source is in its column's list, and a device is named exactly when the source is `device`.
 * A plain array, not `as const`: drizzle's extra-config callback is typed to return a mutable one.
 */
export const originChecks = (tableName: string, source: AnyColumn, deviceId: AnyColumn) => [
  check(`${tableName}_source_ck`, enumCheck(source)),
  check(`${tableName}_source_device_ck`, sql`(${source} = 'device') = (${deviceId} is not null)`),
];
