import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { verifyPackage } from "../../ui-core/test/package-consumer.test.mjs";
for (const variant of process.env.CONTRACT_PACKAGE_TARBALL
  ? ["registry"]
  : ["workspace", "registry"])
  test(
    `a ${variant} contract release works in an independent Node consumer`,
    { timeout: 170000 },
    () =>
      verifyPackage(variant, {
        root: fileURLToPath(new URL("../", import.meta.url)),
        packageNameSuffix: "contract",
        prepareScript: fileURLToPath(
          new URL("../../../scripts/release/prepare-ui.mjs", import.meta.url),
        ),
      }),
  );
