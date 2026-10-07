import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, id, json, label, newId, table } from "./columns.js";
import { locations } from "./tenants.js";

export const pagePrinterFormat = enumType(["application/pdf", "image/pwg-raster", "image/urf"]);
export const pagePrinterMedia = enumType(["iso_a4_210x297mm", "na_letter_8.5x11in"]);

export const pagePrinters = table(
  "page_printers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    name: label("name").notNull(),
    host: label("host").notNull(),
    port: count("port").notNull(),
    resourcePath: label("resource_path").notNull(),
    documentFormat: pagePrinterFormat("document_format").notNull(),
    supportedFormats: json<string[]>("supported_formats").notNull(),
    media: pagePrinterMedia("media").notNull(),
    resolutionDpi: count("resolution_dpi").notNull(),
    active: flag("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("page_printers_endpoint_uq").on(t.locationId, t.host, t.port, t.resourcePath),
    check("page_printers_format_ck", enumCheck(t.documentFormat)),
    check("page_printers_media_ck", enumCheck(t.media)),
    check("page_printers_port_ck", sql`${t.port} between 1 and 65535`),
    check("page_printers_resolution_ck", sql`${t.resolutionDpi} > 0`),
  ],
);
