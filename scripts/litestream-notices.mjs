/**
 * `node scripts/litestream-notices.mjs <out> <go version -m output>...` — writes the licence and
 * notice texts of everything compiled into the pinned Litestream binary. Litestream is a statically
 * linked Go program, so it carries every Go module it was built from plus the Go standard library
 * and runtime; each module's notice files are copied from its zip on proxy.golang.org unchanged,
 * except that a text with no final newline is given one.
 * The inputs are `go version -m` run on the pinned linux binaries the box image installs
 * (`deploy/Dockerfile`, the `litestream` stage).
 */
import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";
import { inflateRawSync } from "node:zlib";

/**
 * A notice file's base name, which may put words before the licence word (`SQLITE-LICENSE`). A
 * name ending in one of the source or script extensions listed at its end is refused.
 */
export const NOTICE_NAME =
  /^(?:[a-z0-9]+[._-])*(?:licen[cs]e|copying|notice|patents)(?:[._-].*)?(?<!\.(?:go|s|c|h|cc|cpp|sh|py|js|ts|yml|yaml))$/i;

const PROXY = "https://proxy.golang.org";
const TOOLCHAIN = "golang.org/toolchain";
/** The toolchain's compiler and tools, which are not linked into the programs it builds. */
const TOOLCHAIN_SKIP = ["src/cmd/"];

/**
 * @typedef {{ path: string, version: string }} Module
 * @typedef {{ go: string, main: Module, goos: string, goarch: string, deps: Module[] }} BuildInfo
 */

/**
 * Reads `go version -m` output for one binary.
 *
 * @param {string} text
 * @returns {BuildInfo}
 */
export function parseBuildInfo(text) {
  const lines = text.split("\n");
  const go = lines[0].match(/: (go\S+)$/)?.[1];
  /** @type {Module | undefined} */
  let main;
  const deps = [];
  const build = new Map();
  for (const line of lines.slice(1)) {
    const [kind, first, second] = line.replace(/^\t/, "").split("\t");
    if (kind === "=>") {
      // Its notices would be fetched from the module it replaced, not the code in the binary.
      throw new Error(`replaced module in the build information: ${line}`);
    }
    if (kind === "mod") main = { path: first, version: second };
    if (kind === "dep") deps.push({ path: first, version: second });
    if (kind === "build") {
      const [key, value] = first.split(/=(.*)/);
      build.set(key, value);
    }
  }
  const goos = build.get("GOOS");
  const goarch = build.get("GOARCH");
  if (!go || !main || !goos || !goarch) {
    throw new Error(
      `not \`go version -m\` output: it needs a Go version, a mod line, GOOS and GOARCH\n${text}`,
    );
  }
  return { go, main, goos, goarch, deps };
}

/**
 * The module proxy's case encoding: each capital becomes `!` and its lower case.
 *
 * @param {string} s
 */
export function escapeModulePath(s) {
  return s.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}

const END_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;

/**
 * Lists a zip archive's entries and reads their bytes. It handles stored and deflated entries in
 * an archive without zip64 extensions, and refuses anything else.
 *
 * @param {Buffer} buffer
 * @returns {{ names: string[], read(name: string): Buffer }}
 */
export function readZip(buffer) {
  const end = buffer.lastIndexOf(END_SIGNATURE);
  if (end < 0) throw new Error("not a zip archive: no end-of-central-directory record");
  const count = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  let at = buffer.readUInt32LE(end + 16);
  if (count === MAX16 || size === MAX32 || at === MAX32) {
    throw new Error("a zip64 archive, which this reader does not handle");
  }

  /** @type {Map<string, { flags: number, method: number, compressed: number, size: number, offset: number }>} */
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error(`central directory entry ${i} has no signature at offset ${at}`);
    }
    const nameLength = buffer.readUInt16LE(at + 28);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    entries.set(name, {
      flags: buffer.readUInt16LE(at + 8),
      method: buffer.readUInt16LE(at + 10),
      compressed: buffer.readUInt32LE(at + 20),
      size: buffer.readUInt32LE(at + 24),
      offset: buffer.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }

  return {
    names: [...entries.keys()],
    read(name) {
      const entry = entries.get(name);
      if (entry === undefined) throw new Error(`the archive has no entry ${name}`);
      const { flags, method, compressed, size, offset } = entry;
      if (compressed === MAX32 || size === MAX32 || offset === MAX32) {
        throw new Error(`${name} carries zip64 sizes, which this reader does not handle`);
      }
      if (flags & 1) throw new Error(`${name} is encrypted`);
      if (method !== 0 && method !== 8) {
        throw new Error(`${name} uses compression method ${method}; only 0 and 8 are handled`);
      }
      if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
        throw new Error(`${name} has no local header at offset ${offset}`);
      }
      const start =
        offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
      const raw = buffer.subarray(start, start + compressed);
      const data = method === 0 ? raw : inflateRawSync(raw);
      if (data.length !== size) {
        throw new Error(`${name} came to ${data.length} bytes, not the recorded ${size}`);
      }
      return data;
    },
  };
}

