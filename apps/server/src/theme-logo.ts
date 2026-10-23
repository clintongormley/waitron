import "./errors.js";
import type { Transaction } from "@waitron/db";
import type { ReceiptLogoRasters } from "@waitron/layouts";
import {
  imageExists,
  readCurrentImage,
  readCurrentImageMetadata,
  readPresentations,
  renderRendition,
  type ImageFraming,
} from "@waitron/media";
import { AppError, MEDIA_FILENAME } from "@waitron/shared";
import type { ThemeLogo } from "@waitron/ui-core/theme";
import { drawLogoRasters } from "./receipt-logo.js";

export type LogoSnapshot = {
  readonly imageId: string;
  readonly revision: number;
} & (
  | { readonly kept: ReceiptLogoRasters; readonly source: null }
  | {
      readonly kept: null;
      readonly source: { readonly bytes: Uint8Array; readonly framing: ImageFraming };
    }
);

function notFound(side: "light" | "dark"): AppError {
  return new AppError("theme.invalid", { field: `logo.${side}`, reason: "image_not_found" });
}

/** Reads the light image's source bytes only when its stored dots cannot be kept. */
export async function snapshotThemeLogo(
  tx: Transaction,
  logo: ThemeLogo,
  kept: ReceiptLogoRasters | null,
): Promise<LogoSnapshot> {
  if (!MEDIA_FILENAME.test(logo.light)) throw notFound("light");
  if (logo.dark !== undefined && !MEDIA_FILENAME.test(logo.dark)) throw notFound("dark");
  let snapshot: LogoSnapshot;
  if (kept !== null) {
    const image = await readCurrentImageMetadata(tx, logo.light);
    if (image === null) throw notFound("light");
    snapshot = { imageId: image.imageId, revision: image.revision, kept, source: null };
  } else {
    const image = await readCurrentImage(tx, logo.light);
    if (image === null) throw notFound("light");
    snapshot = {
      imageId: image.imageId,
      revision: image.revision,
      kept: null,
      source: { bytes: image.bytes, framing: image.framing },
    };
  }
  if (logo.dark !== undefined && !(await imageExists(tx, logo.dark))) throw notFound("dark");
  return snapshot;
}

/** Decodes with sharp, so it takes no transaction. */
export async function printedLogoFor(snapshot: LogoSnapshot): Promise<ReceiptLogoRasters> {
  if (snapshot.kept !== null) return snapshot.kept;
  const { bytes, framing } = snapshot.source;
  return drawLogoRasters(await renderRendition(bytes, "display", framing));
}

/** Runs in the write transaction, after the store's write, so a refusal rolls that write back. */
export async function recheckThemeLogo(
  tx: Transaction,
  logo: ThemeLogo,
  snapshot: LogoSnapshot,
): Promise<void> {
  const names = logo.dark === undefined ? [logo.light] : [logo.light, logo.dark];
  const found = await readPresentations(tx, names);
  const light = found[logo.light];
  if (light === undefined) throw notFound("light");
  if (light.id !== snapshot.imageId || light.revision !== snapshot.revision) {
    throw new AppError("image.changed", { imageId: snapshot.imageId });
  }
  if (logo.dark !== undefined && found[logo.dark] === undefined) throw notFound("dark");
}
