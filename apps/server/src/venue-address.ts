import { eq } from "drizzle-orm";
import { locations, type Transaction } from "@waitron/db";
import type { ReceiptConfig } from "@waitron/layouts";

export interface LocationAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
}

/**
 * The address as a receipt prints it: each street line, then the postal code and city on one line,
 * then the province unless it names the city. Blank parts are left out.
 */
export function addressLines(address: LocationAddress): string[] {
  const part = (value: string | null) => value?.trim() ?? "";
  const city = part(address.city);
  const province = part(address.province);
  return [
    part(address.addressLine1),
    part(address.addressLine2),
    [part(address.postalCode), city].filter(Boolean).join(" "),
    province.toLocaleLowerCase() === city.toLocaleLowerCase() ? "" : province,
  ].filter(Boolean);
}

/** The location's address lines, or none when the receipt's `printAddress` is `false`. */
export async function readReceiptAddress(
  tx: Transaction,
  locationId: string,
  receipt: Pick<ReceiptConfig, "printAddress">,
): Promise<string[]> {
  if (receipt.printAddress === false) return [];
  return readLocationAddress(tx, locationId);
}

/** The location's address lines whatever the receipt's switch says; none for an unknown location. */
export async function readLocationAddress(tx: Transaction, locationId: string): Promise<string[]> {
  const [row] = await tx
    .select({
      addressLine1: locations.addressLine1,
      addressLine2: locations.addressLine2,
      postalCode: locations.postalCode,
      city: locations.city,
      province: locations.province,
    })
    .from(locations)
    .where(eq(locations.id, locationId));
  return row === undefined ? [] : addressLines(row);
}
