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
import { LocationsService } from "./locations.service";
import { CreateLocationDto } from "./dto/create-location.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";

@Controller("locations")
@UseGuards(AuthGuard("jwt"))
export class LocationsController {
  constructor(private locationsService: LocationsService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateLocationDto) {
    return this.locationsService.create(req.user.tenantId, dto);
  }

  @Get()
  findAll(@Request() req: any) {
    return this.locationsService.findAll(req.user.tenantId);
  }

  @Get(":id")
  findOne(@Request() req: any, @Param("id") id: string) {
    return this.locationsService.findOne(req.user.tenantId, id);
  }

  @Patch(":id")
  update(
    @Request() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locationsService.update(req.user.tenantId, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Request() req: any, @Param("id") id: string) {
    return this.locationsService.remove(req.user.tenantId, id);
  }
}
