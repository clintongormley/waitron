import type {
  RegisterScope,
  RegisterPosition,
  NamedNodeKey,
  PrintedPositionFields,
  PrintedNodeFields,
  PrintedPositionBlock,
  PrintedNodeBlock,
} from "./paper-register-protocol.js";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function refuse(): never {
  throw new Error("Paper register value refused");
}
function exact(value: unknown, keys: readonly string[]): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    refuse();
}
function checkedScope(scope: RegisterScope): RegisterScope {
  exact(scope, ["environment", "softwareId", "taxpayerNif"]);
  if (
    typeof scope.taxpayerNif !== "string" ||
    !/^[A-Z0-9]{9}$/.test(scope.taxpayerNif) ||
    typeof scope.softwareId !== "string" ||
    !/^[A-Z0-9]{2}$/.test(scope.softwareId) ||
    (scope.environment !== "production" && scope.environment !== "preproduction")
  )
    refuse();
  // Both version-2 check domains use lexical object-key order.
  return {
    environment: scope.environment,
    softwareId: scope.softwareId,
    taxpayerNif: scope.taxpayerNif,
  };
}
function checkedPosition(position: RegisterPosition): void {
  exact(position, ["sHighWater", "pHighWater"]);
  for (const value of [position.sHighWater, position.pHighWater])
    if (!Number.isInteger(value) || value < 0 || value > 999999) refuse();
}
export function normaliseTypedCode(text: string): string {
  if (typeof text !== "string" || /[^0-9A-Za-z \t\r\n-]/.test(text)) refuse();
  const value = text
    .replace(/[ \t\r\n-]/g, "")
    .toUpperCase()
    .replaceAll("O", "0")
    .replace(/[IL]/g, "1");
  if (/[^0-9ABCDEFGHJKMNPQRSTVWXYZ]/.test(value)) refuse();
  return value;
}
function base32(bytes: Uint8Array): string {
  let buffer = 0,
    bits = 0,
    output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >> bits) & 31]!;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) output += alphabet[buffer << (5 - bits)]!;
  return output;
}
function decodeBytes(code: string): Uint8Array<ArrayBuffer> {
  const value = normaliseTypedCode(code);
  const length = Math.floor((value.length * 5) / 8);
  if (length === 0 || Math.ceil((length * 8) / 5) !== value.length) refuse();
  const bytes = new Uint8Array(length);
  let buffer = 0,
    bits = 0,
    offset = 0;
  for (const symbol of value) {
    buffer = (buffer << 5) | alphabet.indexOf(symbol);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = buffer >> bits;
      buffer &= (1 << bits) - 1;
    }
  }
  if (buffer !== 0 || base32(bytes) !== value) refuse();
  return bytes;
}
function group(value: string): string {
  return value.match(/.{1,4}/g)!.join(" ");
}
async function check(value: readonly unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(value)));
  return base32(new Uint8Array(digest).subarray(0, 5));
}
export async function encodePosition(
  scope: RegisterScope,
  position: RegisterPosition,
): Promise<PrintedPositionBlock> {
  const frozenScope = checkedScope(scope);
  checkedPosition(position);
  const { sHighWater, pHighWater } = position;
  return {
    fields: {
      sPosition: group(String(sHighWater).padStart(6, "0")),
      pPosition: group(String(pHighWater).padStart(6, "0")),
      check: group(
        await check(["waitron.paper-position-check", 2, frozenScope, sHighWater, pHighWater]),
      ),
    },
    enteredCharacters: 20,
    displayedCharacters: 23,
  };
}
export async function decodePosition(
  fields: PrintedPositionFields,
  scope: RegisterScope,
): Promise<RegisterPosition> {
  const frozenScope = checkedScope(scope);
  exact(fields, ["sPosition", "pPosition", "check"]);
  const s = normaliseTypedCode(fields.sPosition),
    p = normaliseTypedCode(fields.pPosition);
  if (!/^\d{6}$/.test(s) || !/^\d{6}$/.test(p)) refuse();
  const sHighWater = Number(s),
    pHighWater = Number(p);
  const expected = await check([
    "waitron.paper-position-check",
    2,
    frozenScope,
    sHighWater,
    pHighWater,
  ]);
  if (normaliseTypedCode(fields.check) !== expected) refuse();
  return { sHighWater, pHighWater };
}
function keyId(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  )
    refuse();
}
function encodingKind(value: string): asserts value is PrintedNodeFields["encoding"] {
  if (value !== "raw192" && value !== "utf8") refuse();
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function text(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    return refuse();
  }
}
function nodeCheck(
  scope: RegisterScope,
  nodeId: string,
  name: string,
  encoding: PrintedNodeFields["encoding"],
  bytes: Uint8Array,
  secret: string,
): Promise<string> {
  return check(["waitron.node-key-check", 2, scope, nodeId, name, encoding, bytes.length, secret]);
}
export async function encodeNodeKey(
  key: NamedNodeKey,
  scope: RegisterScope,
  encoding: PrintedNodeFields["encoding"],
): Promise<PrintedNodeBlock> {
  const frozenScope = checkedScope(scope);
  exact(key, ["nodeId", "name", "secret"]);
  keyId(key.nodeId);
  keyId(key.name);
  encodingKind(encoding);
  if (typeof key.secret !== "string" || key.secret.length === 0) refuse();
  let bytes: Uint8Array;
  if (encoding === "raw192") {
    if (!/^[A-Za-z0-9_-]{32}$/.test(key.secret)) refuse();
    bytes = Uint8Array.from(atob(key.secret.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
  } else {
    bytes = encoder.encode(key.secret);
    if (text(bytes) !== key.secret) refuse();
  }
  const value = base32(bytes),
    checksum = await nodeCheck(frozenScope, key.nodeId, key.name, encoding, bytes, key.secret);
  const fields = { encoding, value: group(value), check: group(checksum) };
  return {
    fields,
    enteredCharacters: value.length + 8,
    displayedCharacters: fields.value.length + fields.check.length,
  };
}
export async function decodeNodeKey(
  fields: PrintedNodeFields,
  scope: RegisterScope,
  nodeId: string,
  keyName: string,
): Promise<string> {
  const frozenScope = checkedScope(scope);
  exact(fields, ["encoding", "value", "check"]);
  keyId(nodeId);
  keyId(keyName);
  encodingKind(fields.encoding);
  const bytes = decodeBytes(fields.value);
  if (fields.encoding === "raw192" && bytes.length !== 24) refuse();
  const secret = fields.encoding === "raw192" ? base64url(bytes) : text(bytes);
  if (
    normaliseTypedCode(fields.check) !==
    (await nodeCheck(frozenScope, nodeId, keyName, fields.encoding, bytes, secret))
  )
    refuse();
  return secret;
}
