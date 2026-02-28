export class UpdateTicketStatusDto {
  status: "pending" | "in_progress" | "ready" | "bumped";
}
