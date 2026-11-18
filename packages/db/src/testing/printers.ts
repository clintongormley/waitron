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
      transport: "network_tcp",
      host: "10.255.0.4",
    })
    .returning({ id: printers.id });
  return row!.id;
}
