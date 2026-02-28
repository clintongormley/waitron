import { Module } from "@nestjs/common";
import { MenuCategoriesController } from "./menu-categories.controller";
import { MenuItemsController } from "./menu-items.controller";
import { MenuModifiersController } from "./menu-modifiers.controller";
import { MenuService } from "./menu.service";

@Module({
  controllers: [MenuCategoriesController, MenuItemsController, MenuModifiersController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
