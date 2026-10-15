import { and, count, eq } from "drizzle-orm";
import { deviceProfilePrinters, type Transaction } from "@waitron/db";

type Target =
  { printerId: string; pagePrinterId?: never } | { pagePrinterId: string; printerId?: never };

/** Appends a receipt or page printer to a profile's invoice list, optionally as its default. */
export async function listInvoicePrinter(
  tx: Transaction,
  input: { profileId: string; isDefault: boolean } & Target,
): Promise<void> {
  const [listed] = await tx
    .select({ n: count() })
    .from(deviceProfilePrinters)
    .where(
      and(
        eq(deviceProfilePrinters.deviceProfileId, input.profileId),
        eq(deviceProfilePrinters.role, "invoice"),
      ),
    );
  await tx.insert(deviceProfilePrinters).values({
    deviceProfileId: input.profileId,
    role: "invoice",
    printerId: input.printerId ?? null,
    pagePrinterId: input.pagePrinterId ?? null,
    position: listed?.n ?? 0,
    isDefault: input.isDefault,
  });
}
