export class OrderItemDto {
  menuItemId: string;
  modifierIds?: string[];
  quantity: number;
  notes?: string;
}

export class CreateOrderDto {
  tableId?: string;
  type: "dine_in" | "takeaway";
  customerName?: string;
  items: OrderItemDto[];
}
