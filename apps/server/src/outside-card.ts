import type { OutsideCardDetails } from "@waitron/orders-sales/receipt-sale-types.js";
import "./errors.js";
import { invalid } from "./bill-allocation.js";

export type { OutsideCardDetails } from "@waitron/orders-sales/receipt-sale-types.js";

export function readOutsideCardDetails(
  input: { externalProvider?: unknown; externalMachine?: unknown },
  manual: boolean,
): OutsideCardDetails {
  const { externalProvider, externalMachine } = input;
  if (
    externalProvider !== undefined &&
    (!manual ||
      typeof externalProvider !== "string" ||
      (externalProvider !== "connected_account" && externalProvider !== "other"))
  )
    throw invalid("externalProvider");
  if (externalMachine !== undefined && (!manual || typeof externalMachine !== "string"))
    throw invalid("externalMachine");
  return {
    ...(externalProvider === undefined ? {} : { externalProvider }),
    externalMachine:
      typeof externalMachine === "string" && externalMachine.trim() !== ""
        ? externalMachine.trim()
        : undefined,
  };
}

export function outsideCardDetails(input: {
  externalProvider?: "connected_account" | "other" | null;
  externalMachine?: string | null;
}): OutsideCardDetails {
  return {
    ...(input.externalProvider == null ? {} : { externalProvider: input.externalProvider }),
    ...(input.externalMachine == null ? {} : { externalMachine: input.externalMachine }),
  };
}
