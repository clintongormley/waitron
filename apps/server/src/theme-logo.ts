import "./errors.js";
import type { Transaction } from "@waitron/db";
import type { ReceiptLogoRasters } from "@waitron/layouts";
import {
  readCurrentImage,
  readCurrentImageMetadata,
  renderRendition,
  type ImageFraming,
} from "@waitron/media";
import type { ThemeLogo } from "@waitron/ui-core/theme";
import { drawLogoRasters } from "./receipt-logo.js";

export interface LogoSnapshot {
  readonly imageId: string;
  readonly revision: number;
  readonly kept: ReceiptLogoRasters | null;
  readonly source: { readonly bytes: Uint8Array; readonly framing: ImageFraming } | null;
}

/** Reads the light image's source bytes only when its stored dots cannot be kept. */
export async function snapshotThemeLogo(
  tx: Transaction,
  logo: ThemeLogo,
  kept: ReceiptLogoRasters | null,
): Promise<LogoSnapshot> {
  if (kept !== null) {
    const image = await readCurrentImageMetadata(tx, logo.light);
    return { imageId: image!.imageId, revision: image!.revision, kept, source: null };
  }
  const image = await readCurrentImage(tx, logo.light);
  return {
    imageId: image!.imageId,
    revision: image!.revision,
    kept,
    source: { bytes: image!.bytes, framing: image!.framing },
  };
}

/** Decodes with sharp, so it takes no transaction. */
export async function printedLogoFor(snapshot: LogoSnapshot): Promise<ReceiptLogoRasters> {
  return (
    snapshot.kept ??
    drawLogoRasters(
      await renderRendition(snapshot.source!.bytes, "display", snapshot.source!.framing),
    )
  );
}
