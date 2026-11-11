import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { declarationSourceFor, testProducer } from "@waitron/fiscal-verifactu/test/declaration.js";
import { renderDeclarationPdf } from "@waitron/fiscal-verifactu/src/declaration/pdf.js";
import {
  renderDeclaration,
  type DeclarationProducer,
} from "@waitron/fiscal-verifactu/src/declaration/render.js";

export const TEST_RELEASE = { version: "1.2.3", releasedOn: "2026-10-22" } as const;

/**
 * Writes the folder slice 4's release run will put at `/app/declaration/`, rendered by slice 2's
 * code. The declaration states `declaredVersion`, whatever `release.json` names.
 */
export async function writeDeclarationFolder(
  dir: string,
  release: { version: string; releasedOn: string } = TEST_RELEASE,
  producer: DeclarationProducer = testProducer,
  declaredVersion: string = TEST_RELEASE.version,
): Promise<void> {
  const source = declarationSourceFor(declaredVersion);
  const rendered = renderDeclaration(source, producer);
  const pdf = await renderDeclarationPdf(source, producer);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "declaration.html"), rendered.html);
  await writeFile(join(dir, "declaration.txt"), rendered.text);
  await writeFile(join(dir, "declaration.pdf"), pdf);
  await writeFile(join(dir, "release.json"), `${JSON.stringify(release)}\n`);
}
