import { Controller, Get, Inject, NotFoundException, Param } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import {
  type Database,
  tables,
  locations,
  menuCategories,
  menuItems,
} from "@waitron/db";

@Controller("table")
export class PublicController {
  constructor(@Inject(DATABASE_TOKEN) private db: Database) {}

  @Get(":qrId")
  async resolveTable(@Param("qrId") qrId: string) {
    const [table] = await this.db
      .select()
      .from(tables)
      .where(eq(tables.qrCodeId, qrId));
    if (!table) throw new NotFoundException("Table not found");

    const [location] = await this.db
      .select()
      .from(locations)
      .where(eq(locations.id, table.locationId));

    const categories = await this.db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.locationId, table.locationId))
      .orderBy(menuCategories.sortOrder);

    const categoryIds = categories.map((c) => c.id);
    const allItems =
      categoryIds.length > 0
        ? await this.db
            .select()
            .from(menuItems)
            .where(inArray(menuItems.categoryId, categoryIds))
        : [];

    const menu = categories.map((cat) => ({
      category: cat,
      items: allItems.filter(
        (item) => item.categoryId === cat.id && item.available,
      ),
    }));

    return { table, location, menu };
  }
}
