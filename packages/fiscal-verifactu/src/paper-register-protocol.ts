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
