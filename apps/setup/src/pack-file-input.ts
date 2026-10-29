import { looksLikePdf, RecoveryPackFileError } from "@waitron/recovery-pack/src/pack-file.js";

export type PackFileRefusal = "no_code" | "not_a_pack" | "damaged";

/**
 * A chosen kit file's text, or a recovery pack PDF's bucket code read from its attached file. The
 * PDF's drawn text is never read: a long code wraps on the page, and the kit parser keeps only
 * the first piece of wrapped text. pdf-lib loads only when a PDF is chosen.
 */
export async function bucketCodeFromFile(
  file: File,
): Promise<{ text: string } | { refused: PackFileRefusal }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return { text: new TextDecoder().decode(bytes) };
  const { readRecoveryPackPdf } = await import("@waitron/recovery-pack/src/read-pack-pdf.js");
  try {
    const { bucketCode } = await readRecoveryPackPdf(bytes);
    return bucketCode === null ? { refused: "no_code" } : { text: bucketCode };
  } catch (error) {
    return {
      refused:
        error instanceof RecoveryPackFileError && error.reason === "not_a_pack"
          ? "not_a_pack"
          : "damaged",
    };
  }
}
