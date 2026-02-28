import { Module } from "@nestjs/common";
import { BookingsController } from "./bookings.controller";
import { AvailabilityController } from "./availability.controller";
import { BookingsService } from "./bookings.service";

@Module({
  controllers: [BookingsController, AvailabilityController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
