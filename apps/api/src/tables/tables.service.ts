import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import { type Database, tables, locations } from "@waitron/db";
import type { CreateTableDto } from "./dto/create-table.dto";
import type { UpdateTableDto } from "./dto/update-table.dto";

@Injectable()
export class TablesService {
  constructor(@Inject(DATABASE_TOKEN) private db: Database) {}

  private async assertLocationBelongsToTenant(
    tenantId: string,
    locationId: string,
  ) {
    const [location] = await this.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)));
    if (!location) throw new NotFoundException("Location not found");
    return location;
  }

  async create(tenantId: string, locationId: string, dto: CreateTableDto) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    const [table] = await this.db
      .insert(tables)
      .values({ locationId, number: dto.number, capacity: dto.capacity })
      .returning();
    return table;
  }

  async findAll(tenantId: string, locationId: string) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    return this.db
      .select()
      .from(tables)
      .where(eq(tables.locationId, locationId));
  }

  async findOne(tenantId: string, locationId: string, id: string) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    const [table] = await this.db
      .select()
      .from(tables)
      .where(and(eq(tables.id, id), eq(tables.locationId, locationId)));
    if (!table) throw new NotFoundException("Table not found");
    return table;
  }

  async update(
    tenantId: string,
    locationId: string,
    id: string,
    dto: UpdateTableDto,
  ) {
    await this.findOne(tenantId, locationId, id);
    const [updated] = await this.db
      .update(tables)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(tables.id, id), eq(tables.locationId, locationId)))
      .returning();
    return updated;
  }

  async remove(tenantId: string, locationId: string, id: string) {
    await this.findOne(tenantId, locationId, id);
    await this.db
      .delete(tables)
      .where(and(eq(tables.id, id), eq(tables.locationId, locationId)));
  }

  async findByQrCodeId(qrCodeId: string) {
    const [table] = await this.db
      .select()
      .from(tables)
      .where(eq(tables.qrCodeId, qrCodeId));
    if (!table) throw new NotFoundException("Table not found");
    return table;
  }
}
