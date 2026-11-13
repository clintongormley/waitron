export function remedyRequestBody(request: {
  kind: string;
  caseId: string;
  recordId: string;
  actionKey: string;
  reason: string;
  facts?: Record<string, unknown>;
}) {
  const { kind, caseId, recordId, actionKey, reason, facts } = request;
  return {
    kind,
    caseId,
    registroId: recordId,
    actionKey,
    reason,
    ...(facts === undefined ? {} : { facts }),
  };
}
