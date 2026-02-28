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
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

@Controller("locations/:locationId/menu-categories")
@UseGuards(AuthGuard("jwt"))
export class MenuCategoriesController {
  constructor(private menuService: MenuService) {}

  @Post()
  create(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.menuService.createCategory(req.user.tenantId, locationId, dto);
  }

  @Get()
  findAll(@Request() req: any, @Param("locationId") locationId: string) {
    return this.menuService.findCategories(req.user.tenantId, locationId);
  }

  @Get(":id")
  findOne(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
  ) {
    return this.menuService.findCategory(req.user.tenantId, locationId, id);
  }

  @Patch(":id")
  update(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.menuService.updateCategory(req.user.tenantId, locationId, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
  ) {
    return this.menuService.removeCategory(req.user.tenantId, locationId, id);
  }
}
