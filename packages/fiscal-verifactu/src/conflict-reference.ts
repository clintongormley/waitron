import type { ActiveConflict, RecoveryConflictRef } from "./conflict-types.js";

export function conflictReference(conflict: ActiveConflict): RecoveryConflictRef {
  return "lookupId" in conflict
    ? { lookupId: conflict.lookupId, sifId: conflict.sifId }
    : { registroId: conflict.registroId, caseId: conflict.caseId, sifId: conflict.sifId };
}

export function conflictSourceId(conflict: RecoveryConflictRef): string {
  return "lookupId" in conflict
    ? JSON.stringify(["lookup-conflict", conflict.sifId, conflict.lookupId])
    : JSON.stringify(["conflict", conflict.sifId, conflict.registroId, conflict.caseId]);
}
