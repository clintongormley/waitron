import { AppError } from "@waitron/shared";
import "./errors.js"; // load the code registry so media.unsupported_type below is reachable

/**
 * Image-byte validation by magic-byte sniffing (design §5b). Pure and browser-safe: it takes a
 * `Uint8Array`, touches no `fs`/`db`/Node builtins, and is unit-tested by feeding byte arrays.
 *
 * The stored extension is derived from THESE bytes, never the client's `Content-Type` or filename,
 * so an attacker cannot make us write `.png` over a script by lying in the multipart headers.
 */
export type ImageType = "jpg" | "png" | "webp";

// Magic-byte signatures. A signature is a run of bytes that must all match at a given offset.
const JPEG = [0xff, 0xd8, 0xff] as const; // FF D8 FF
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const; // 89 50 4E 47 0D 0A 1A 0A
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF" at offset 0
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP" at offset 8
const GIF = [0x47, 0x49, 0x46, 0x38] as const; // "GIF8" — recognised only to name it in the error

/** True iff every byte of `sig` matches `bytes` starting at `offset`. */
function matchesAt(bytes: Uint8Array, offset: number, sig: readonly number[]): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/** Sniff the image type from the leading bytes, or `null` if it is not an accepted type. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (matchesAt(bytes, 0, JPEG)) return "jpg";
  if (matchesAt(bytes, 0, PNG)) return "png";
  if (matchesAt(bytes, 0, RIFF) && matchesAt(bytes, 8, WEBP)) return "webp";
  return null;
}

/** Name a rejected type where we recognise it, so `media.unsupported_type` can carry a fact. */
function nameUnsupported(bytes: Uint8Array): string | undefined {
  if (matchesAt(bytes, 0, GIF)) return "gif";
  return undefined;
}

/**
 * Return the accepted image type, or throw `media.unsupported_type` — carrying a `detected` type
 * name when the bytes are a recognisable-but-unsupported format (e.g. GIF), and nothing when they
 * are not recognisable at all (plain text, an empty buffer). Never carries the raw bytes.
 */
export function validateImageBytes(bytes: Uint8Array): ImageType {
  const type = sniffImageType(bytes);
  if (type !== null) return type;
  const detected = nameUnsupported(bytes);
  throw new AppError("media.unsupported_type", detected === undefined ? {} : { detected });
}
