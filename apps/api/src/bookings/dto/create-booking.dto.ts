export class CreateBookingDto {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  partySize: number;
  datetime: string; // ISO 8601
  durationMinutes?: number;
  notes?: string;
}
