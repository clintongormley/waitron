import { emptyDrainResult, type DrainResult } from "@waitron/fiscal";
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

/** Apply the submission policy before the regime can construct a client or contact its endpoint. */
export async function runFiscalDrain(
  policy: FiscalDrainPolicy,
  drain: (now: Date) => Promise<DrainResult>,
  now: Date,
): Promise<DrainResult> {
  if (!fiscalDrainEnabled(policy)) return emptyDrainResult();
  return drain(now);
}
