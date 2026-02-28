export class UpdateBookingStatusDto {
  status: "pending" | "confirmed" | "seated" | "cancelled" | "no_show";
}
