export function remedyRequestBody(request: {
  kind: string;
  caseRecordId: string;
  recordId: string;
  actionKey: string;
  reason: string;
  facts?: Record<string, unknown>;
}) {
  const { kind, caseRecordId, recordId, actionKey, reason, facts } = request;
  return {
    kind,
    caseRegistroId: caseRecordId,
    registroId: recordId,
    actionKey,
    reason,
    ...(facts === undefined ? {} : { facts }),
  };
}
