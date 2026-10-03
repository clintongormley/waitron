import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import * as notices from "./npm-bundle-notices.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

it("emits the licence of a package that Vite put in a JavaScript chunk", () => {
  const lit = realpathSync(join(ROOT, "apps/till/node_modules/lit/index.js"));
  const emitted = [];
  const plugin = notices.viteNpmNotices?.();
  plugin?.generateBundle?.call(
    { emitFile: (asset) => emitted.push(asset) },
    {},
    { "assets/index.js": { type: "chunk", modules: { [lit]: {} } } },
  );
  expect(emitted).toHaveLength(1);
  expect(emitted[0].source).toContain("lit 3.3.3");
  expect(emitted[0].source).toContain(
    readFileSync(join(ROOT, "apps/till/node_modules/lit/LICENSE"), "utf8"),
  );
});
