import {
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import { type Database, locations } from "@waitron/db";
import type { CreateLocationDto } from "./dto/create-location.dto";
import type { UpdateLocationDto } from "./dto/update-location.dto";

@Injectable()
export class LocationsService {
  constructor(@Inject(DATABASE_TOKEN) private db: Database) {}

  async create(tenantId: string, dto: CreateLocationDto) {
    const [location] = await this.db
      .insert(locations)
      .values({
        tenantId,
        name: dto.name,
        address: dto.address,
        timezone: dto.timezone ?? "UTC",
        currency: dto.currency ?? "USD",
      })
      .returning();
    return location;
  }

  async findAll(tenantId: string) {
    return this.db
      .select()
      .from(locations)
      .where(eq(locations.tenantId, tenantId));
  }

  async findOne(tenantId: string, id: string) {
    const [location] = await this.db
      .select()
      .from(locations)
      .where(and(eq(locations.id, id), eq(locations.tenantId, tenantId)));
    if (!location) throw new NotFoundException("Location not found");
    return location;
  }

  async update(tenantId: string, id: string, dto: UpdateLocationDto) {
    await this.findOne(tenantId, id);
    const [updated] = await this.db
      .update(locations)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(locations.id, id), eq(locations.tenantId, tenantId)))
      .returning();
    return updated;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db
      .delete(locations)
      .where(and(eq(locations.id, id), eq(locations.tenantId, tenantId)));
  }
}
