import "./errors.js";
import { AppError } from "@waitron/shared";
import type { SiNo } from "@waitron/verifactu";
import { WAITRON_ID_SISTEMA } from "./software.js";

export const PRODUCER_PENDING: unique symbol = Symbol("producer pending");

export interface SoftwareProducer {
  readonly name: string;
  readonly nif: string;
}

export interface SoftwareIdentity {
  readonly name: string;
  readonly code: string;
  readonly onlyVerifactu: SiNo;
  readonly multipleTaxpayersPossible: SiNo;
  readonly multipleTaxpayersNow: SiNo;
  readonly producer: SoftwareProducer | typeof PRODUCER_PENDING;
}

export const SOFTWARE_IDENTITY: SoftwareIdentity = Object.freeze({
  name: "Waitron",
  code: WAITRON_ID_SISTEMA,
  onlyVerifactu: "S",
  multipleTaxpayersPossible: "N",
  multipleTaxpayersNow: "N",
  // PENDING: the owner's full name and NIF (A940 design §4 items h) and i), §11 Q1).
  producer: PRODUCER_PENDING,
});

declare const __WAITRON_HOUR_RELEASE__: unknown;

// Read the global directly, never through readHourRelease(): many test files mock that reader to
// hand the clock code a stamp, and a mocked stamp must not make a test run count as published.
function stampedCommit(): string | null {
  const value = typeof __WAITRON_HOUR_RELEASE__ === "undefined" ? null : __WAITRON_HOUR_RELEASE__;
  if (value === null || typeof value !== "object") return null;
  const commit = (value as { sourceCommit?: unknown }).sourceCommit;
  return typeof commit === "string" && /^[a-f0-9]{40}$/.test(commit) ? commit : null;
}

export const BUILD_COMMIT: string | null = stampedCommit();

export function softwareVersion(commit: string | null = BUILD_COMMIT): string {
  return commit === null ? "0.0.0-dev" : `0.0.0-dev+${commit}`;
}

// While pending, the taxpayer is named: AEAT's test service, whose acceptance the first production activation requires, could reject placeholder text.
export function producerFields(
  identity: SoftwareIdentity,
  taxpayer: { legalName: string; nif: string },
): { NombreRazon: string; NIF: string } {
  if (identity.producer === PRODUCER_PENDING)
    return { NombreRazon: taxpayer.legalName, NIF: taxpayer.nif };
  return { NombreRazon: identity.producer.name, NIF: identity.producer.nif };
}

export function refuseUnsetProducer(
  environment: string,
  published: boolean,
  identity: SoftwareIdentity = SOFTWARE_IDENTITY,
): void {
  if (environment === "production" && published && identity.producer === PRODUCER_PENDING)
    throw new AppError("sif.producer_unset", { environment });
}
