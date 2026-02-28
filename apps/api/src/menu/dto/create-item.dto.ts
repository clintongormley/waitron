export class CreateItemDto {
  name: Record<string, string>;
  description?: Record<string, string>;
  priceCents: number;
}
