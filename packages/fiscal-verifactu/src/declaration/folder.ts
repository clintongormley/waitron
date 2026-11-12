import "../errors.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { renderDeclarationPdf } from "./pdf.js";
import { renderDeclaration, type DeclarationProducer } from "./render.js";
import { declarationDate, declarationItems, refuseBlockers } from "./source.js";

/** Writes the folder a release image serves at `/app/declaration/`, all four files from `source`. */
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
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "declaration.html"), rendered.html);
  await writeFile(join(dir, "declaration.txt"), rendered.text);
  await writeFile(join(dir, "declaration.pdf"), pdf);
  await writeFile(join(dir, "release.json"), `${JSON.stringify(release)}\n`);
  return release;
}
