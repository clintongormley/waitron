import type { Transaction } from "../client.js";
import { printers } from "../schema/printers.js";

export async function insertA4Printer(
  tx: Transaction,
  fields?: { name?: string; active?: boolean },
): Promise<string> {
  const [row] = await tx
    .insert(printers)
    .values({
      kind: "a4",
      name: fields?.name ?? "Office printer",
      active: fields?.active ?? true,
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
    })
    .returning({ id: printers.id });
  return row!.id;
}
