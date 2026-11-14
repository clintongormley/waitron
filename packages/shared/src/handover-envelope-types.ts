/**
 * `HANDOVER_KINDS` in `@waitron/handover` lists these at run time; its tests hold the two equal.
 */
export type HandoverKind =
  | "query"
  | "status"
  | "stepdown"
  | "final-state"
  | "acceptance"
  | "relinquishment"
  | "declaration"
  | "return-batch"
  | "return-receipt"
  | "return-clash-acceptance"
  | "health"
  | "backup-settings";

export type HandoverPurpose = `waitron.handover.${HandoverKind}.v1`;

export interface SignedHandoverEnvelope<B> {
  readonly purpose: HandoverPurpose;
  readonly signerNodeId: string;
  readonly body: B;
  readonly signature: string;
}
