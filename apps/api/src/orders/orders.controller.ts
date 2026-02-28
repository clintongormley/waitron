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
import { KitchenService } from "../kitchen/kitchen.service";
import { KitchenGateway } from "../kitchen/kitchen.gateway";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";

@Controller("locations/:locationId/orders")
@UseGuards(AuthGuard("jwt"))
export class OrdersController {
  constructor(
    private ordersService: OrdersService,
    private kitchenService: KitchenService,
    private kitchenGateway: KitchenGateway,
  ) {}

  @Post()
  async create(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Body() dto: CreateOrderDto,
  ) {
    const order = await this.ordersService.create(
      req.user.tenantId,
      locationId,
      dto,
    );
    this.kitchenGateway.emitOrderCreated(order);
    return order;
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
  async updateStatus(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const order = await this.ordersService.updateStatus(
      req.user.tenantId,
      locationId,
      id,
      dto,
    );
    this.kitchenGateway.emitOrderUpdated(order);

    // When order is confirmed, generate kitchen tickets
    if (dto.status === "confirmed") {
      const tickets = await this.kitchenService.createTicketsForOrder(id);
      for (const ticket of tickets) {
        this.kitchenGateway.emitTicketCreated(ticket);
      }
    }

    return order;
  }
}
