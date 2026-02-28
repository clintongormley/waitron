import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { KitchenService } from "./kitchen.service";
import { KitchenGateway } from "./kitchen.gateway";
import { CreateStationDto } from "./dto/create-station.dto";
import { UpdateTicketStatusDto } from "./dto/update-ticket-status.dto";

@Controller("locations/:locationId/kitchen")
@UseGuards(AuthGuard("jwt"))
export class KitchenController {
  constructor(
    private kitchenService: KitchenService,
    private kitchenGateway: KitchenGateway,
  ) {}

  // ── Stations ────────────────────────────────────────────

  @Post("stations")
  createStation(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Body() dto: CreateStationDto,
  ) {
    return this.kitchenService.createStation(
      req.user.tenantId,
      locationId,
      dto,
    );
  }

  @Get("stations")
  findStations(
    @Request() req: any,
    @Param("locationId") locationId: string,
  ) {
    return this.kitchenService.findStations(req.user.tenantId, locationId);
  }

  @Delete("stations/:stationId")
  @HttpCode(204)
  removeStation(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("stationId") stationId: string,
  ) {
    return this.kitchenService.removeStation(
      req.user.tenantId,
      locationId,
      stationId,
    );
  }

  @Post("stations/:stationId/items/:menuItemId")
  @HttpCode(204)
  assignItemToStation(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("stationId") stationId: string,
    @Param("menuItemId") menuItemId: string,
  ) {
    return this.kitchenService.assignItemToStation(
      req.user.tenantId,
      locationId,
      stationId,
      menuItemId,
    );
  }

  // ── Tickets ────────────────────────────────────────────

  @Get("tickets")
  findTickets(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Query("station") station?: string,
    @Query("status") status?: string,
  ) {
    return this.kitchenService.findTickets(
      req.user.tenantId,
      locationId,
      station,
      status,
    );
  }

  @Patch("tickets/:ticketId/status")
  async updateTicketStatus(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("ticketId") ticketId: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    const ticket = await this.kitchenService.updateTicketStatus(
      req.user.tenantId,
      locationId,
      ticketId,
      dto,
    );

    // Emit real-time event
    if (dto.status === "in_progress") {
      this.kitchenGateway.emitTicketUpdated("ticket.started", ticket);
    } else if (dto.status === "ready") {
      this.kitchenGateway.emitTicketUpdated("ticket.ready", ticket);
      await this.kitchenService.maybeCompleteOrder(ticket.orderId);
    }

    return ticket;
  }
}
