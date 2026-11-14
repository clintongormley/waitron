import "./errors.js";
import { invalid } from "./bill-allocation.js";

export interface OutsideCardDetails {
  externalProvider?: "sumup" | "other";
  externalMachine?: string;
}

export function readOutsideCardDetails(
  input: { externalProvider?: unknown; externalMachine?: unknown },
  manual: boolean,
): OutsideCardDetails {
  const { externalProvider, externalMachine } = input;
  if (
    externalProvider !== undefined &&
    (!manual ||
      typeof externalProvider !== "string" ||
      (externalProvider !== "sumup" && externalProvider !== "other"))
  )
    throw invalid("externalProvider");
  if (externalMachine !== undefined && (!manual || typeof externalMachine !== "string"))
    throw invalid("externalMachine");
  return {
    ...(externalProvider === undefined ? {} : { externalProvider }),
    ...(typeof externalMachine === "string" && externalMachine.trim() !== ""
      ? { externalMachine: externalMachine.trim() }
      : {}),
  };
}

export function outsideCardDetails(input: {
  externalProvider?: "sumup" | "other" | null;
  externalMachine?: string | null;
}): OutsideCardDetails {
  return {
    ...(input.externalProvider == null ? {} : { externalProvider: input.externalProvider }),
    ...(input.externalMachine == null ? {} : { externalMachine: input.externalMachine }),
  };
}
