import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, gte, lt, inArray, notInArray, sql } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import {
  type Database,
  bookings,
  bookingTables,
  tables,
  locations,
} from "@waitron/db";
import type { CreateBookingDto } from "./dto/create-booking.dto";
import type { UpdateBookingStatusDto } from "./dto/update-booking-status.dto";

type Table = typeof tables.$inferSelect;

@Injectable()
export class BookingsService {
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

  private async assertBookingBelongsToLocation(
    tenantId: string,
    locationId: string,
    bookingId: string,
  ) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    const [booking] = await this.db
      .select()
      .from(bookings)
      .where(
        and(eq(bookings.id, bookingId), eq(bookings.locationId, locationId)),
      );
    if (!booking) throw new NotFoundException("Booking not found");
    return booking;
  }

  // Returns table IDs already reserved during [startTime, endTime)
  private async getBookedTableIds(
    locationId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<string[]> {
    const booked = await this.db
      .select({ tableId: bookingTables.tableId })
      .from(bookingTables)
      .innerJoin(bookings, eq(bookingTables.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.locationId, locationId),
          notInArray(bookings.status, ["cancelled", "no_show"]),
          lt(bookings.datetime, endTime),
          // booking ends after slotStart: datetime + duration > startTime
          sql`${bookings.datetime} + (${bookings.durationMinutes}::text || ' minutes')::interval > ${startTime.toISOString()}::timestamptz`,
        ),
      );
    return booked.map((b) => b.tableId);
  }

  // Greedy: pick smallest available tables that satisfy partySize
  private pickTables(available: Table[], partySize: number): Table[] | null {
    const sorted = [...available].sort((a, b) => a.capacity - b.capacity);
    const selected: Table[] = [];
    let total = 0;
    for (const t of sorted) {
      if (total >= partySize) break;
      selected.push(t);
      total += t.capacity;
    }
    return total >= partySize ? selected : null;
  }

  async create(tenantId: string, locationId: string, dto: CreateBookingDto) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);

    const startTime = new Date(dto.datetime);
    const duration = dto.durationMinutes ?? 90;
    const endTime = new Date(startTime.getTime() + duration * 60000);

    const bookedIds = await this.getBookedTableIds(locationId, startTime, endTime);

    const allTables = await this.db
      .select()
      .from(tables)
      .where(eq(tables.locationId, locationId));

    const available = allTables.filter((t) => !bookedIds.includes(t.id));
    const assigned = this.pickTables(available, dto.partySize);

    if (!assigned) {
      throw new ConflictException(
        "No tables available for the requested time slot and party size",
      );
    }

    const [booking] = await this.db
      .insert(bookings)
      .values({
        locationId,
        customerName: dto.customerName,
        customerEmail: dto.customerEmail,
        customerPhone: dto.customerPhone,
        partySize: dto.partySize,
        datetime: startTime,
        durationMinutes: duration,
        notes: dto.notes,
      })
      .returning();

    await this.db
      .insert(bookingTables)
      .values(assigned.map((t) => ({ bookingId: booking.id, tableId: t.id })));

    return { ...booking, tables: assigned };
  }

  async findAll(tenantId: string, locationId: string, date?: string) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);

    const conditions = [eq(bookings.locationId, locationId)];
    if (date) {
      conditions.push(gte(bookings.datetime, new Date(`${date}T00:00:00Z`)));
      conditions.push(lt(bookings.datetime, new Date(`${date}T23:59:59.999Z`)));
    }

    return this.db
      .select()
      .from(bookings)
      .where(and(...conditions))
      .orderBy(bookings.datetime);
  }

  async findOne(tenantId: string, locationId: string, id: string) {
    const booking = await this.assertBookingBelongsToLocation(
      tenantId,
      locationId,
      id,
    );
    const assigned = await this.db
      .select({ tableId: bookingTables.tableId })
      .from(bookingTables)
      .where(eq(bookingTables.bookingId, id));
    return { ...booking, tableIds: assigned.map((a) => a.tableId) };
  }

  async updateStatus(
    tenantId: string,
    locationId: string,
    id: string,
    dto: UpdateBookingStatusDto,
  ) {
    await this.assertBookingBelongsToLocation(tenantId, locationId, id);
    const [updated] = await this.db
      .update(bookings)
      .set({ status: dto.status, updatedAt: new Date() })
      .where(and(eq(bookings.id, id), eq(bookings.locationId, locationId)))
      .returning();
    return updated;
  }

  async remove(tenantId: string, locationId: string, id: string) {
    await this.assertBookingBelongsToLocation(tenantId, locationId, id);
    await this.db
      .delete(bookings)
      .where(and(eq(bookings.id, id), eq(bookings.locationId, locationId)));
  }

  async getAvailability(
    tenantId: string,
    locationId: string,
    date: string,
    partySize: number,
  ) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);

    const allTables = await this.db
      .select()
      .from(tables)
      .where(eq(tables.locationId, locationId));

    // Fetch all active bookings for the day upfront
    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const dayBookings = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.locationId, locationId),
          notInArray(bookings.status, ["cancelled", "no_show"]),
          gte(bookings.datetime, dayStart),
          lt(bookings.datetime, dayEnd),
        ),
      );

    const bookingIds = dayBookings.map((b) => b.id);
    const assignments =
      bookingIds.length > 0
        ? await this.db
            .select()
            .from(bookingTables)
            .where(inArray(bookingTables.bookingId, bookingIds))
        : [];

    const defaultDuration = 90;
    const [y, m, d] = date.split("-").map(Number);

    // Slots: 09:00–21:30 UTC, every 30 min (26 slots)
    const slots: { time: string; available: boolean }[] = [];
    for (let i = 0; i < 26; i++) {
      const hour = 9 + Math.floor(i / 2);
      const minute = (i % 2) * 30;
      const slotStart = new Date(Date.UTC(y, m - 1, d, hour, minute));
      const slotEnd = new Date(slotStart.getTime() + defaultDuration * 60000);

      const bookedTableIds = new Set<string>();
      for (const b of dayBookings) {
        const bStart = new Date(b.datetime);
        const bEnd = new Date(bStart.getTime() + b.durationMinutes * 60000);
        if (bStart < slotEnd && bEnd > slotStart) {
          assignments
            .filter((a) => a.bookingId === b.id)
            .forEach((a) => bookedTableIds.add(a.tableId));
        }
      }

      const availableCapacity = allTables
        .filter((t) => !bookedTableIds.has(t.id))
        .reduce((sum, t) => sum + t.capacity, 0);

      slots.push({
        time: slotStart.toISOString(),
        available: availableCapacity >= partySize,
      });
    }

    return slots;
  }
}
