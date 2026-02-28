import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import {
  type Database,
  tables,
  locations,
  menuCategories,
  menuItems,
} from "@waitron/db";
import { OrdersService } from "../orders/orders.service";
import type { CreateOrderDto } from "../orders/dto/create-order.dto";

@Controller()
export class PublicController {
  constructor(
    @Inject(DATABASE_TOKEN) private db: Database,
    private ordersService: OrdersService,
  ) {}

  private async resolveLocation(locationId: string) {
    const [location] = await this.db
      .select()
      .from(locations)
      .where(eq(locations.id, locationId));
    if (!location) throw new NotFoundException("Location not found");
    return location;
  }

  private async getMenuForLocation(locationId: string) {
    const categories = await this.db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.locationId, locationId))
      .orderBy(menuCategories.sortOrder);

    const categoryIds = categories.map((c) => c.id);
    const allItems =
      categoryIds.length > 0
        ? await this.db
            .select()
            .from(menuItems)
            .where(inArray(menuItems.categoryId, categoryIds))
        : [];

    return categories.map((cat) => ({
      category: cat,
      items: allItems.filter(
        (item) => item.categoryId === cat.id && item.available,
      ),
    }));
  }

  // ── Dine-in via QR code ────────────────────────────────────

  @Get("table/:qrId")
  async resolveTable(@Param("qrId") qrId: string) {
    const [table] = await this.db
      .select()
      .from(tables)
      .where(eq(tables.qrCodeId, qrId));
    if (!table) throw new NotFoundException("Table not found");

    const location = await this.resolveLocation(table.locationId);
    const menu = await this.getMenuForLocation(table.locationId);

    return { table, location, menu };
  }

  @Post("table/:qrId/orders")
  async createTableOrder(
    @Param("qrId") qrId: string,
    @Body() dto: CreateOrderDto,
  ) {
    const [table] = await this.db
      .select()
      .from(tables)
      .where(eq(tables.qrCodeId, qrId));
    if (!table) throw new NotFoundException("Table not found");

    const location = await this.resolveLocation(table.locationId);
    return this.ordersService.create(location.tenantId, location.id, {
      ...dto,
      tableId: table.id,
      type: "dine_in",
    });
  }

  // ── Takeaway via locationId ────────────────────────────────

  @Get("public/:locationId/menu")
  async getTakeawayMenu(@Param("locationId") locationId: string) {
    const location = await this.resolveLocation(locationId);
    const menu = await this.getMenuForLocation(locationId);
    return { location, menu };
  }

  @Post("public/:locationId/orders")
  async createTakeawayOrder(
    @Param("locationId") locationId: string,
    @Body() dto: CreateOrderDto,
  ) {
    const location = await this.resolveLocation(locationId);
    return this.ordersService.create(location.tenantId, locationId, {
      ...dto,
      type: "takeaway",
    });
  }
}
