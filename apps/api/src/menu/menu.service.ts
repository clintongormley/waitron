import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { DATABASE_TOKEN } from "../database/database.provider";
import {
  type Database,
  menuCategories,
  menuItems,
  menuModifiers,
  locations,
} from "@waitron/db";
import type { CreateCategoryDto } from "./dto/create-category.dto";
import type { UpdateCategoryDto } from "./dto/update-category.dto";
import type { CreateItemDto } from "./dto/create-item.dto";
import type { UpdateItemDto } from "./dto/update-item.dto";
import type { CreateModifierDto } from "./dto/create-modifier.dto";
import type { UpdateModifierDto } from "./dto/update-modifier.dto";

@Injectable()
export class MenuService {
  constructor(@Inject(DATABASE_TOKEN) private db: Database) {}

  // --- Helpers ---

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

  private async assertCategoryBelongsToLocation(
    tenantId: string,
    locationId: string,
    categoryId: string,
  ) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    const [cat] = await this.db
      .select()
      .from(menuCategories)
      .where(
        and(
          eq(menuCategories.id, categoryId),
          eq(menuCategories.locationId, locationId),
        ),
      );
    if (!cat) throw new NotFoundException("Category not found");
    return cat;
  }

  private async assertItemBelongsToCategory(
    tenantId: string,
    locationId: string,
    categoryId: string,
    itemId: string,
  ) {
    await this.assertCategoryBelongsToLocation(tenantId, locationId, categoryId);
    const [item] = await this.db
      .select()
      .from(menuItems)
      .where(
        and(eq(menuItems.id, itemId), eq(menuItems.categoryId, categoryId)),
      );
    if (!item) throw new NotFoundException("Item not found");
    return item;
  }

  // --- Categories ---

  async createCategory(
    tenantId: string,
    locationId: string,
    dto: CreateCategoryDto,
  ) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    const [cat] = await this.db
      .insert(menuCategories)
      .values({ locationId, name: dto.name, sortOrder: dto.sortOrder ?? 0 })
      .returning();
    return cat;
  }

  async findCategories(tenantId: string, locationId: string) {
    await this.assertLocationBelongsToTenant(tenantId, locationId);
    return this.db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.locationId, locationId));
  }

  async findCategory(tenantId: string, locationId: string, id: string) {
    return this.assertCategoryBelongsToLocation(tenantId, locationId, id);
  }

  async updateCategory(
    tenantId: string,
    locationId: string,
    id: string,
    dto: UpdateCategoryDto,
  ) {
    await this.assertCategoryBelongsToLocation(tenantId, locationId, id);
    const [updated] = await this.db
      .update(menuCategories)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(menuCategories.id, id), eq(menuCategories.locationId, locationId)))
      .returning();
    return updated;
  }

  async removeCategory(tenantId: string, locationId: string, id: string) {
    await this.assertCategoryBelongsToLocation(tenantId, locationId, id);
    await this.db
      .delete(menuCategories)
      .where(and(eq(menuCategories.id, id), eq(menuCategories.locationId, locationId)));
  }

  // --- Items ---

  async createItem(
    tenantId: string,
    locationId: string,
    categoryId: string,
    dto: CreateItemDto,
  ) {
    await this.assertCategoryBelongsToLocation(tenantId, locationId, categoryId);
    const [item] = await this.db
      .insert(menuItems)
      .values({
        categoryId,
        name: dto.name,
        description: dto.description,
        priceCents: dto.priceCents,
      })
      .returning();
    return item;
  }

  async findItems(
    tenantId: string,
    locationId: string,
    categoryId: string,
  ) {
    await this.assertCategoryBelongsToLocation(tenantId, locationId, categoryId);
    return this.db
      .select()
      .from(menuItems)
      .where(eq(menuItems.categoryId, categoryId));
  }

  async findItem(
    tenantId: string,
    locationId: string,
    categoryId: string,
    id: string,
  ) {
    return this.assertItemBelongsToCategory(tenantId, locationId, categoryId, id);
  }

  async updateItem(
    tenantId: string,
    locationId: string,
    categoryId: string,
    id: string,
    dto: UpdateItemDto,
  ) {
    await this.assertItemBelongsToCategory(tenantId, locationId, categoryId, id);
    const [updated] = await this.db
      .update(menuItems)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(menuItems.id, id), eq(menuItems.categoryId, categoryId)))
      .returning();
    return updated;
  }

  async removeItem(
    tenantId: string,
    locationId: string,
    categoryId: string,
    id: string,
  ) {
    await this.assertItemBelongsToCategory(tenantId, locationId, categoryId, id);
    await this.db
      .delete(menuItems)
      .where(and(eq(menuItems.id, id), eq(menuItems.categoryId, categoryId)));
  }

  async toggleAvailability(
    tenantId: string,
    locationId: string,
    categoryId: string,
    id: string,
    available: boolean,
  ) {
    await this.assertItemBelongsToCategory(tenantId, locationId, categoryId, id);
    const [updated] = await this.db
      .update(menuItems)
      .set({ available, updatedAt: new Date() })
      .where(and(eq(menuItems.id, id), eq(menuItems.categoryId, categoryId)))
      .returning();
    return updated;
  }

  // --- Modifiers ---

  async createModifier(
    tenantId: string,
    locationId: string,
    categoryId: string,
    itemId: string,
    dto: CreateModifierDto,
  ) {
    await this.assertItemBelongsToCategory(tenantId, locationId, categoryId, itemId);
    const [modifier] = await this.db
      .insert(menuModifiers)
      .values({ itemId, name: dto.name, priceCents: dto.priceCents ?? 0 })
      .returning();
    return modifier;
  }

  async findModifiers(
    tenantId: string,
    locationId: string,
    categoryId: string,
    itemId: string,
  ) {
    await this.assertItemBelongsToCategory(tenantId, locationId, categoryId, itemId);
    return this.db
      .select()
      .from(menuModifiers)
      .where(eq(menuModifiers.itemId, itemId));
  }

  async updateModifier(
    tenantId: string,
    locationId: string,
    categoryId: string,
    itemId: string,
    id: string,
    dto: UpdateModifierDto,
  ) {
    await this.assertItemBelongsToCategory(tenantId, locationId, categoryId, itemId);
    const [mod] = await this.db
      .select()
      .from(menuModifiers)
      .where(and(eq(menuModifiers.id, id), eq(menuModifiers.itemId, itemId)));
    if (!mod) throw new NotFoundException("Modifier not found");
    const [updated] = await this.db
      .update(menuModifiers)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(menuModifiers.id, id), eq(menuModifiers.itemId, itemId)))
      .returning();
    return updated;
  }

  async removeModifier(
    tenantId: string,
    locationId: string,
    categoryId: string,
    itemId: string,
    id: string,
  ) {
    await this.assertItemBelongsToCategory(tenantId, locationId, categoryId, itemId);
    await this.db
      .delete(menuModifiers)
      .where(and(eq(menuModifiers.id, id), eq(menuModifiers.itemId, itemId)));
  }
}
