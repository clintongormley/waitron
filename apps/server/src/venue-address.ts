import { readVenue, type Transaction } from "@waitron/db";
import type { ReceiptConfig } from "@waitron/layouts";

export interface VenueAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
}

/**
 * The address as a receipt prints it, in at most two lines: the street lines joined, then the postal
 * code and city with the province unless it names the city. Blank parts are left out.
 */
export function addressLines(address: VenueAddress): string[] {
  const part = (value: string | null) => value?.trim() ?? "";
  const city = part(address.city);
  const province = part(address.province);
  return [
    [part(address.addressLine1), part(address.addressLine2)],
    [
      [part(address.postalCode), city].filter(Boolean).join(" "),
      province.toLocaleLowerCase() === city.toLocaleLowerCase() ? "" : province,
    ],
  ]
    .map((parts) => parts.filter(Boolean).join(", "))
    .filter(Boolean);
}

/** The address lines a receipt prints: none when its `printAddress` is `false` or there is no address. */
export function receiptAddressLines(
  receipt: Pick<ReceiptConfig, "printAddress">,
  address: VenueAddress | undefined,
): string[] {
  return receipt.printAddress === false || address === undefined ? [] : addressLines(address);
}

export async function readReceiptAddress(
  tx: Transaction,
  receipt: Pick<ReceiptConfig, "printAddress">,
): Promise<string[]> {
  return receiptAddressLines(receipt, await readVenue(tx));
}

export async function readVenueAddress(tx: Transaction): Promise<string[]> {
  return addressLines(await readVenue(tx));
}
