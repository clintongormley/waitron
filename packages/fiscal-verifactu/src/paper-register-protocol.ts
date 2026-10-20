export interface RegisterScope {
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: "production" | "preproduction";
}
export interface RegisterPosition {
  readonly sHighWater: number;
  readonly pHighWater: number;
}
export interface NamedNodeKey {
  readonly nodeId: string;
  readonly name: string;
  readonly secret: string;
}
export interface RegisterDocument {
  version: 2;
  kind: "waitron-register-document";
  route: "paper" | "cloud";
  paper: DeclaredRegisterHistory | null;
  cloudOriginals: readonly PublicOriginal[];
  nodeKeys: readonly NamedNodeKey[];
}
export interface PrintedPositionFields {
  readonly sPosition: string;
  readonly pPosition: string;
  readonly check: string;
}
export interface PrintedNodeFields {
  readonly encoding: "raw192" | "utf8";
  readonly value: string;
  readonly check: string;
}
export interface PrintedPositionBlock {
  readonly fields: PrintedPositionFields;
  readonly enteredCharacters: number;
  readonly displayedCharacters: number;
}
export interface PrintedNodeBlock {
  readonly fields: PrintedNodeFields;
  readonly enteredCharacters: number;
  readonly displayedCharacters: number;
}

export interface RegisterHead {
  readonly registerId: string;
  readonly revision: string;
  readonly digest: string;
}
export interface PublicOriginal {
  readonly kind: "signed-paper" | "cloud-receipt" | "declared-paper-history";
  readonly bytesBase64url: string;
  readonly digest: string;
}
export interface CurrentStatement {
  readonly currentRegisterConfirmed: true;
  readonly noParallelPaperAllocation: true;
  readonly confirmedAt: string;
}
export interface DeclaredReservation {
  readonly kind: "reserve";
  readonly allocation: import("./paper-protocol.js").PaperAllocation;
  readonly recipientVenueId: string;
  readonly binding: import("@waitron/module/src/operation-authority.js").OperationBinding;
  readonly reservedAt: string;
}
export interface DeclaredConsumption {
  readonly kind: "consume";
  readonly allocationId: string;
  readonly reservationDigest: string;
  readonly eventId: string;
  readonly operatorId: import("@waitron/module/src/operation-authority.js").OperationOperator;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly incidentEvidence: string;
  readonly consumedAt: string;
}
export type DeclaredRegisterEvent =
  | DeclaredReservation
  | DeclaredConsumption
  | {
      readonly kind: "retire" | "abandon" | "uncertain";
      readonly allocationId: string;
      readonly eventId: string;
      readonly reason: string;
      readonly createdAt: string;
    };
export interface DeclaredRegisterRevision extends RegisterPosition {
  readonly version: 2;
  readonly registerId: string;
  readonly scope: RegisterScope;
  readonly revision: string;
  readonly previousDigest: string;
  readonly createdAt: string;
  readonly events: readonly DeclaredRegisterEvent[];
}
export interface DeclaredBurnCheckpoint extends RegisterPosition {
  readonly version: 2;
  readonly kind: "declared-burn-checkpoint";
  readonly checkpointId: string;
  readonly scope: RegisterScope;
  readonly current: CurrentStatement;
  readonly completeHistoryUnavailable: true;
  readonly burnAllPrior: true;
  readonly createdAt: string;
}
interface DeclaredHistoryIdentity {
  readonly format: "waitron-paper-register";
  readonly version: 2;
  readonly integrity: "owner-declared";
  readonly registerId: string;
  readonly scope: RegisterScope;
  readonly revisions: readonly DeclaredRegisterRevision[];
  readonly originals: readonly PublicOriginal[];
}
export type DeclaredRegisterHistory = DeclaredHistoryIdentity &
  (
    | { readonly mode: "complete" }
    | { readonly mode: "checkpoint"; readonly checkpoint: DeclaredBurnCheckpoint }
  );
export interface KnownRegisterEvidence extends RegisterPosition {
  readonly scope: RegisterScope;
  readonly sBurnFloor: number;
  readonly pBurnFloor: number;
  readonly currentHead: RegisterHead | null;
  readonly retainedHeads: readonly RegisterHead[];
  readonly originals: readonly PublicOriginal[];
  readonly retiredBindings: readonly import("@waitron/module/src/operation-authority.js").OperationBinding[];
  readonly history?: DeclaredRegisterHistory;
}
export interface DeclaredRegisterOccupied {
  readonly allocation: import("./paper-protocol.js").PaperAllocation;
  readonly recipientVenueId: string;
  readonly binding: import("@waitron/module/src/operation-authority.js").OperationBinding;
  readonly state: "reserved" | "consumed" | "retired" | "abandoned" | "uncertain";
}
export interface RegisterProjection extends RegisterPosition {
  readonly mode: DeclaredRegisterHistory["mode"];
  readonly scope: RegisterScope;
  readonly head: RegisterHead;
  readonly heads: readonly RegisterHead[];
  readonly sBurnFloor: number;
  readonly pBurnFloor: number;
  readonly occupied: readonly DeclaredRegisterOccupied[];
  readonly originals: readonly PublicOriginal[];
  readonly retiredBindings: readonly import("@waitron/module/src/operation-authority.js").OperationBinding[];
  readonly nextS: number | null;
  readonly nextP: number | null;
  readonly completeHistory: boolean;
  readonly currentnessRequired: true;
  readonly history: DeclaredRegisterHistory;
}