/**
 * The notice files under `root` in an archive's entry names, relative to `root` and sorted.
 * Test fixtures, hidden tooling directories such as `.github` and anything under a `skip` prefix
 * are left out.
 *
 * @param {string[]} names
 * @param {string} root ends with `/`
 * @param {{ skip?: string[] }} [options]
 */
export function noticeFiles(names, root, { skip = [] } = {}) {
  return names
    .filter((name) => name.startsWith(root))
    .map((name) => name.slice(root.length))
    .filter((relative) => {
      const parts = relative.split("/");
      const base = parts.pop();
      return (
        NOTICE_NAME.test(base) &&
        !parts.some((part) => part === "testdata" || part.startsWith(".")) &&
        !skip.some((prefix) => relative.startsWith(prefix))
      );
    })
    .sort();
}

const RULE = "=".repeat(80);

/**
 * @param {object} input
 * @param {string} input.litestream Litestream's version, without the leading `v`
 * @param {string} input.go the Go version the binaries were built with
 * @param {string[]} input.platforms `GOOS/GOARCH` of each binary read
 * @param {Array<Module & { files: Array<{ path: string, text: string }> }>} input.modules
 */
export function renderNotices({ litestream, go, platforms, modules }) {
  /** @type {Map<string, string[]>} each distinct text, and the files that carry it */
  const texts = new Map();
  for (const { path, version, files } of modules) {
    for (const file of files) {
      const text = file.text.endsWith("\n") ? file.text : `${file.text}\n`;
      const carriers = texts.get(text) ?? [];
      carriers.push(`${path}@${version}/${file.path}`);
      texts.set(text, carriers);
    }
  }

  const head = [
    "Third-party notices for Litestream, the program at /usr/local/bin/litestream in the Waitron box image",
    `Litestream version: ${litestream}`,
    `Built with: ${go}`,
    "Generated by: node scripts/litestream-notices.mjs <out> <go version -m output>...",
    "",
    "This file holds the licence and notice texts of everything compiled into that program.",
    "Litestream is a single statically linked Go program, so it contains the Go modules it was built",
    "from and the Go standard library and runtime.",
    "",
    "How it was made: `go version -m` was run on the pinned Litestream release binaries for",
    `${platforms.join(", ")}, which lists the Go modules each binary was built from. Each module's`,
    "archive was downloaded from proxy.golang.org, and every file named as a licence, notice, copying",
    "or patents file was copied here, other than names ending in an extension the generator lists as",
    "source code or a script, from any directory except test fixtures (testdata) and hidden tooling",
    "directories such as .github. Each text is unchanged, except that one with no final newline is",
    "given one. A file in a subdirectory is included whether or not the program uses that",
    "directory's code. The Go standard library and runtime",
    `come from the golang.org/toolchain module, one version for ${go} on each of those platforms,`,
    "leaving out src/cmd/, which holds the compiler and tools rather than code built into programs.",
    "Litestream's own licence is included as its module's LICENSE file.",
    "",
    "Identical texts are printed once, below the list of every file that carries them.",
    "",
    `Modules (${modules.length}):`,
    ...modules.map(({ path, version }) => `${path} ${version}`),
    "",
    `Distinct texts: ${texts.size}`,
    "",
  ].join("\n");

  const body = [...texts].map(([text, carriers]) => [RULE, ...carriers, "", text].join("\n"));
  return `${head}${body.join("")}`;
}

