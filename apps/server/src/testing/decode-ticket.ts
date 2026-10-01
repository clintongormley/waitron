import { expect } from "vitest";
import { readRasterText } from "@waitron/printing";
import { escPosCommands } from "@waitron/printing/src/testing/escpos-commands.js";
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

/** True when a payload carries a drawer pulse: `ESC p`, or the real-time `DLE DC4`. */
export function opensDrawer(bytes: Uint8Array): boolean {
  return commandNames(bytes).some((name) => name === "ESC p" || name === "DLE DC4");
}

export interface PrintedCommand {
  name: string;
  bytes: Uint8Array;
  /** An image's size, from its `GS v 0` header. */
  widthDots?: number;
  heightDots?: number;
  /** For an image that is a drawn line of text, what it reads as. */
  text?: string;
}

/** A payload's commands with their bytes, each drawn line of text carrying what it reads as. */
export function printedCommands(payload: Uint8Array): PrintedCommand[] {
  return escPosCommands(payload).map(({ name, offset, length, widthDots, heightDots }) => {
    const bytes = payload.subarray(offset, offset + length);
    if (widthDots === undefined || heightDots === undefined) return { name, bytes };
    const image = { name, bytes, widthDots, heightDots };
    const text = readRasterText(widthDots, heightDots, bytes.subarray(8));
    return text === undefined ? image : { ...image, text };
  });
}
