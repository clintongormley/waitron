export class UpdateTableDto {
  number?: string;
  capacity?: number;
  status?: "available" | "occupied" | "reserved" | "out_of_service";
}
