import { Inject, Injectable } from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import { type Database, tenants, users, locations, orders, bookings } from "@waitron/db";

@Injectable()
export class AdminService {
  constructor(@Inject(DATABASE_TOKEN) private db: Database) {}

  async listTenants() {
    return this.db.select().from(tenants).orderBy(tenants.createdAt);
  }

  async getTenant(tenantId: string) {
    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return tenant ?? null;
  }

  async getTenantUsers(tenantId: string) {
    return this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .orderBy(users.createdAt);
  }

  async getStats() {
    const [[{ tenantCount }], [{ userCount }], [{ locationCount }], [{ orderCount }], [{ bookingCount }]] =
      await Promise.all([
        this.db.select({ tenantCount: count() }).from(tenants),
        this.db.select({ userCount: count() }).from(users),
        this.db.select({ locationCount: count() }).from(locations),
        this.db.select({ orderCount: count() }).from(orders),
        this.db.select({ bookingCount: count() }).from(bookings),
      ]);

    return {
      tenants: tenantCount,
      users: userCount,
      locations: locationCount,
      orders: orderCount,
      bookings: bookingCount,
    };
  }

  async deleteTenant(tenantId: string) {
    await this.db.delete(tenants).where(eq(tenants.id, tenantId));
  }
}
