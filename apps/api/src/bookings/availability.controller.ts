import { Controller, Get, Param, Query, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { BookingsService } from "./bookings.service";

@Controller("locations/:locationId/availability")
@UseGuards(AuthGuard("jwt"))
export class AvailabilityController {
  constructor(private bookingsService: BookingsService) {}

  @Get()
  getAvailability(
    @Request() req: any,
    @Param("locationId") locationId: string,
    @Query("date") date: string,
    @Query("partySize") partySize: string,
  ) {
    return this.bookingsService.getAvailability(
      req.user.tenantId,
      locationId,
      date,
      parseInt(partySize, 10),
    );
  }
}
