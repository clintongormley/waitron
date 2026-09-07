import { normalizePairingCode } from "./device.js";

/** Reusable dev pairing code, accepted by `POST /api/device/enrol/verify` and `POST /api/device/enrol`
 * ONLY in dev mode. It normalises to the FOUR-character `DEM0`, and a minted code is always exactly
 * eight characters (`PAIRING_CODE_BYTES = 5`, device.ts), so — compared after `normalizePairingCode` on
 * both sides ({@link isDevPairingCode}) — no minted code can ever equal it. In devMode the verify route
 * returns the catalogue for this code without a real code row, and the enrol route mints a fresh real
 * code and runs the REAL `enrolDevice` under it, so the dev code exercises the production enrol path. */
export const DEV_PAIRING_CODE = "DEMO";

/** Apply the same transcription leniency as `enrolDevice` to both sides of the comparison. */
export function isDevPairingCode(input: string): boolean {
  return normalizePairingCode(input) === normalizePairingCode(DEV_PAIRING_CODE);
}
