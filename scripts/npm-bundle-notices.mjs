import { existsSync, readFileSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

const FALLBACKS = fileURLToPath(new URL("../deploy/third-party/npm-fallback/", import.meta.url));

function packageForModule(id) {
  if (id.startsWith("\0")) return null;
  let directory = dirname(realpathSync(resolve(id.split("?")[0])));
  while (true) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
      if (name?.startsWith("@waitron/")) return null;
      if (directory.includes("node_modules") && name && version)
        return { directory, name, version };
      return null;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function bundledNpmNotices(moduleIds) {
  const packages = new Map();
  for (const id of moduleIds) {
    const found = packageForModule(id);
    if (found) packages.set(`${found.name}@${found.version}`, found);
  }
  const blocks = [];
  const missing = [];
  for (const { directory, name, version } of [...packages.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  )) {
    const files = readdirSync(directory).filter((file) =>
      /^(?:LICEN[CS]E|COPYING|NOTICE)(?:[.-].*)?$/i.test(file),
    );
    if (files.length === 0) {
      const fallback = join(FALLBACKS, `${name.replaceAll("/", "+")}@${version}.txt`);
      if (!existsSync(fallback)) {
        missing.push(`${name}@${version}`);
        continue;
      }
      const content = readFileSync(fallback, "utf8");
      blocks.push(
        `===== ${name} ${version} — upstream licence =====\n${content}${content.endsWith("\n") ? "" : "\n"}`,
      );
      continue;
    }
    for (const file of files.sort()) {
      const content = readFileSync(join(directory, file), "utf8");
      blocks.push(
        `===== ${name} ${version} — ${file} =====\n${content}${content.endsWith("\n") ? "" : "\n"}`,
      );
    }
  }
  if (missing.length > 0) throw new Error(`No licence notices found for: ${missing.join(", ")}`);
  return `Bundled npm package notices\n\n${blocks.length > 0 ? blocks.join("\n") : "No bundled npm packages.\n"}`;
}

export function writeBundledNpmNotices(moduleIds, outfile) {
  writeFileSync(outfile, bundledNpmNotices(moduleIds));
}

export function viteNpmNotices() {
  return {
    name: "waitron-npm-bundle-notices",
    apply: "build",
    generateBundle(_options, bundle) {
      const modules = Object.values(bundle)
        .filter((output) => output.type === "chunk")
        .flatMap((chunk) => Object.keys(chunk.modules));
      this.emitFile({
        type: "asset",
        fileName: "THIRD-PARTY-NOTICES.txt",
        source: bundledNpmNotices(modules),
      });
    },
  };
}
