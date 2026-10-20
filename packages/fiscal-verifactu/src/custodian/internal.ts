export interface CustodyScope {
  readonly custodianId: string;
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: "production" | "preproduction";
}
export interface CustodyPublic {
  readonly scope: CustodyScope;
  readonly publicKey: string;
  readonly fingerprint: string;
}
export interface CustodyKey extends CustodyPublic {
  dispose(): void;
}
type Origin = "created" | "saved-file" | "secret-paper";
interface Material {
  readonly privateKey: CryptoKey;
  readonly der: Uint8Array<ArrayBuffer>;
  readonly origin: Origin;
}
const handles = new WeakMap<CustodyKey, Material>();
export const PRIVATE_PREFIX = "302e020100300506032b657004220420";
const PUBLIC_PREFIX = "302a300506032b6570032100";
export const encoder = new TextEncoder();
export function refuse(): never {
  throw new Error("Custody material refused");
}
export async function guarded<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch {
    return refuse();
  }
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((k) => Object.hasOwn(value, k))
  );
}
export function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}
export function scopeOf(value: unknown): CustodyScope {
  if (
    !exact(value, ["custodianId", "taxpayerNif", "softwareId", "environment"]) ||
    !text(value.custodianId) ||
    !text(value.taxpayerNif) ||
    !text(value.softwareId) ||
    value.softwareId.length > 2 ||
    (value.environment !== "production" && value.environment !== "preproduction")
  )
    refuse();
  return Object.freeze({
    custodianId: value.custodianId,
    taxpayerNif: value.taxpayerNif,
    softwareId: value.softwareId,
    environment: value.environment,
  });
}
export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value)) refuse();
  return Uint8Array.from(value.match(/../g)!, (pair) => Number.parseInt(pair, 16));
}
export function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
export function unbase64(value: unknown, min: number, max = min): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    refuse();
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length < min || bytes.length > max || base64(bytes) !== value) refuse();
  return bytes;
}
export function random(size: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(size));
}
export async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}
export function bounded(value: unknown, max = 16384): string {
  if (typeof value !== "string" || value.length > max || encoder.encode(value).length > max)
    refuse();
  return value;
}
export function material(key: CustodyKey): Material {
  const result = handles.get(key);
  if (result === undefined) refuse();
  return result;
}
export async function expectedPublic(expected: CustodyPublic): Promise<CryptoKey> {
  scopeOf(expected.scope);
  if (
    typeof expected.publicKey !== "string" ||
    expected.publicKey.length > 1024 ||
    !/^[0-9a-f]{64}$/.test(expected.fingerprint)
  )
    refuse();
  const pem =
    /^-----BEGIN PUBLIC KEY-----\n((?:[A-Za-z0-9+/=]+\n)+)-----END PUBLIC KEY-----\n?$/.exec(
      expected.publicKey,
    );
  if (pem === null) refuse();
  const spki = unbase64(pem[1]!.replaceAll("\n", ""), 44);
  if (hex(spki.subarray(0, 12)) !== PUBLIC_PREFIX || (await digest(spki)) !== expected.fingerprint)
    refuse();
  return crypto.subtle.importKey("spki", spki, "Ed25519", false, ["verify"]);
}
export async function matches(key: CustodyPublic, expected: CustodyPublic): Promise<CryptoKey> {
  const publicKey = await expectedPublic(expected);
  if (
    key.fingerprint !== expected.fingerprint ||
    JSON.stringify(scopeOf(key.scope)) !== JSON.stringify(scopeOf(expected.scope))
  )
    refuse();
  return publicKey;
}
export async function fromDer(
  der: Uint8Array<ArrayBuffer>,
  scope: CustodyScope,
  origin: Origin,
  expected?: CustodyPublic,
): Promise<CustodyKey> {
  if (der.length !== 48 || hex(der.subarray(0, 16)) !== PRIVATE_PREFIX) refuse();
  const privateKey = await crypto.subtle.importKey("pkcs8", der, "Ed25519", true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  if (typeof jwk.x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x)) refuse();
  const x = unbase64(jwk.x.replaceAll("-", "+").replaceAll("_", "/") + "=", 32);
  const spki = new Uint8Array(44);
  spki.set(unhex(PUBLIC_PREFIX));
  spki.set(x, 12);
  const fingerprint = await digest(spki);
  const publicKey = `-----BEGIN PUBLIC KEY-----\n${base64(spki)}\n-----END PUBLIC KEY-----\n`;
  const publicInfo = { scope: scopeOf(scope), publicKey, fingerprint };
  if (expected !== undefined) await matches(publicInfo, expected);
  const handle = Object.freeze({
    ...publicInfo,
    dispose() {
      handles.get(handle)?.der.fill(0);
      handles.delete(handle);
    },
  });
  handles.set(handle, { privateKey, der: new Uint8Array(der), origin });
  return handle;
}
