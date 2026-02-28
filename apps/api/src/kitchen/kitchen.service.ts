import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import {
  type Database,
  kitchenStations,
  kitchenTickets,
  menuItemStations,
  orderItems,
  orders,
  locations,
} from "@waitron/db";
import type { CreateStationDto } from "./dto/create-station.dto";
import type { UpdateTicketStatusDto } from "./dto/update-ticket-status.dto";

@Injectable()
export class KitchenService {
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

  // ── Stations ────────────────────────────────────────────

  async createStation(
    tenantId: string,
    locationId: string,
    dto: CreateStationDto,
  ) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    const [station] = await this.db
      .insert(kitchenStations)
      .values({ locationId, name: dto.name, sortOrder: dto.sortOrder ?? 0 })
      .returning();
    return station;
  }

  async findStations(tenantId: string, locationId: string) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    return this.db
      .select()
      .from(kitchenStations)
      .where(eq(kitchenStations.locationId, locationId))
      .orderBy(kitchenStations.sortOrder);
  }

  async removeStation(tenantId: string, locationId: string, id: string) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    const [station] = await this.db
      .select()
      .from(kitchenStations)
      .where(
        and(eq(kitchenStations.id, id), eq(kitchenStations.locationId, locationId)),
      );
    if (!station) throw new NotFoundException("Station not found");
    await this.db.delete(kitchenStations).where(eq(kitchenStations.id, id));
  }

  // Assign a menu item to a station
  async assignItemToStation(
    tenantId: string,
    locationId: string,
    stationId: string,
    menuItemId: string,
  ) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    await this.db
      .insert(menuItemStations)
      .values({ menuItemId, stationId })
      .onConflictDoNothing();
  }

  // ── Tickets ────────────────────────────────────────────

  // Called when an order is confirmed — creates tickets grouped by station
  async createTicketsForOrder(orderId: string) {
    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const menuItemIds = items.map((i) => i.menuItemId);
    if (menuItemIds.length === 0) return [];

    const assignments = await this.db
      .select()
      .from(menuItemStations)
      .where(inArray(menuItemStations.menuItemId, menuItemIds));

    // Group by station — one ticket per station
    const stationIds = [...new Set(assignments.map((a) => a.stationId))];
    if (stationIds.length === 0) return [];

    const tickets = await this.db
      .insert(kitchenTickets)
      .values(stationIds.map((stationId) => ({ orderId, stationId })))
      .returning();

    return tickets;
  }

  async findTickets(
    tenantId: string,
    locationId: string,
    stationId?: string,
    status?: string,
  ) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);

    // Get all station IDs for this location
    const stations = await this.db
      .select()
      .from(kitchenStations)
      .where(eq(kitchenStations.locationId, locationId));

    const locationStationIds = stations.map((s) => s.id);
    if (locationStationIds.length === 0) return [];

    // Filter to requested station if provided, else all stations
    const targetStationIds =
      stationId && locationStationIds.includes(stationId)
        ? [stationId]
        : locationStationIds;

    const conditions = [inArray(kitchenTickets.stationId, targetStationIds)];
    if (status) {
      conditions.push(eq(kitchenTickets.status, status as any));
    }

    return this.db
      .select()
      .from(kitchenTickets)
      .where(and(...conditions))
      .orderBy(kitchenTickets.priority, kitchenTickets.createdAt);
  }

  async updateTicketStatus(
    tenantId: string,
    locationId: string,
    ticketId: string,
    dto: UpdateTicketStatusDto,
  ) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);

    const [ticket] = await this.db
      .select()
      .from(kitchenTickets)
      .where(eq(kitchenTickets.id, ticketId));
    if (!ticket) throw new NotFoundException("Ticket not found");

    const now = new Date();
    const updates: Record<string, any> = { status: dto.status, updatedAt: now };
    if (dto.status === "in_progress") updates.startedAt = now;
    if (dto.status === "ready" || dto.status === "bumped") updates.completedAt = now;

    const [updated] = await this.db
      .update(kitchenTickets)
      .set(updates)
      .where(eq(kitchenTickets.id, ticketId))
      .returning();

    return updated;
  }

  // Check if all tickets for an order are ready/bumped
  async areAllTicketsComplete(orderId: string): Promise<boolean> {
    const tickets = await this.db
      .select()
      .from(kitchenTickets)
      .where(eq(kitchenTickets.orderId, orderId));

    if (tickets.length === 0) return false;
    return tickets.every(
      (t) => t.status === "ready" || t.status === "bumped",
    );
  }

  // Advance the parent order to 'ready' when all tickets are complete
  async maybeCompleteOrder(orderId: string) {
    const complete = await this.areAllTicketsComplete(orderId);
    if (!complete) return;

    await this.db
      .update(orders)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(orders.id, orderId));
  }
}
