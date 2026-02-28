export class CreatePaymentIntentDto {
  orderId: string;
  locationId: string;
  currency?: string;
  provider?: "stripe" | "square" | "mock";
}