/**
 * Runs `task` over `items`, at most `limit` at a time, keeping the results in order.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} task
 * @returns {Promise<R[]>}
 */
async function mapBounded(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The notices file for the binaries whose `go version -m` output is `buildinfos`.
 *
 * @param {object} options
 * @param {string[]} options.buildinfos
 * @param {(url: string) => Promise<{ ok: boolean, status: number, statusText: string, arrayBuffer(): Promise<ArrayBuffer> }>} [options.fetch]
 * @param {number} [options.concurrency] downloads in flight at once
 */
export async function generate({ buildinfos, fetch = globalThis.fetch, concurrency = 8 }) {
  if (buildinfos.length === 0) throw new Error("needs at least one `go version -m` output");
  const infos = buildinfos.map(parseBuildInfo);
  const distinct = (/** @type {string[]} */ values) => [...new Set(values)].sort();
  const goVersions = distinct(infos.map((info) => info.go));
  if (goVersions.length > 1) {
    throw new Error(`the binaries were built with different Go versions: ${goVersions.join(", ")}`);
  }
  const mains = distinct(infos.map(({ main }) => `${main.path}@${main.version}`));
  if (mains.length > 1) {
    throw new Error(`the binaries are of different main modules: ${mains.join(", ")}`);
  }
  const [go] = goVersions;
  const { main } = infos[0];

  // A module path holds only letters, digits, `-._~` and `/` (`modPathOK` in
  // golang.org/x/mod/module), all above a space, so a module sorts before its sub-modules.
  const deps = new Map(
    infos.flatMap((info) => info.deps).map((dep) => [`${dep.path} ${dep.version}`, dep]),
  );
  const toolchains = distinct(infos.map((info) => `v0.0.1-${go}.${info.goos}-${info.goarch}`)).map(
    (version) => ({ path: TOOLCHAIN, version }),
  );
  const modules = [main, ...toolchains, ...[...deps.keys()].sort().map((key) => deps.get(key))];

  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const withNotices = await mapBounded(modules, concurrency, async (module) => {
    const id = `${module.path}@${module.version}`;
    const url = `${PROXY}/${escapeModulePath(module.path)}/@v/${escapeModulePath(module.version)}.zip`;
    try {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`${url} answered ${response.status} ${response.statusText}`);
      const zip = readZip(Buffer.from(await response.arrayBuffer()));
      const skip = module.path === TOOLCHAIN ? TOOLCHAIN_SKIP : [];
      const paths = noticeFiles(zip.names, `${id}/`, { skip });
      if (paths.length === 0) throw new Error(`no notice file in ${url}`);
      const files = paths.map((path) => ({
        path,
        text: decoder.decode(zip.read(`${id}/${path}`)),
      }));
      return { ...module, files };
    } catch (error) {
      throw new Error(`${id}: ${/** @type {Error} */ (error).message}`, { cause: error });
    }
  });

  return renderNotices({
    litestream: main.version.replace(/^v/, ""),
    go,
    platforms: distinct(infos.map((info) => `${info.goos}/${info.goarch}`)),
    modules: withNotices,
  });
}

/**
 * @param {string[]} argv
 * @param {object} io
 * @param {(line: string) => void} io.stdout
 * @param {(line: string) => void} io.stderr
 * @param {Parameters<typeof generate>[0]["fetch"]} [io.fetch]
 * @returns {Promise<number>} the exit status
 */
export async function main(argv, { stdout, stderr, fetch }) {
  const [out, ...inputs] = argv;
  if (out === undefined || inputs.length === 0) {
    stderr("usage: node scripts/litestream-notices.mjs <out> <go version -m output>...");
    return 2;
  }
  const buildinfos = inputs.map((file) => readFileSync(file, "utf8"));
  const text = await generate({ buildinfos, fetch });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  stdout(`wrote ${out}`);
  return 0;
}

/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: console.log,
    stderr: console.error,
  });
}
/* v8 ignore stop */
