import type { Transaction } from "@waitron/db";
import { DEFAULT_DEVICE_PROFILES, listDeviceProfiles } from "@waitron/layouts";
import { AppError } from "@waitron/shared";
import { enrolDevice, generatePairingCode, normalizePairingCode } from "./device.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

/** Reusable counter-till pairing code, accepted by `POST /api/device/enrol` only in dev mode. It
 * normalises to the FOUR-character `DEM0`, and a minted code is always exactly eight characters
 * (`PAIRING_CODE_BYTES = 5`, device.ts), so — compared after `normalizePairingCode` on both sides
 * ({@link isDevPairingCode}) — no minted code can ever equal it. */
export const DEV_PAIRING_CODE = "DEMO";

/** Apply the same transcription leniency as `enrolDevice` to both sides of the comparison. */
export function isDevPairingCode(input: string): boolean {
  return normalizePairingCode(input) === normalizePairingCode(DEV_PAIRING_CODE);
}

/** Every localised name the starter `till` profile can have been seeded under ("Mostrador",
 * "Counter"). Provisioning named it for the venue's primary invoice locale, which `cfg.locale` does
 * not reliably reflect (it defaults to es-ES when `WAITRON_TILL_LOCALE` is unset), so the lookup
 * matches any of them rather than resolving one. */
const TILL_PROFILE_NAMES: readonly string[] = Object.values(
  DEFAULT_DEVICE_PROFILES.find((profile) => profile.formFactor === "till")!.nameByLocale,
);

/**
 * Mint and redeem in the caller's tenant transaction to reuse the pairing binding rules.
 * Require the seeded till profile because it supplies the counter's capabilities.
 */
export async function enrolDevTill(
  tx: Transaction,
  cfg: TillConfig,
): ReturnType<typeof enrolDevice> {
  const profile = (await listDeviceProfiles(tx, cfg.tenantId)).find((p) =>
    TILL_PROFILE_NAMES.includes(p.name),
  );
  if (profile === undefined) throw new AppError("device.profile_missing", {});
  const { code } = await generatePairingCode(tx, cfg, {
    kind: "till",
    stationId: null,
    label: "Caja 1",
    tillId: cfg.tillId,
    deviceProfileId: profile.id,
  });
  return enrolDevice(tx, cfg, { code });
}
