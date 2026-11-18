import { eq } from "drizzle-orm";
import { deviceProfiles, type Transaction } from "@waitron/db";

type Target =
  { printerId: string; pagePrinterId?: never } | { pagePrinterId: string; printerId?: never };

/** Appends a receipt or page printer to a profile's invoice list, optionally as its default. */
export async function listInvoicePrinter(
  tx: Transaction,
  input: { profileId: string; isDefault: boolean } & Target,
): Promise<void> {
  const [profile] = await tx
    .select({ lists: deviceProfiles.printerLists })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, input.profileId));
  const { lists } = profile!;
  const id = input.printerId ?? input.pagePrinterId;
  await tx
    .update(deviceProfiles)
    .set({
      printerLists: {
        ...lists,
        invoice: {
          ids: [...(lists.invoice?.ids ?? []), id],
          defaultId: input.isDefault ? id : (lists.invoice?.defaultId ?? null),
        },
      },
    })
    .where(eq(deviceProfiles.id, input.profileId));
}
