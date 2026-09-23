import { createHash } from "node:crypto";
import { validateImageBytes } from "@waitron/catalogue";

/** The name a stored photo goes by: the sha256 of its bytes plus the extension sniffed from them. */
export function imageFilename(bytes: Uint8Array): string {
  const extension = validateImageBytes(bytes);
  return `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
}
