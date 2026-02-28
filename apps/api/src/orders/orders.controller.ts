import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { OrdersService } from "./orders.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";

@Controller("locations/:locationId/orders")
@UseGuards(AuthGuard("jwt"))
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  create(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.create(req.user.tenantId, locationId, dto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Query("status") status?: string,
  ) {
    return this.ordersService.findAll(req.user.tenantId, locationId, status);
  }

  @Get(":id")
  findOne(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
  ) {
    return this.ordersService.findOne(req.user.tenantId, locationId, id);
  }

  @Patch(":id/status")
  updateStatus(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(
      req.user.tenantId,
      locationId,
      id,
      dto,
    );
  }
}
