import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--out" || args[1] === ""))
  throw new Error("Expected --out <file>");
const output = args.length ? resolve(args[1]) : resolve(root, "dist/custodian-tool.html");
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/custodian/offline-app.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  write: false,
  metafile: true,
  minify: true,
  legalComments: "inline",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "inline-css",
      setup(build) {
        build.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -7)),
          namespace: "inline-css",
        }));
        build.onLoad({ filter: /.*/, namespace: "inline-css" }, async (args) => ({
          contents: await readFile(args.path, "utf8"),
          loader: "text",
        }));
      },
    },
  ],
});
if (
  Object.values(result.metafile.outputs).some((output) => output.imports.length) ||
  Object.keys(result.metafile.inputs).some((input) => input.startsWith("node:"))
)
  throw new Error("Custody tool must be self-contained");
const script = result.outputFiles[0].text.replace(/<\/script/gi, "\\x3c/script");
const hash = createHash("sha256").update(script).digest("base64");
const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const template = await readFile(resolve(root, "src/custodian/tool.html"), "utf8");
const notices = new Map([["Waitron", await readFile(resolve(root, "../../LICENSE"), "utf8")]]);
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let directory = dirname(resolve(root, input));
  let manifest;
  for (;;) {
    try {
      manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT" || directory === dirname(directory)) throw error;
      directory = dirname(directory);
    }
  }
  const name = `${manifest.name}@${manifest.version}`;
  if (!notices.has(name)) notices.set(name, await readFile(resolve(directory, "LICENSE"), "utf8"));
}
const noticeText = [...notices]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, text]) => `${name}\n\n${text}`)
  .join("\n\n");
const escapedNotices = noticeText
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  template
    .replace("__CSP__", csp)
    .replace(
      "<!--__NOTICES__-->",
      () => `<template id="custody-notices"><pre>${escapedNotices}</pre></template>`,
    )
    .replace(/<script>\s*__BUNDLE__;?\s*<\/script>/, () => `<script>${script}</script>`),
);
