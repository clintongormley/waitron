import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { MenuService } from "./menu.service";
import { CreateModifierDto } from "./dto/create-modifier.dto";
import { UpdateModifierDto } from "./dto/update-modifier.dto";

@Controller(
  "locations/:locationId/menu-categories/:categoryId/menu-items/:itemId/modifiers",
)
@UseGuards(AuthGuard("jwt"))
export class MenuModifiersController {
  constructor(private menuService: MenuService) {}

  @Post()
  create(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
    @Param("itemId") itemId: string,
    @Body() dto: CreateModifierDto,
  ) {
    return this.menuService.createModifier(req.user.tenantId, locationId, categoryId, itemId, dto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.menuService.findModifiers(req.user.tenantId, locationId, categoryId, itemId);
  }

  @Patch(":id")
  update(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
    @Param("itemId") itemId: string,
    @Param("id") id: string,
    @Body() dto: UpdateModifierDto,
  ) {
    return this.menuService.updateModifier(req.user.tenantId, locationId, categoryId, itemId, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
    @Param("itemId") itemId: string,
    @Param("id") id: string,
  ) {
    return this.menuService.removeModifier(req.user.tenantId, locationId, categoryId, itemId, id);
  }
}
