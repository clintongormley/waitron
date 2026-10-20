import {
  assertPaperFloorAllows,
  parseDeclaredHistory,
  projectDeclaredHistory,
} from "./paper-register-history.js";
import type { PaperAllocation } from "./paper-protocol.js";
export function knownPaperHistoryAllows(allocation: PaperAllocation, known: unknown): boolean {
  if (known === undefined) return true;
  try {
    const history = parseDeclaredHistory(known);
    const projection = projectDeclaredHistory(history, {
      scope: history.scope,
      sHighWater: 0,
      pHighWater: 0,
      sBurnFloor: 0,
      pBurnFloor: 0,
      currentHead: null,
      retainedHeads: [],
      originals: [],
      retiredBindings: [],
    });
    assertPaperFloorAllows(
      projection,
      allocation,
      allocation.source === "initial-paper" ? "initial-setup" : "recovery",
    );
    return true;
  } catch {
    return false;
  }
}
