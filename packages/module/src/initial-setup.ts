import type { Transaction } from "@waitron/db";
import type { OperationBinding } from "./operation-authority.js";

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

export interface InitialSetupContribution {
  candidates(context: InitialSetupContext, proposal: unknown): unknown;
  request(context: InitialSetupContext, validatedCandidates: unknown): unknown;
  inspect(context: InitialSetupContext, input: unknown): InitialSetupImport;
  enrol(context: InitialSetupContext, publicKey: unknown, comparison: unknown): unknown;
  confirmation(
    context: InitialSetupContext,
    imported: InitialSetupImport,
    statement: unknown,
  ): unknown;
  committed(tx: Transaction, context: InitialSetupContext, input: unknown): Promise<unknown | null>;
}
