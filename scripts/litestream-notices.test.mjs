import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers";
import { afterEach, describe, expect, it } from "vitest";
import {
  NOTICE_NAME,
  escapeModulePath,
  generate,
  main,
  noticeFiles,
  parseBuildInfo,
  readZip,
  renderNotices,
} from "./litestream-notices.mjs";

const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "litestream-notices-test-"));
  scratch.push(dir);
  return dir;
};

/**
 * A real zip made by the system `zip` command from `files` (relative path to contents).
 *
 * @param {Record<string, string | Buffer>} files
 * @param {string[]} [flags] extra `zip` flags: `-0` stores, `-D` leaves out directory entries
 */
function makeZip(files, flags = []) {
  const dir = tempDir();
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, "in", path)), { recursive: true });
    writeFileSync(join(dir, "in", path), contents);
  }
  const out = join(dir, "out.zip");
  execFileSync("zip", ["-q", "-r", "-X", ...flags, out, "."], { cwd: join(dir, "in") });
  return readFileSync(out);
}

const CENTRAL = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const END = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

/** `go version -m` output in the shape the Go 1.25 toolchain prints it. */
function buildinfo({
  go = "go1.25.14",
  main = "v0.5.17",
  goarch = "amd64",
  deps = [["github.com/dustin/go-humanize", "v1.0.1"]],
  drop = [],
  extra = [],
} = {}) {
  const lines = [
    `bin/litestream: ${go}`,
    "\tpath\tgithub.com/benbjohnson/litestream/cmd/litestream",
    `\tmod\tgithub.com/benbjohnson/litestream\t${main}\t`,
    ...deps.map(([path, version]) => `\tdep\t${path}\t${version}\th1:c2Fsdw==`),
    ...extra,
    "\tbuild\t-buildmode=exe",
    '\tbuild\t-ldflags="-s -w -X main.Version=0.5.17"',
    "\tbuild\tCGO_ENABLED=0",
    `\tbuild\tGOARCH=${goarch}`,
    "\tbuild\tGOOS=linux",
    "\tbuild\tvcs=git",
  ];
  return `${lines.filter((line) => !drop.some((word) => line.includes(word))).join("\n")}\n`;
}

const TOOLCHAIN = "golang.org/toolchain@v0.0.1-go1.25.14.linux-amd64";
const TOOLCHAIN_ARM64 = "golang.org/toolchain@v0.0.1-go1.25.14.linux-arm64";
const PROXY = "https://proxy.golang.org";

/**
 * A `fetch` serving module zips by proxy URL, answering 404 for anything else, and recording the
 * URLs asked for and the most requests it had in flight at once.
 *
 * @param {Record<string, Buffer>} zips
 */
