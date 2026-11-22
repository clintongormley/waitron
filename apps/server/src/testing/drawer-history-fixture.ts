import { finishDrawerClose, saveDrawerCount, type Transaction } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { decimal } from "@waitron/shared";

export async function seedFinishedDrawer(
  tx: Transaction,
  fields: { nodeId: string; personId: string; recordedAt: string },
) {
  const printer = await createPrinter(tx, {
    name: "History drawer",
    transport: "network_tcp",
    host: "history-drawer.test",
    hasCashDrawer: true,
  });
  const actor = { ...fields, printerId: printer.id, deviceId: null };
  const count = await saveDrawerCount(tx, actor, {
    startSequence: 0,
    counted: decimal("8.00"),
  });
  return finishDrawerClose(tx, actor, {
    firstCountId: count.first.id,
    confirmSequence: count.confirmSequence,
    amountLeft: decimal("0.00"),
  });
}
