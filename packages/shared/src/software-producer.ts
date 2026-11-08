import { AppError, type ErrorParams } from "./errors.js";

export interface SoftwareProducer {
  readonly name: string;
  readonly taxId: string;
  readonly address: string;
}

const SETTINGS = [
  "WAITRON_PRODUCER_NAME",
  "WAITRON_PRODUCER_TAX_ID",
  "WAITRON_PRODUCER_ADDRESS",
] as const;

const MAX_LENGTH = 200;

/**
 * The software producer's name, tax number and address, or `null` when none of the three is set.
 * An empty value counts as unset. A refusal names the setting, never its value.
 */
export function readSoftwareProducer(
  env: Readonly<Record<string, string | undefined>>,
): SoftwareProducer | null {
  const unset = SETTINGS.filter((setting) => isUnset(env[setting]));
  if (unset.length === SETTINGS.length) return null;
  const firstUnset = unset[0];
  if (firstUnset !== undefined) refuse(firstUnset, "partial");

  return {
    name: readOne(env, "WAITRON_PRODUCER_NAME"),
    taxId: readOne(env, "WAITRON_PRODUCER_TAX_ID"),
    address: readOne(env, "WAITRON_PRODUCER_ADDRESS"),
  };
}

function readOne(env: Readonly<Record<string, string | undefined>>, setting: string): string {
  // Checked before trimming: a line break at either end would still split a build argument.
  const raw = env[setting] ?? "";
  const value = raw.trim();
  if (value === "") refuse(setting, "missing");
  if (/[\r\n]/.test(raw)) refuse(setting, "line_break");
  if ([...value].length > MAX_LENGTH) refuse(setting, "too_long");
  return value;
}

function isUnset(raw: string | undefined): boolean {
  return raw === undefined || raw === "";
}

function refuse(
  setting: string,
  reason: ErrorParams["software_producer.invalid"]["reason"],
): never {
  throw new AppError("software_producer.invalid", { setting, reason });
}
