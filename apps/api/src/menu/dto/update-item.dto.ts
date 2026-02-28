export class UpdateItemDto {
  name?: Record<string, string>;
  description?: Record<string, string>;
  priceCents?: number;
  available?: boolean;
}
