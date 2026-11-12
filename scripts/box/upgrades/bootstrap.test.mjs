import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { afterAll, expect, it } from "vitest";

const root = mkdtempSync(join(tmpdir(), "upgrade-bootstrap-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const bin = join(root, "bin");
mkdirSync(bin);
for (const [name, source] of Object.entries({
  uname: '#!/bin/sh\n[ "$1" = -s ] && echo Linux || echo "${WT_ARCH:-x86_64}"\n',
  flock: '#!/bin/sh\n[ "${WT_BUSY:-0}" = 0 ]\n',
  curl: '#!/bin/sh\nprintf "%s\\n" "$*" >> "$WT_FETCH_LOG"\nwhile [ "$1" != -o ]; do shift; done\ncp "$WT_ARCHIVE" "$2"\n',
  sha256sum:
    '#!/bin/sh\nIFS= read -r expected\nprintf "%s\\n" "$expected" > "$WT_HASH_LOG"\n[ "${WT_BAD_SUM:-0}" = 0 ] && [ "${expected%% *}" = 982aa24dd8be4c889c6a8ab337ddff3b0896645b20f4239356e80552c16277ee ]\n',
  sync: "#!/bin/sh\nexit 0\n",
})) {
  writeFileSync(join(bin, name), source);
  chmodSync(join(bin, name), 0o755);
}
const archiveRoot = join(root, "archive", "node-v26.7.0-linux-x64");
mkdirSync(join(archiveRoot, "bin"), { recursive: true });
writeFileSync(join(archiveRoot, "bin", "node"), "#!/bin/sh\necho v26.7.0\n", { mode: 0o755 });
writeFileSync(join(archiveRoot, "LICENSE"), "fixture licence notices");
const archive = join(root, "runtime.tar.xz");
execFileSync("tar", ["-cJf", archive, "-C", join(root, "archive"), "node-v26.7.0-linux-x64"]);
const script = fileURLToPath(new URL("./bootstrap.sh", import.meta.url));
function install(knobs = {}) {
  const folder = mkdtempSync(join(root, "case-"));
  const host = join(folder, "host");
  const box = join(folder, "box");
  const result = spawnSync("bash", [script, host, box], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      WT_ARCHIVE: archive,
      WT_FETCH_LOG: join(folder, "fetch.log"),
      WT_HASH_LOG: join(folder, "hash.log"),
      ...knobs,
    },
  });
  return { ...result, folder, host, box };
}

it("installs a checksum-verified pinned host Node with its bundled licence notices", () => {
  const r = install();
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  expect(
    execFileSync(join(r.host, "node-v26.7.0", "bin", "node"), [], { encoding: "utf8" }).trim(),
  ).toBe("v26.7.0");
  expect(readFileSync(join(r.host, "node-v26.7.0", "LICENSE"), "utf8")).toBe(
    "fixture licence notices",
  );
  expect(readFileSync(join(r.folder, "fetch.log"), "utf8")).toContain(
    "https://nodejs.org/dist/v26.7.0/node-v26.7.0-linux-x64.tar.xz",
  );
});

it.each([
  [{ WT_BAD_SUM: "1" }, "checksum mismatch"],
  [{ WT_ARCH: "unknown" }, "unsupported host architecture"],
  [{ WT_BUSY: "1" }, "another host operation"],
])("does not publish an unverified runtime for %j", (knobs, reason) => {
  const r = install(knobs);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain(reason);
  expect(existsSync(join(r.host, "node-v26.7.0"))).toBe(false);
});
