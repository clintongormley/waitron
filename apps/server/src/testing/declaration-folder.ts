import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { declarationSourceFor, testProducer } from "@waitron/fiscal-verifactu/test/declaration.js";
import { writeReleaseFolder } from "@waitron/fiscal-verifactu/src/declaration/folder.js";
import type { DeclarationProducer } from "@waitron/fiscal-verifactu/src/declaration/render.js";

export const TEST_RELEASE = { version: "1.2.3", releasedOn: "2026-10-22" } as const;

/**
 * Writes the folder `declaration render` writes, signed on `release.releasedOn`. The declaration
 * states `declaredVersion`; a `release.json` naming anything else replaces the rendered one.
 */
export async function writeDeclarationFolder(
  dir: string,
  release: { version: string; releasedOn: string } = TEST_RELEASE,
  producer: DeclarationProducer = testProducer,
  declaredVersion: string = TEST_RELEASE.version,
): Promise<void> {
  const source = declarationSourceFor(declaredVersion, {
    date: release.releasedOn,
    releasable: true,
  });
  const rendered = await writeReleaseFolder(dir, source, producer);
  if (rendered.version !== release.version || rendered.releasedOn !== release.releasedOn) {
    await writeFile(join(dir, "release.json"), `${JSON.stringify(release)}\n`);
  }
}
