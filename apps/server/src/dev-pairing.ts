import type { Transaction } from "@waitron/db";
import { DEFAULT_DEVICE_PROFILES, defaultProfileName, listDeviceProfiles } from "@waitron/layouts";
import { enrolDevice, generatePairingCode, normalizePairingCode } from "./device.js";
import type { TillConfig } from "./till-config.js";

/** Reusable counter-till pairing code, accepted by `POST /api/device/enrol` only in dev mode. Its `O` is
 * a letter the code encoder never emits, so — compared after `normalizePairingCode` on BOTH sides
 * ({@link isDevPairingCode}) — no minted code can ever equal it. */
export const DEV_PAIRING_CODE = "DEMO";

/** Apply the same transcription leniency as `enrolDevice` to both sides of the comparison. */
export function isDevPairingCode(input: string): boolean {
  return normalizePairingCode(input) === normalizePairingCode(DEV_PAIRING_CODE);
}

/** Resolve the starter till profile's name using provisioning's shared defaults. */
export function tillDeviceProfileName(locale: string): string {
  const till = DEFAULT_DEVICE_PROFILES.find((profile) => profile.formFactor === "till")!;
  return defaultProfileName(till, locale);
}

/**
 * Mint and redeem in the caller's tenant transaction to reuse the pairing binding rules.
 * Require the seeded till profile because it supplies the counter's capabilities.
 */
export async function enrolDevTill(
  tx: Transaction,
  cfg: TillConfig,
): ReturnType<typeof enrolDevice> {
  // Provisioning named the seeded profiles against `invoiceLocales[0]`, which `loadTillConfig` sets to
  // `[locale]` (till-config.ts), so `cfg.locale` is the key the seed used.
  const name = tillDeviceProfileName(cfg.locale);
  const profile = (await listDeviceProfiles(tx, cfg.tenantId)).find((p) => p.name === name);
  if (profile === undefined) {
    throw new Error(
      `dev pairing: tenant is missing the seeded "${name}" till device profile — applyVenue should have seeded it`,
    );
  }
  const { code } = await generatePairingCode(tx, cfg, {
    kind: "till",
    stationId: null,
    label: "Caja 1",
    tillId: cfg.tillId,
    deviceProfileId: profile.id,
  });
  return enrolDevice(tx, cfg, { code });
}
