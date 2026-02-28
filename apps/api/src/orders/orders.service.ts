import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import {
  type Database,
  orders,
  orderItems,
  menuItems,
  menuModifiers,
  locations,
} from "@waitron/db";
import type { CreateOrderDto } from "./dto/create-order.dto";
import type { UpdateOrderStatusDto } from "./dto/update-order-status.dto";

@Injectable()
export class OrdersService {
  constructor(@Inject(DATABASE_TOKEN) private db: Database) {}

  private async assertLocationBelongsToTenant(
    tenantId: string,
    locationId: string,
  ) {
    const [loc] = await this.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)));
    if (!loc) throw new NotFoundException("Location not found");
    return loc;
  }

  private async assertOrderBelongsToLocation(
    tenantId: string,
    locationId: string,
    orderId: string,
  ) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.locationId, locationId)));
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  async create(tenantId: string, locationId: string, dto: CreateOrderDto) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);

    // Snapshot prices for each line item
    const menuItemIds = dto.items.map((i) => i.menuItemId);
    const allModifierIds = dto.items.flatMap((i) => i.modifierIds ?? []);

    const [fetchedItems, fetchedModifiers] = await Promise.all([
      this.db
        .select()
        .from(menuItems)
        .where(inArray(menuItems.id, menuItemIds)),
      allModifierIds.length > 0
        ? this.db
            .select()
            .from(menuModifiers)
            .where(inArray(menuModifiers.id, allModifierIds))
        : Promise.resolve([]),
    ]);

    const itemMap = new Map(fetchedItems.map((i) => [i.id, i]));
    const modifierMap = new Map(fetchedModifiers.map((m) => [m.id, m]));

    let totalCents = 0;
    const lineItems: {
      menuItemId: string;
      modifierIds: string[];
      quantity: number;
      unitPriceCents: number;
      notes?: string;
    }[] = [];

    for (const line of dto.items) {
      const item = itemMap.get(line.menuItemId);
      if (!item) throw new NotFoundException(`Menu item ${line.menuItemId} not found`);

      const modifierTotal = (line.modifierIds ?? []).reduce((sum, mid) => {
        const mod = modifierMap.get(mid);
        return sum + (mod?.priceCents ?? 0);
      }, 0);

      const unitPriceCents = item.priceCents + modifierTotal;
      totalCents += unitPriceCents * line.quantity;

      lineItems.push({
        menuItemId: line.menuItemId,
        modifierIds: line.modifierIds ?? [],
        quantity: line.quantity,
        unitPriceCents,
        notes: line.notes,
      });
    }

    const [order] = await this.db
      .insert(orders)
      .values({
        locationId,
        tableId: dto.tableId ?? null,
        type: dto.type,
        customerName: dto.customerName,
        totalCents,
      })
      .returning();

    const insertedItems = await this.db
      .insert(orderItems)
      .values(lineItems.map((l) => ({ ...l, orderId: order.id })))
      .returning();

    return { ...order, items: insertedItems };
  }

  async findAll(tenantId: string, locationId: string, status?: string) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);

    const conditions = [eq(orders.locationId, locationId)];
    if (status) {
      conditions.push(eq(orders.status, status as any));
    }

    return this.db
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(orders.createdAt);
  }

  async findOne(tenantId: string, locationId: string, id: string) {
    const order = await this.assertOrderBelongsToLocation(
      tenantId,
      locationId,
      id,
    );
    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    return { ...order, items };
  }

  async updateStatus(
    tenantId: string,
    locationId: string,
    id: string,
    dto: UpdateOrderStatusDto,
  ) {
    await this.assertOrderBelongsToLocation(tenantId, locationId, id);
    const [updated] = await this.db
      .update(orders)
      .set({ status: dto.status, updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.locationId, locationId)))
      .returning();
    return updated;
  }
}
