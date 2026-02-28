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
import { CreateItemDto } from "./dto/create-item.dto";
import { UpdateItemDto } from "./dto/update-item.dto";

@Controller("locations/:locationId/menu-categories/:categoryId/menu-items")
@UseGuards(AuthGuard("jwt"))
export class MenuItemsController {
  constructor(private menuService: MenuService) {}

  @Post()
  create(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
    @Body() dto: CreateItemDto,
  ) {
    return this.menuService.createItem(req.user.tenantId, locationId, categoryId, dto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
  ) {
    return this.menuService.findItems(req.user.tenantId, locationId, categoryId);
  }

  @Get(":id")
  findOne(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
    @Param("id") id: string,
  ) {
    return this.menuService.findItem(req.user.tenantId, locationId, categoryId, id);
  }

  @Patch(":id")
  update(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
    @Param("id") id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.menuService.updateItem(req.user.tenantId, locationId, categoryId, id, dto);
  }

  @Patch(":id/availability")
  setAvailability(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
    @Param("id") id: string,
    @Body("available") available: boolean,
  ) {
    return this.menuService.toggleAvailability(req.user.tenantId, locationId, categoryId, id, available);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("categoryId") categoryId: string,
    @Param("id") id: string,
  ) {
    return this.menuService.removeItem(req.user.tenantId, locationId, categoryId, id);
  }
}
