import { eq } from "drizzle-orm";
import { deviceProfiles, type StoredPrinterLists } from "../schema/device-profiles.js";
import type { Transaction } from "../client.js";
import { printers } from "../schema/printers.js";

type A4FixtureFields = Partial<
  Pick<
    typeof printers.$inferInsert,
    | "id"
    | "name"
    | "active"
    | "host"
    | "port"
    | "resourcePath"
    | "documentFormat"
    | "supportedFormats"
    | "media"
    | "resolutionDpi"
    | "agentId"
  >
>;

export async function insertA4Printer(
  tx: Transaction,
  fields: A4FixtureFields = {},
): Promise<string> {
  const [row] = await tx
    .insert(printers)
    .values({
      kind: "a4",
      name: "Office printer",
      transport: "ipp",
      host: "10.255.0.4",
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
      paperWidth: null,
      resolution: null,
      picksUpReceipts: false,
      picksUpPaymentSlips: false,
      ...fields,
    })
    .returning({ id: printers.id });
  return row!.id;
}

/** Replaces only the named fixture roles, including states the profile writer would refuse. */
export async function setPrinterListsForTest(
  tx: Transaction,
  profileId: string,
  lists: StoredPrinterLists,
): Promise<void> {
  const [profile] = await tx
    .select({ lists: deviceProfiles.printerLists })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profileId));
  await tx
    .update(deviceProfiles)
    .set({ printerLists: { ...profile!.lists, ...lists } })
    .where(eq(deviceProfiles.id, profileId));
}
