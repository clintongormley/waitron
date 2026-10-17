import type { Transaction } from "@waitron/db";
import type { OperationBinding } from "./operation-authority.js";
import type { ModuleOperationHost } from "./operation-preparation.js";

export interface InitialSetupContext {
  readonly attemptId: string;
  readonly binding: OperationBinding;
  readonly administratorId: string;
  readonly country: string;
  readonly taxId: string;
  readonly environment: "production" | "preproduction";
  readonly recipientVenueId: string;
  readonly bases: readonly { readonly code: string; readonly purpose: string }[];
  /** The host's frozen public request, required after candidate selection. Never uploaded context. */
  readonly request?: unknown;
}

export interface InitialSetupImport {
  readonly input: unknown;
  readonly summary: unknown;
}

export interface InitialSetupCommandActions {
  output(line: string): void;
  prompt(question: string): Promise<string>;
  prepare(proposal: unknown): Promise<unknown>;
  select(proposal: unknown): Promise<unknown>;
}

export type InitialSetupCommandResult =
  | { readonly status: "ready"; readonly input: unknown }
  | { readonly status: "waiting" }
  | { readonly status: "cancelled" };

export interface InitialSetupContribution {
  commandResume?(
    context: InitialSetupContext,
    actions: InitialSetupCommandActions,
  ): Promise<InitialSetupCommandResult>;
  resume?(context: InitialSetupContext, input: unknown, documentBinding: string): Promise<void>;
  commandRecoveryDocument?(
    context: InitialSetupContext,
    imported: InitialSetupImport,
    document: {
      readonly key: { readonly nodeId: string; readonly name: string; readonly secret: string };
      readonly identity: { readonly taxpayerName: string; readonly venueName: string };
      readonly locale: "en" | "es";
    },
  ): Promise<{ readonly bytes: Uint8Array; readonly statement: unknown }>;
  recoveryDocument?(
    context: InitialSetupContext,
    imported: InitialSetupImport,
    document: {
      readonly statement: unknown;
      readonly bindingDigest: string;
      readonly documentDigest: string;
      readonly stage: { readonly nodeId: string; readonly name: string };
      readonly identity: { readonly taxpayerName: string; readonly venueName: string };
    },
  ): unknown;
  command?(
    context: InitialSetupContext,
    actions: InitialSetupCommandActions,
  ): Promise<InitialSetupCommandResult>;
  localHistory?(
    tx: Transaction,
    environment: "production" | "preproduction" | null,
  ): Promise<unknown>;
  retainedAssignments?(evidence: unknown): {
    readonly keys: readonly string[];
    readonly positions: readonly { namespace: string; position: number }[];
  };

  assignmentPositions?(
    context: InitialSetupContext,
    input?: unknown,
  ): readonly { namespace: string; position: number }[];
  assignmentKeys?(context: InitialSetupContext, input?: unknown): readonly string[];
  resolutionEvidence?(): { files: readonly string[]; directories: readonly string[] };
  configure?(host: ModuleOperationHost): InitialSetupContribution;
  preparation?(context: InitialSetupContext, proposal: unknown): Promise<unknown>;
  /** A pending result stays unfrozen so the owner can finish waiting before choosing material. */
  pending?(request: unknown): boolean;
  candidates(context: InitialSetupContext, proposal: unknown): unknown;
  request(context: InitialSetupContext, validatedCandidates: unknown): unknown;
  inspect(context: InitialSetupContext, input: unknown): InitialSetupImport;
  enrol(context: InitialSetupContext, publicKey: unknown, comparison: unknown): unknown;
  confirmation(
    context: InitialSetupContext,
    imported: InitialSetupImport,
    statement: unknown,
  ): unknown;
  documentConfirmation?(
    context: InitialSetupContext,
    imported: InitialSetupImport,
    document: {
      readonly statement: unknown;
      readonly historyDigest: string;
      readonly documentDigest: string;
      readonly prior: unknown | null;
    },
  ): unknown;
  committed(tx: Transaction, context: InitialSetupContext, input: unknown): Promise<unknown | null>;
}
