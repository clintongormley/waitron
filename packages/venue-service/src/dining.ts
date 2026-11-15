import { eq } from "drizzle-orm";
import { chargesTakeawayVat } from "@waitron/country-packs";
import {
  departments,
  readTaxpayer,
  readVenueSettings,
  type Transaction,
} from "@waitron/db";
import { AppError, type Dining, type DiningPolicy } from "@waitron/shared";
import "./errors.js";

/** Whether the venue's region charges a different VAT class on food taken away. */
export async function venueChargesTakeawayVat(tx: Transaction): Promise<boolean> {
  const taxpayer = await readTaxpayer(tx);
  if (taxpayer === null) return false;
  return chargesTakeawayVat(taxpayer.country, (await readVenueSettings(tx)).doc.fiscalTerritory);
}

/** How a department sells, and which way a till-choice order starts. */
export async function departmentDining(
  tx: Transaction,
  departmentId: string,
): Promise<{ dining: DiningPolicy; startsAs: Dining }> {
  const [row] = await tx
    .select({
      dining: departments.dining,
      startsAs: departments.diningStartsAs,
    })
    .from(departments)
    .where(eq(departments.id, departmentId));
  if (row === undefined) throw new AppError("department.not_found", { departmentId });
  return row;
}
