import { emptyDrainResult, type DrainResult, type FiscalCertificateSeat } from "@waitron/fiscal";
import type { AlertSource } from "@waitron/module";
import type { DeploymentEnvironment } from "./config.js";
import type { OnboardingIntent } from "./trading-config.js";

export interface FiscalDrainPolicy {
  environment: DeploymentEnvironment;
  onboardingIntent: OnboardingIntent | undefined;
  fiscalTestSubmissions: boolean;
}

/** Demo and Prepare never submit. Preproduction submission exists only for a dedicated integration target. */
export function fiscalDrainEnabled(policy: FiscalDrainPolicy): boolean {
  if (policy.onboardingIntent === "demo" || policy.onboardingIntent === "prepare") return false;
  if (policy.environment === "production") return true;
  return policy.fiscalTestSubmissions;
}

/**
 * The certificate's expiry alert and emails run only on a box whose policy files records
 * (`fiscalDrainEnabled`); the email loop also checks on each pass that this node is the primary.
 */
export function certificateDutiesEnabled<
  F extends { readonly certificate?: FiscalCertificateSeat },
>(
  fiscal: F,
  policy: FiscalDrainPolicy,
): fiscal is F & { readonly certificate: FiscalCertificateSeat } {
  return fiscal.certificate !== undefined && fiscalDrainEnabled(policy);
}

/** Leaves out every `filingOnly` source on a box whose policy does not send fiscal records
 * (`fiscalDrainEnabled`): its records are not sent while that policy holds, so a "delayed" alert
 * could not clear. */
export function alertSourcesFor(
  sources: readonly AlertSource[],
  policy: FiscalDrainPolicy,
): readonly AlertSource[] {
  if (fiscalDrainEnabled(policy)) return sources;
  return sources.filter((source) => !source.filingOnly);
}

/** Apply the submission policy before the regime can construct a client or contact its endpoint. */
export async function runFiscalDrain(
  policy: FiscalDrainPolicy,
  drain: (now: Date, signal?: AbortSignal) => Promise<DrainResult>,
  now: Date,
  signal?: AbortSignal,
): Promise<DrainResult> {
  if (!fiscalDrainEnabled(policy)) return emptyDrainResult();
  return drain(now, signal);
}
