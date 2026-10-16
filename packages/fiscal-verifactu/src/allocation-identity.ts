export function isInstallationIdentity(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 7) {
    return /^[SPC][0-9]{6}$/.test(value) && value.slice(1) !== "000000";
  }
  return value.length === 27 && /^E[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{25}$/.test(value);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function encodeEmergencyIdentity(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new RangeError("An emergency identity needs 16 bytes");
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let suffix = "";
  for (let i = 0; i < 26; i++) {
    suffix = CROCKFORD[Number(value & 31n)]! + suffix;
    value >>= 5n;
  }
  return `E${suffix}`;
}

export function installationChecksum(identity: string): string | null {
  if (!isInstallationIdentity(identity) || identity.length !== 27) return null;
  let crc = 0xffff;
  for (const character of identity) {
    crc ^= character.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc & 0x8000) === 0 ? crc << 1 : (crc << 1) ^ 0x1021) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function matchesInstallationChecksum(identity: unknown, checksum: unknown): boolean {
  return (
    typeof identity === "string" &&
    typeof checksum === "string" &&
    checksum.length === 4 &&
    /^[0-9A-F]{4}$/.test(checksum) &&
    installationChecksum(identity) === checksum
  );
}

export function isAllocatedSeries(
  value: unknown,
  installationIdentity: string,
  requiredBases: readonly { code: string; purpose: string }[],
): boolean {
  return (
    isInstallationIdentity(installationIdentity) &&
    seriesMatchBases(value, installationIdentity, requiredBases)
  );
}

export function seriesMatchBases(
  value: unknown,
  installationIdentity: string,
  requiredBases: readonly { code: string; purpose: string }[],
): boolean {
  if (!Array.isArray(value)) return false;
  if (requiredBases.length === 0 || value.length !== requiredBases.length) return false;
  const expected = new Map<string, string>();
  for (const base of requiredBases) {
    if (
      base.code.length === 0 ||
      base.code.length > 21 ||
      !/^[A-Za-z0-9/_.-]+$/.test(base.code) ||
      !["standard", "full", "rectificative"].includes(base.purpose)
    )
      return false;
    const code = `${base.code}-${installationIdentity}`;
    if (expected.has(code)) return false;
    expected.set(code, base.purpose);
  }
  if (!requiredBases.some((base) => base.purpose === "standard")) return false;
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
    const { code, purpose } = item as Record<string, unknown>;
    if (typeof code !== "string" || typeof purpose !== "string" || expected.get(code) !== purpose)
      return false;
    expected.delete(code);
  }
  return true;
}
