import { AppError, type ErrorParams } from "./errors.js";

export interface SoftwareProducer {
  readonly name: string;
  readonly taxId: string;
  readonly address: string;
}

type Setting = "WAITRON_PRODUCER_NAME" | "WAITRON_PRODUCER_TAX_ID" | "WAITRON_PRODUCER_ADDRESS";

const MAX_LENGTH = 200;

/**
 * The software producer's name, tax number and address, or `null` when none of the three is set.
 * An empty value counts as unset. A refusal names the setting, never its value.
 */
export function readSoftwareProducer(
  env: Readonly<Record<string, string | undefined>>,
): SoftwareProducer | null {
  const name = env.WAITRON_PRODUCER_NAME;
  const taxId = env.WAITRON_PRODUCER_TAX_ID;
  const address = env.WAITRON_PRODUCER_ADDRESS;
  if (isUnset(name) && isUnset(taxId) && isUnset(address)) return null;
  if (isUnset(name)) refuse("WAITRON_PRODUCER_NAME", "partial");
  if (isUnset(taxId)) refuse("WAITRON_PRODUCER_TAX_ID", "partial");
  if (isUnset(address)) refuse("WAITRON_PRODUCER_ADDRESS", "partial");

  return {
    name: checked("WAITRON_PRODUCER_NAME", name),
    taxId: checked("WAITRON_PRODUCER_TAX_ID", taxId),
    address: checked("WAITRON_PRODUCER_ADDRESS", address),
  };
}

function checked(setting: Setting, raw: string): string {
  const value = raw.trim();
  if (value === "") refuse(setting, "missing");
  if (/[\r\n]/.test(raw)) refuse(setting, "line_break");
  if ([...value].length > MAX_LENGTH) refuse(setting, "too_long");
  return value;
}

function isUnset(raw: string | undefined): raw is undefined | "" {
  return raw === undefined || raw === "";
}

function refuse(
  setting: Setting,
  reason: ErrorParams["software_producer.invalid"]["reason"],
): never {
  throw new AppError("software_producer.invalid", { setting, reason });
}
