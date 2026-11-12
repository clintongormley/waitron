import "../errors.js";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { AppError } from "@waitron/shared";
import { renderDeclarationPdf } from "./pdf.js";
import { renderDeclaration, type DeclarationProducer } from "./render.js";
import { declarationDate, declarationItems, refuseBlockers } from "./source.js";

/**
 * Writes the folder a release image serves at `/app/declaration/`, all four files from `source`:
 * they are written into a new folder beside `dir`, which one rename then makes `dir`, so `dir`
 * gets all four or stays as it was. A `dir` already holding files is refused, never replaced.
 */
export async function writeReleaseFolder(
  dir: string,
  source: string,
  producer: DeclarationProducer,
): Promise<{ version: string; releasedOn: string }> {
  refuseBlockers(source);
  const version = declarationItems(source).get("1.c");
  if (version === undefined) throw new AppError("declaration.disagrees", { item: "1.c" });
  const release = { version, releasedOn: declarationDate(source) };
  const rendered = renderDeclaration(source, producer);
  const pdf = await renderDeclarationPdf(source, producer);
  await mkdir(dirname(dir), { recursive: true });
  // Not `mkdtemp`: its folder is readable by its owner alone, and this one becomes `dir`.
  const working = join(dirname(dir), `.${basename(dir)}-${randomUUID()}`);
  await mkdir(working);
  try {
    await Promise.all([
      writeFile(join(working, "declaration.html"), rendered.html),
      writeFile(join(working, "declaration.txt"), rendered.text),
      writeFile(join(working, "declaration.pdf"), pdf),
      writeFile(join(working, "release.json"), `${JSON.stringify(release)}\n`),
    ]);
    await rename(working, dir).catch((error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOTEMPTY" || code === "EEXIST") {
        throw new AppError("declaration.folder_exists", { folder: dir });
      }
      throw error;
    });
  } catch (error) {
    await rm(working, { recursive: true, force: true });
    throw error;
  }
  return release;
}
