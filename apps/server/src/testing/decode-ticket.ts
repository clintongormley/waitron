import { expect } from "vitest";
import { escPosCommands, readRasterText } from "@waitron/printing";
import { previewPrintJob } from "../print-job-preview.js";

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
 * The lines a payload prints, read back from the images its lines were drawn as, with every command
 * skipped. Asserts the preview decoded the whole payload, so a stop part-way (an unsupported command
 * or byte) fails the calling test instead of hiding the rest of the ticket.
 */
export function printedLines(bytes: Uint8Array): string[] {
  const preview = previewPrintJob(bytes);
  expect(preview.unsupported, "preview stopped at an unsupported command").toBe(false);
  expect(preview.truncated, "preview was truncated").toBe(false);
  return preview.text.split("\n");
}

/** {@link printedLines} as one string, for a search through the whole printed ticket. */
export function decodeTicket(bytes: Uint8Array): string {
  return printedLines(bytes).join("\n");
}

/**
 * The names of a payload's commands in order (`ESC p`, `GS v 0`, …), stepping over image and QR
 * data, so a check for a drawer pulse is not fooled by the same bytes inside a picture.
 */
export function commandNames(bytes: Uint8Array): string[] {
  return escPosCommands(bytes).map((command) => command.name);
}

export interface PrintedCommand {
  name: string;
  bytes: Uint8Array;
  /** For an image that is a drawn line of text, what it reads as. */
  text?: string;
}

/** A payload's commands with their bytes, each drawn line of text carrying what it reads as. */
export function printedCommands(payload: Uint8Array): PrintedCommand[] {
  return escPosCommands(payload).map(({ name, offset, length }) => {
    const bytes = payload.subarray(offset, offset + length);
    if (name !== "GS v 0") return { name, bytes };
    const text = readRasterText(
      (bytes[4]! + 256 * bytes[5]!) * 8,
      bytes[6]! + 256 * bytes[7]!,
      bytes.subarray(8),
    );
    return text === undefined ? { name, bytes } : { name, bytes, text };
  });
}
