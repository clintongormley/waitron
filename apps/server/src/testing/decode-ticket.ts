import { expect } from "vitest";
import { previewPrintJob } from "../print-job-preview.js";

/**
 * Decode an ESC/POS ticket payload (a `print_jobs.payload`) back to its Latin-1 text.
 *
 * Deliberately NOT `new TextDecoder("latin1")`: WHATWG decodes that label as windows-1252, which
 * re-maps bytes 0x80-0x9F.
 */
export function decodeTicket(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("latin1");
}

/** True iff `needle` occurs as a contiguous subsequence of `haystack`; an empty `needle` is present. */
export function bytesInclude(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * The lines a payload prints, read through the character tables it selects, with every command and
 * image skipped. Asserts the preview decoded the whole payload, so a stop part-way (an unsupported
 * command or byte) fails the calling test instead of hiding the rest of the ticket.
 */
export function printedLines(bytes: Uint8Array): string[] {
  const preview = previewPrintJob(bytes);
  expect(preview.unsupported, "preview stopped at an unsupported command").toBe(false);
  expect(preview.truncated, "preview was truncated").toBe(false);
  return preview.text.split("\n");
}
