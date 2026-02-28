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
import { BookingsService } from "./bookings.service";
import { CreateBookingDto } from "./dto/create-booking.dto";
import { UpdateBookingStatusDto } from "./dto/update-booking-status.dto";

@Controller("locations/:locationId/bookings")
@UseGuards(AuthGuard("jwt"))
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  @Post()
  create(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Body() dto: CreateBookingDto,
  ) {
    return this.bookingsService.create(req.user.tenantId, locationId, dto);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Query("date") date?: string,
  ) {
    return this.bookingsService.findAll(req.user.tenantId, locationId, date);
  }

  @Get(":id")
  findOne(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
  ) {
    return this.bookingsService.findOne(req.user.tenantId, locationId, id);
  }

  @Patch(":id/status")
  updateStatus(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookingsService.updateStatus(
      req.user.tenantId,
      locationId,
      id,
      dto,
    );
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Param("id") id: string,
  ) {
    return this.bookingsService.remove(req.user.tenantId, locationId, id);
  }
}
