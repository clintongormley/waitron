import { readVenue } from "@waitron/db";
import type { Transaction } from "@waitron/db";

export async function operationDescriptionFor(tx: Transaction, supplied?: string): Promise<string> {
  if (supplied !== undefined) return supplied;
  return (await readVenue(tx)).operationDescription;
}