function fakeProxy(zips) {
  const urls = [];
  let inFlight = 0;
  const seen = { maxInFlight: 0 };
  const fetch = async (url) => {
    urls.push(url);
    inFlight += 1;
    seen.maxInFlight = Math.max(seen.maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    const bytes = zips[url];
    if (bytes === undefined) {
      return { ok: false, status: 404, statusText: "Not Found", arrayBuffer: async () => null };
    }
    return { ok: true, status: 200, statusText: "OK", arrayBuffer: async () => bytes };
  };
  return { fetch, urls, seen };
}

const MIT = "MIT License\n\nCopyright (c) someone\n";
const BSD = "Copyright (c) 2009 The Go Authors. All rights reserved.\n";
const APACHE = "Apache License\nVersion 2.0, January 2004\n";

/** A toolchain archive for `id`, holding a notice under `src/cmd/` and one under `testdata`. */
const toolchainZip = (id) =>
  makeZip({
    [`${id}/LICENSE`]: BSD,
    [`${id}/src/vendor/golang.org/x/net/LICENSE`]: BSD,
    [`${id}/src/cmd/vendor/golang.org/x/mod/LICENSE`]: "compiler only\n",
    [`${id}/src/internal/testdata/LICENSE`]: "fixture only\n",
  });

/**
 * Zips for Litestream, the linux-amd64 and linux-arm64 toolchains and go-humanize, keyed by the
 * URL the proxy serves each at.
 */
function standardZips() {
  return {
    [`${PROXY}/github.com/benbjohnson/litestream/@v/v0.5.17.zip`]: makeZip({
      "github.com/benbjohnson/litestream@v0.5.17/LICENSE": APACHE,
      "github.com/benbjohnson/litestream@v0.5.17/main.go": "package main\n",
    }),
    [`${PROXY}/golang.org/toolchain/@v/v0.0.1-go1.25.14.linux-amd64.zip`]: toolchainZip(TOOLCHAIN),
    [`${PROXY}/golang.org/toolchain/@v/v0.0.1-go1.25.14.linux-arm64.zip`]:
      toolchainZip(TOOLCHAIN_ARM64),
    [`${PROXY}/github.com/dustin/go-humanize/@v/v1.0.1.zip`]: makeZip({
      "github.com/dustin/go-humanize@v1.0.1/LICENSE": MIT,
    }),
  };
}

describe("NOTICE_NAME", () => {
  // Fails if the pattern turns case-sensitive, or stops allowing a prefix before the licence word or
  // a suffix after `.`, `-` or `_`.
  it.each([
    "LICENSE",
    "LICENCE",
    "license",
    "LICENSE.txt",
    "LICENSE.md",
    "LICENSE-3RD-PARTY.md",
    "LICENSE.libyaml",
    "License_MIT",
    "COPYING",
    "NOTICE",
    "NOTICE.txt",
    "PATENTS",
    "SQLITE-LICENSE",
    "third_party.NOTICE.txt",
  ])("matches %s", (name) => {
    expect(NOTICE_NAME.test(name)).toBe(true);
  });

  // Fails if the pattern loses its anchors, its separator requirement or its exclusion of names
  // ending in a listed source or script extension.
  it.each([
    "license.go",
    "LICENSE_test.go",
    "licenses_test.go",
    "notice.go",
    "notice.c",
    "notice.h",
    "check_license.sh",
    "license-check.yml",
    "LICENSES",
    "licensed.txt",
    "xLICENSE",
    "SQLITELICENSE",
  ])("does not match %s", (name) => {
    expect(NOTICE_NAME.test(name)).toBe(false);
  });
});

describe("parseBuildInfo", () => {
  // Fails if any field is read from the wrong line or column.
  it("reads the Go version, the main module, the platform and every dependency", () => {
    expect(
      parseBuildInfo(
        buildinfo({
          goarch: "arm64",
          deps: [
            ["cloud.google.com/go", "v0.112.0"],
            ["github.com/Azure/azure-sdk-for-go/sdk/azcore", "v1.18.2"],
          ],
        }),
      ),
    ).toEqual({
      go: "go1.25.14",
      main: { path: "github.com/benbjohnson/litestream", version: "v0.5.17" },
      goos: "linux",
      goarch: "arm64",
      deps: [
        { path: "cloud.google.com/go", version: "v0.112.0" },
        { path: "github.com/Azure/azure-sdk-for-go/sdk/azcore", version: "v1.18.2" },
      ],
    });
  });

  // Fails if a replacement line is skipped: the replaced module's notices would be fetched from
  // the source the binary was not built from.
  it("refuses a replaced module, naming the line", () => {
    const text = buildinfo({ extra: ["\t=>\tgithub.com/fork/go-humanize\tv1.0.2\th1:c2Fsdw=="] });
    expect(() => parseBuildInfo(text)).toThrow(
      /replaced module.*=>\tgithub\.com\/fork\/go-humanize/,
    );
  });

  // Fails if a missing line is let through as `undefined`.
  it.each([
    ["the Go version", ": go1.25.14"],
    ["the main module", "\tmod\t"],
    ["GOOS", "GOOS="],
    ["GOARCH", "GOARCH="],
  ])("refuses output with no line for %s", (what, word) => {
    expect(() => parseBuildInfo(buildinfo({ drop: [word] }))).toThrow(/not `go version -m` output/);
  });
});

describe("escapeModulePath", () => {
  // Fails if capitals are passed through: the proxy answers 404 for them.
  it("writes each capital as ! and its lower case", () => {
    expect(escapeModulePath("github.com/Azure/azure-sdk-for-go")).toBe(
      "github.com/!azure/azure-sdk-for-go",
    );
    expect(escapeModulePath("github.com/BurntSushi/toml")).toBe("github.com/!burnt!sushi/toml");
    expect(escapeModulePath("v1.0.0-RC1")).toBe("v1.0.0-!r!c1");
  });
});

describe("readZip", () => {
  const files = {
    "a/LICENSE": "stored or deflated, the same bytes come back\n".repeat(20),
    "a/b/NOTICE": "second entry\n",
  };

  // Fails if either compression method is decoded wrongly or the names are misread.
  it.each([
    ["stored", ["-0"]],
    ["deflated", []],
  ])("reads the names and bytes of a %s archive", (_, flags) => {
    const zip = readZip(makeZip(files, flags));
    expect(zip.names).toEqual(expect.arrayContaining(["a/", "a/b/", "a/LICENSE", "a/b/NOTICE"]));
    expect(zip.read("a/LICENSE").toString()).toBe(files["a/LICENSE"]);
    expect(zip.read("a/b/NOTICE").toString()).toBe(files["a/b/NOTICE"]);
  });

  // Fails if an unknown name returns undefined or empty bytes.
  it("refuses a name the archive does not hold", () => {
    const zip = readZip(makeZip(files));
    expect(() => zip.read("a/COPYING")).toThrow(/no entry a\/COPYING/);
  });

  // Fails if a buffer without an end record is read as an empty archive.
  it("refuses bytes with no end-of-central-directory record", () => {
    expect(() => readZip(Buffer.from("not a zip at all"))).toThrow(/end-of-central-directory/);
  });

  // Fails if the zip64 markers in the end record are read as real counts and offsets.
  it.each([
    ["entry count", 10, 2],
    ["directory size", 12, 4],
    ["directory offset", 16, 4],
  ])("refuses a zip64 archive, marked by a saturated %s", (_, at, width) => {
    const bytes = makeZip(files, ["-D"]);
    const end = bytes.lastIndexOf(END);
    bytes.fill(0xff, end + at, end + at + width);
    expect(() => readZip(bytes)).toThrow(/zip64/);
  });

  // Fails if the directory's signature is not checked, so a wrong offset lists garbage names.
  it("refuses a central directory that is not where the end record says", () => {
    const bytes = makeZip(files);
    bytes.writeUInt32LE(0, bytes.lastIndexOf(END) + 16);
    expect(() => readZip(bytes)).toThrow(/central directory entry 0 has no signature/);
  });

  /** A one-entry stored archive with `patch` applied at the entry's central-directory record. */
  const patched = (patch, flags = ["-0", "-D"]) => {
    const bytes = makeZip({ "a/LICENSE": "one entry\n" }, flags);
    patch(bytes, bytes.indexOf(CENTRAL));
    return readZip(bytes);
  };

  // Fails if a zip64 entry's saturated size or offset is used as a real one.
  it.each([
    ["compressed size", 20],
    ["size", 24],
    ["local header offset", 42],
  ])("refuses an entry whose %s is a zip64 marker", (_, at) => {
    const zip = patched((bytes, entry) => bytes.writeUInt32LE(0xffffffff, entry + at));
    expect(() => zip.read("a/LICENSE")).toThrow(/zip64/);
  });

  // Fails if an unknown method's bytes are returned as if stored.
  it("refuses a compression method other than stored or deflate", () => {
    const zip = patched((bytes, entry) => bytes.writeUInt16LE(12, entry + 10));
    expect(() => zip.read("a/LICENSE")).toThrow(/compression method 12/);
  });

  // Fails if an encrypted entry's ciphertext is returned as its text.
  it("refuses an encrypted entry", () => {
    const zip = readZip(makeZip({ "a/LICENSE": "secret\n" }, ["-D", "-P", "password"]));
    expect(() => zip.read("a/LICENSE")).toThrow(/encrypted/);
  });

  // Fails if the local header is not checked, so a wrong offset reads arbitrary bytes.
  it("refuses an entry whose local header is not where the directory says", () => {
    const zip = patched((bytes, entry) => bytes.writeUInt32LE(1, entry + 42));
    expect(() => zip.read("a/LICENSE")).toThrow(/local header/);
  });

  // Fails if the decoded length is not compared with the recorded size.
  it("refuses an entry that does not come to its recorded size", () => {
    const zip = patched((bytes, entry) => bytes.writeUInt32LE(3, entry + 24));
    expect(() => zip.read("a/LICENSE")).toThrow(/10 bytes, not the recorded 3/);
  });
});

describe("noticeFiles", () => {
  const root = "example.com/m@v1.0.0/";

  // Fails if nested notice files are dropped or the result is left in archive order.
  it("returns every notice file under the root, at any depth, relative and sorted", () => {
    const names = [
      `${root}sub/deeper/COPYING`,
      `${root}LICENSE`,
      `${root}NOTICE.txt`,
      `${root}main.go`,
      `${root}license.go`,
    ];
    expect(noticeFiles(names, root)).toEqual(["LICENSE", "NOTICE.txt", "sub/deeper/COPYING"]);
  });

  // Fails if any one of the exclusions is removed: each excluded name would appear.
  it("leaves out directories, testdata, hidden directories, other roots and skipped prefixes", () => {
    const names = [
      `${root}LICENSE`,
      `${root}LICENSE/`,
      `${root}internal/testdata/LICENSE`,
      `${root}.github/workflows/license-check.yml`,
      `example.com/other@v1.0.0/LICENSE`,
      `${root}src/cmd/vendor/x/LICENSE`,
    ];
    expect(noticeFiles(names, root, { skip: ["src/cmd/"] })).toEqual(["LICENSE"]);
  });
});

describe("renderNotices", () => {
  const input = {
    litestream: "0.5.17",
    go: "go1.25.14",
    platforms: ["linux/amd64", "linux/arm64"],
    modules: [
      { path: "golang.org/toolchain", version: "v0.0.1-go1.25.14.linux-amd64", files: [] },
      {
        path: "a.example/one",
        version: "v1.0.0",
        files: [
          { path: "LICENSE", text: BSD },
          { path: "PATENTS", text: "no trailing newline" },
        ],
      },
      { path: "b.example/two", version: "v2.0.0", files: [{ path: "LICENSE", text: BSD }] },
      { path: "c.example/three", version: "v3.0.0", files: [{ path: "LICENSE", text: MIT }] },
    ],
  };

  // Fails if the header moves or changes; the version line is read by another suite's pattern.
  it("opens with the four header lines", () => {
    const text = renderNotices(input);
    expect(text.split("\n").slice(0, 4)).toEqual([
      "Third-party notices for Litestream, the program at /usr/local/bin/litestream in the Waitron box image",
      "Litestream version: 0.5.17",
      "Built with: go1.25.14",
      "Generated by: node scripts/litestream-notices.mjs <out> <go version -m output>...",
    ]);
    expect(text.match(/^Litestream version: ([0-9.]+)$/m)?.[1]).toBe("0.5.17");
    expect(text).toContain("linux/amd64, linux/arm64");
  });

  // Fails if a module is left out of the list or the list is reordered.
  it("lists every module with its version, in the order given", () => {
    const text = renderNotices(input);
    expect(text).toContain(
      [
        "Modules (4):",
        "golang.org/toolchain v0.0.1-go1.25.14.linux-amd64",
        "a.example/one v1.0.0",
        "b.example/two v2.0.0",
        "c.example/three v3.0.0",
        "",
      ].join("\n"),
    );
  });

  // Fails if identical texts are printed once per file, or distinct texts are merged.
  it("prints each distinct text once, under every file that carries it", () => {
    const text = renderNotices(input);
    expect(text.split(BSD)).toHaveLength(2);
    expect(text).toContain("Distinct texts: 3\n");
    expect(text).toContain(`a.example/one@v1.0.0/LICENSE\nb.example/two@v2.0.0/LICENSE\n\n${BSD}`);
    expect(text).toContain(`c.example/three@v3.0.0/LICENSE\n\n${MIT}`);
  });

  // Fails if texts are merged before a missing final newline is added: the two would print as
  // separate, identical blocks.
  it("merges texts that differ only in a missing final newline", () => {
    const text = renderNotices({
      ...input,
      modules: [
        { path: "a.example/one", version: "v1.0.0", files: [{ path: "LICENSE", text: APACHE }] },
        {
          path: "b.example/two",
          version: "v2.0.0",
          files: [{ path: "LICENSE", text: APACHE.slice(0, -1) }],
        },
      ],
    });
    expect(text.split(APACHE)).toHaveLength(2);
    expect(text).toContain("Distinct texts: 1\n");
    expect(text).toContain(
      `a.example/one@v1.0.0/LICENSE\nb.example/two@v2.0.0/LICENSE\n\n${APACHE}`,
    );
  });

  // Fails if a text without a final newline runs into the next separator, or the file does not
  // end with exactly one newline.
  it("keeps each text on lines of its own and ends the file with one newline", () => {
    const text = renderNotices(input);
    expect(text).toContain("no trailing newline\n=");
    expect(text.endsWith(`${MIT}`)).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("generate", () => {
  const both = [buildinfo(), buildinfo({ goarch: "arm64" })];

  // Fails if a platform's toolchain is not asked for, or is asked for at another version, a URL
  // is not case-encoded, or a module both binaries list is downloaded twice.
  it("downloads Litestream, each platform's toolchain and each dependency once", async () => {
    const zips = standardZips();
    zips[`${PROXY}/github.com/!azure/azcore/@v/v1.0.0-!r!c1.zip`] = makeZip({
      "github.com/Azure/azcore@v1.0.0-RC1/LICENSE.txt": MIT,
    });
    const proxy = fakeProxy(zips);
    const azure = [["github.com/Azure/azcore", "v1.0.0-RC1"]];
    await generate({
      buildinfos: [
        buildinfo({ deps: [["github.com/dustin/go-humanize", "v1.0.1"], ...azure] }),
        buildinfo({ goarch: "arm64", deps: [["github.com/dustin/go-humanize", "v1.0.1"]] }),
      ],
      fetch: proxy.fetch,
    });
    expect([...proxy.urls].sort()).toEqual(Object.keys(zips).sort());
  });

  // Fails if one platform's toolchain stands in for every platform, or the toolchains are listed
  // out of order.
  it("reads the toolchain of each platform the binaries were built for", async () => {
    const zips = standardZips();
    zips[`${PROXY}/golang.org/toolchain/@v/v0.0.1-go1.25.14.linux-arm64.zip`] = makeZip({
      [`${TOOLCHAIN_ARM64}/LICENSE`]: BSD,
      [`${TOOLCHAIN_ARM64}/src/runtime/NOTICE`]: "arm64 only\n",
    });
    const proxy = fakeProxy(zips);
    const text = await generate({
      buildinfos: [buildinfo({ goarch: "arm64" }), buildinfo()],
      fetch: proxy.fetch,
    });
    expect(proxy.urls).toEqual(
      expect.arrayContaining([
        `${PROXY}/golang.org/toolchain/@v/v0.0.1-go1.25.14.linux-amd64.zip`,
        `${PROXY}/golang.org/toolchain/@v/v0.0.1-go1.25.14.linux-arm64.zip`,
      ]),
    );
    expect(text).toContain(
      [
        "Modules (4):",
        "github.com/benbjohnson/litestream v0.5.17",
        "golang.org/toolchain v0.0.1-go1.25.14.linux-amd64",
        "golang.org/toolchain v0.0.1-go1.25.14.linux-arm64",
        "github.com/dustin/go-humanize v1.0.1",
        "",
      ].join("\n"),
    );
    expect(text).toContain(`${TOOLCHAIN_ARM64}/src/runtime/NOTICE\n\narm64 only\n`);
  });

  // Fails if a single binary's toolchain is fetched for a platform it was not built for.
  it("reads only the toolchain of a single binary's platform", async () => {
    const proxy = fakeProxy(standardZips());
    await generate({ buildinfos: [buildinfo({ goarch: "arm64" })], fetch: proxy.fetch });
    expect(proxy.urls.filter((url) => url.includes("/golang.org/toolchain/"))).toEqual([
      `${PROXY}/golang.org/toolchain/@v/v0.0.1-go1.25.14.linux-arm64.zip`,
    ]);
  });

  // Fails if either toolchain's `src/cmd/` or any `testdata` directory is not skipped, if a
  // dependency only one binary lists is dropped, or if a text two modules share is printed twice.
  it("renders every module's notices once each, skipping the compiler's tree and test fixtures", async () => {
    const zips = standardZips();
    zips[`${PROXY}/example.com/arm-only/@v/v1.0.0.zip`] = makeZip({
      "example.com/arm-only@v1.0.0/COPYING": BSD,
    });
    const text = await generate({
      buildinfos: [
        buildinfo(),
        buildinfo({
          goarch: "arm64",
          deps: [
            ["github.com/dustin/go-humanize", "v1.0.1"],
            ["example.com/arm-only", "v1.0.0"],
          ],
        }),
      ],
      fetch: fakeProxy(zips).fetch,
    });
    expect(text).toContain(
      [
        "Modules (5):",
        "github.com/benbjohnson/litestream v0.5.17",
        "golang.org/toolchain v0.0.1-go1.25.14.linux-amd64",
        "golang.org/toolchain v0.0.1-go1.25.14.linux-arm64",
        "example.com/arm-only v1.0.0",
        "github.com/dustin/go-humanize v1.0.1",
      ].join("\n"),
    );
    expect(text).toContain(
      [
        `${TOOLCHAIN}/LICENSE`,
        `${TOOLCHAIN}/src/vendor/golang.org/x/net/LICENSE`,
        `${TOOLCHAIN_ARM64}/LICENSE`,
        `${TOOLCHAIN_ARM64}/src/vendor/golang.org/x/net/LICENSE`,
        "example.com/arm-only@v1.0.0/COPYING",
        "",
        BSD,
      ].join("\n"),
    );
    expect(text.split(BSD)).toHaveLength(2);
    expect(text).toContain(`github.com/benbjohnson/litestream@v0.5.17/LICENSE\n\n${APACHE}`);
    expect(text).toContain(`github.com/dustin/go-humanize@v1.0.1/LICENSE\n\n${MIT}`);
    expect(text).toContain("linux/amd64, linux/arm64");
    expect(text).not.toContain("compiler only");
    expect(text).not.toContain("fixture only");
  });

  // Fails if dependencies are sorted by `path@version`, which puts `/` (0x2f) before `@` (0x40)
  // and so lists a module's sub-modules above the module itself.
  it("lists dependencies by module path, a module before its sub-modules", async () => {
    const zips = standardZips();
    const deps = [
      ["cloud.google.com/go/storage", "v1.36.0"],
      ["cloud.google.com/go", "v0.112.0"],
    ];
    for (const [path, version] of deps) {
      zips[`${PROXY}/${path}/@v/${version}.zip`] = makeZip({ [`${path}@${version}/LICENSE`]: MIT });
    }
    const text = await generate({
      buildinfos: [buildinfo({ deps })],
      fetch: fakeProxy(zips).fetch,
    });
    expect(text).toContain("cloud.google.com/go v0.112.0\ncloud.google.com/go/storage v1.36.0\n");
  });

  // Fails if the in-flight bound is removed: every download would start at once.
  it("keeps at most the given number of downloads in flight", async () => {
    const zips = standardZips();
    const deps = ["a", "b", "c", "d"].map((name) => [`example.com/${name}`, "v1.0.0"]);
    for (const [path] of deps) {
      zips[`${PROXY}/${path}/@v/v1.0.0.zip`] = makeZip({ [`${path}@v1.0.0/LICENSE`]: MIT });
    }
    const proxy = fakeProxy(zips);
    await generate({ buildinfos: [buildinfo({ deps })], fetch: proxy.fetch, concurrency: 2 });
    expect(proxy.urls).toHaveLength(6);
    expect(proxy.seen.maxInFlight).toBe(2);
  });

  // Fails if the Go versions are not compared: the toolchain notices would belong to one binary.
  it("refuses binaries built with different Go versions", async () => {
    await expect(
      generate({
        buildinfos: [buildinfo(), buildinfo({ go: "go1.25.13" })],
        fetch: fakeProxy({}).fetch,
      }),
    ).rejects.toThrow(/different Go versions: go1\.25\.13, go1\.25\.14/);
  });

  // Fails if the main module versions are not compared.
  it("refuses binaries of different Litestream versions", async () => {
    await expect(
      generate({
        buildinfos: [buildinfo(), buildinfo({ main: "v0.5.16" })],
        fetch: fakeProxy({}).fetch,
      }),
    ).rejects.toThrow(/different main modules/);
  });

  // Fails if an empty list renders a file with no modules in it.
  it("refuses an empty list of binaries", async () => {
    await expect(generate({ buildinfos: [], fetch: fakeProxy({}).fetch })).rejects.toThrow(
      /at least one/,
    );
  });

  // Fails if a replacement line reaching `generate` is not refused before any download.
  it("refuses a replaced module before downloading anything", async () => {
    const proxy = fakeProxy(standardZips());
    const replaced = buildinfo({ extra: ["\t=>\t../local\t"] });
    await expect(generate({ buildinfos: [replaced], fetch: proxy.fetch })).rejects.toThrow(
      /replaced module/,
    );
    expect(proxy.urls).toEqual([]);
  });

  // Fails if a failed download is skipped instead of stopping the run.
  it("refuses a download the proxy answers with an error, naming the module", async () => {
    const zips = standardZips();
    delete zips[`${PROXY}/github.com/dustin/go-humanize/@v/v1.0.1.zip`];
    await expect(generate({ buildinfos: both, fetch: fakeProxy(zips).fetch })).rejects.toThrow(
      /github\.com\/dustin\/go-humanize@v1\.0\.1: .* answered 404 Not Found/,
    );
  });

  // Fails if a rejected request surfaces without the module it was for.
  it("refuses a download that fails outright, naming the module", async () => {
    const fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(generate({ buildinfos: both, fetch })).rejects.toThrow(
      /(github\.com\/benbjohnson\/litestream|golang\.org\/toolchain|github\.com\/dustin\/go-humanize)@v\S+: fetch failed/,
    );
  });

  // Fails if a module with no notice file is shipped without one.
  it("refuses a module with no notice file, naming it", async () => {
    const zips = standardZips();
    zips[`${PROXY}/github.com/dustin/go-humanize/@v/v1.0.1.zip`] = makeZip({
      "github.com/dustin/go-humanize@v1.0.1/humanize.go": "package humanize\n",
    });
    await expect(generate({ buildinfos: both, fetch: fakeProxy(zips).fetch })).rejects.toThrow(
      /github\.com\/dustin\/go-humanize@v1\.0\.1: no notice file/,
    );
  });

  // Fails if texts are decoded leniently: invalid bytes would be printed as replacement characters.
  it("refuses a notice that is not UTF-8, naming the module", async () => {
    const zips = standardZips();
    zips[`${PROXY}/github.com/dustin/go-humanize/@v/v1.0.1.zip`] = makeZip({
      "github.com/dustin/go-humanize@v1.0.1/LICENSE": Buffer.from([0x43, 0xa9, 0x0a]),
    });
    await expect(generate({ buildinfos: both, fetch: fakeProxy(zips).fetch })).rejects.toThrow(
      /github\.com\/dustin\/go-humanize@v1\.0\.1: .*utf-8/i,
    );
  });

  // Fails if the decoder strips a leading byte-order mark, which is its default.
  it("keeps a byte-order mark at the start of a notice", async () => {
    const zips = standardZips();
    zips[`${PROXY}/github.com/dustin/go-humanize/@v/v1.0.1.zip`] = makeZip({
      "github.com/dustin/go-humanize@v1.0.1/LICENSE": Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(MIT),
      ]),
    });
    const text = await generate({ buildinfos: both, fetch: fakeProxy(zips).fetch });
    expect(text).toContain(`github.com/dustin/go-humanize@v1.0.1/LICENSE\n\n\uFEFF${MIT}`);
  });
});

describe("main", () => {
  const USAGE = "usage: node scripts/litestream-notices.mjs <out> <go version -m output>...";

  const run = async (argv) => {
    const out = [];
    const err = [];
    const code = await main(argv, {
      fetch: fakeProxy(standardZips()).fetch,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });
    return { code, out, err };
  };

  // Fails if a missing output path or a missing input is not refused with the usage line.
  it.each([
    ["no arguments", []],
    ["an output path but no input", ["out.txt"]],
  ])("exits 2 with the usage line given %s", async (_, argv) => {
    expect(await run(argv)).toEqual({ code: 2, out: [], err: [USAGE] });
  });

  // Fails if the inputs are not read from the named files, the output's directory is not made,
  // or the rendered text is not what is written.
  it("writes the notices for the named inputs, making the output's directory", async () => {
    const dir = tempDir();
    const inputs = [join(dir, "amd64.txt"), join(dir, "arm64.txt")];
    writeFileSync(inputs[0], buildinfo());
    writeFileSync(inputs[1], buildinfo({ goarch: "arm64" }));
    const out = join(dir, "nested", "deeper", "NOTICES.txt");

    expect(await run([out, ...inputs])).toEqual({ code: 0, out: [`wrote ${out}`], err: [] });
    const expected = await generate({
      buildinfos: [buildinfo(), buildinfo({ goarch: "arm64" })],
      fetch: fakeProxy(standardZips()).fetch,
    });
    expect(readFileSync(out, "utf8")).toBe(expected);
    expect(expected).toContain("linux/amd64, linux/arm64");
  });
});
