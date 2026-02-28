export class UpdateOrderStatusDto {
  status: "pending" | "confirmed" | "preparing" | "ready" | "served" | "paid";
}
