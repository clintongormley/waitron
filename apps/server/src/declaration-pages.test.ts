import { chmod, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LegalAbout } from "@waitron/shared";
import {
  declarationRoot,
  mountDeclarationPages,
  readDeclarationFolder,
} from "./declaration-pages.js";
import { mountGuidePages } from "./guide-pages.js";
import { DECLARATION_PAGE_WORDS } from "./i18n/declaration-page.js";
import type { Logger } from "./logger.js";
import { writeDeclarationFolder } from "./testing/declaration-folder.js";

let base: string;
let release: string;
let count = 0;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "declaration-pages-"));
  release = join(base, "release");
  await writeDeclarationFolder(release);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

async function newFolder(
  ...args: Parameters<typeof writeDeclarationFolder> extends [string, ...infer Rest] ? Rest : never
): Promise<string> {
  count += 1;
  const dir = join(base, `folder-${count}`);
  await writeDeclarationFolder(dir, ...args);
  return dir;
}

function appFor(root: string, log: Logger = vi.fn()): Hono {
  const app = new Hono();
  mountDeclarationPages(app, { root, build: "test-build" }, log);
  app.get("*", (c) => c.text("spa", 200));
  return app;
}

function between(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(close, start + open.length);
  expect(end).toBeGreaterThan(start);
  return text.slice(start + open.length, end);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]!);
}

const ADDRESSES = ["/legal/declaration", "/legal/declaration.pdf", "/legal/declaration.txt"];

describe("declaration pages", () => {
  it("serves a release's declaration in the box page look, in Spanish", async () => {
    const app = appFor(release);
    const guides = new Hono();
    mountGuidePages(guides, { root: join(base, "no-guides") }, vi.fn());
    const response = await app.request("/legal/declaration", {
      headers: { "Accept-Language": "en" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("PRODUCER PERSON");
    expect(html).toContain(
      'href="/legal/declaration.pdf" download="waitron-1.2.3-declaration.pdf"',
    );
    expect(html).toContain(
      'href="/legal/declaration.txt" download="waitron-1.2.3-declaration.txt"',
    );
    expect(html).toContain("--wt-color-bg");
    const guide = await guides.request("/help/en/products");
    const policy = response.headers.get("content-security-policy");
    expect(policy).toBe(guide.headers.get("content-security-policy"));
    expect(policy).toContain("frame-ancestors 'self'");
  });

  it("the page holds the legal text whole", async () => {
    const html = await (await appFor(release).request("/legal/declaration")).text();
    const rendered = await readFile(join(release, "declaration.html"), "utf8");
    expect(html).toContain(between(rendered, "<body>\n", "\n</body>"));
    const text = await readFile(join(release, "declaration.txt"), "utf8");
    const shown = visibleText(html);
    const lines = text.split("\n").filter((line) => line.trim() !== "");
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(shown).toContain(line.replace(/^- /, ""));
  });

  it("serves the PDF and the text exactly as written", async () => {
    const app = appFor(release);
    for (const [ext, type] of [
      ["pdf", "application/pdf"],
      ["txt", "text/plain; charset=utf-8"],
    ] as const) {
      const response = await app.request(`/legal/declaration.${ext}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(type);
      expect(response.headers.get("content-disposition")).toBe(
        `inline; filename="waitron-1.2.3-declaration.${ext}"`,
      );
      expect(response.headers.get("cache-control")).toBe("no-cache");
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.equals(await readFile(join(release, `declaration.${ext}`)))).toBe(true);
    }
  });

  it("/legal/about names the release and the build", async () => {
    const response = await appFor(release).request("/legal/about");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      release: { version: "1.2.3", releasedOn: "2026-10-22" },
      build: "test-build",
    });
  });

  it("with no folder, the three addresses say this build has none, and nothing is logged", async () => {
    const log = vi.fn();
    const app = appFor(join(base, "absent"), log);
    for (const address of ADDRESSES) {
      const english = await app.request(address);
      expect(english.status).toBe(404);
      expect(english.headers.get("vary")).toBe("Accept-Language");
      const englishHtml = await english.text();
      expect(englishHtml).toContain('<html lang="en">');
      expect(englishHtml).toContain(DECLARATION_PAGE_WORDS.en.noneTitle);
      expect(englishHtml).toContain(DECLARATION_PAGE_WORDS.en.none);
      const spanish = await app.request(address, { headers: { "Accept-Language": "es" } });
      expect(spanish.status).toBe(404);
      const spanishHtml = await spanish.text();
      expect(spanishHtml).toContain('<html lang="es">');
      expect(spanishHtml).toContain(DECLARATION_PAGE_WORDS.es.noneTitle);
    }
    const about = await app.request("/legal/about");
    expect(about.status).toBe(200);
    expect(await about.json()).toEqual({ release: null, build: "test-build" });
    expect(log).not.toHaveBeenCalled();
  });

  async function expectDamaged(root: string, file: string, code?: string): Promise<void> {
    for (const address of ADDRESSES) {
      const log = vi.fn();
      const app = appFor(root, log);
      const response = await app.request(address);
      expect(response.status).toBe(500);
      const html = visibleText(await response.text());
      expect(html).toContain(DECLARATION_PAGE_WORDS.en.damagedTitle);
      expect(html).toContain(DECLARATION_PAGE_WORDS.en.damaged);
      expect(html).not.toContain(DECLARATION_PAGE_WORDS.en.noneTitle);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]).toStrictEqual([
        "warn",
        "declaration.folder_damaged",
        code === undefined ? { file } : { file, code },
      ]);
      const spanish = await app.request(address, { headers: { "Accept-Language": "es" } });
      expect(visibleText(await spanish.text())).toContain(DECLARATION_PAGE_WORDS.es.damagedTitle);
    }
    const about = await appFor(root).request("/legal/about");
    expect(about.status).toBe(200);
    expect(await about.json()).toEqual({ release: null, build: "test-build" });
  }

  it.each(["release.json", "declaration.html", "declaration.pdf", "declaration.txt"])(
    "a folder without %s is damaged",
    async (file) => {
      const root = await newFolder();
      await unlink(join(root, file));
      await expectDamaged(root, file, "ENOENT");
    },
  );

  it.each([
    "{}",
    '{"version":"1.2","releasedOn":"2026-10-22"}',
    '{"version":"1.2.3","releasedOn":"2026-02-30"}',
    '{"version":"1.2.3","releasedOn":"22/10/2026"}',
    '{"version":1,"releasedOn":"2026-10-22"}',
    "null",
    "not json",
  ])("release.json %s is damaged", async (json) => {
    const root = await newFolder();
    await writeFile(join(root, "release.json"), json);
    await expectDamaged(root, "release.json");
  });

  it("a release.json naming another version is damaged", async () => {
    const root = await newFolder();
    await writeFile(
      join(root, "release.json"),
      JSON.stringify({ version: "9.9.9", releasedOn: "2026-10-22" }),
    );
    await expectDamaged(root, "declaration.txt");
  });

  it.each([
    ["11.2.3", "1.2.3"],
    ["1.2.30", "1.2.3"],
    // The library version the declaration names in another paragraph.
    ["1.2.3", "0.2.1"],
  ])(
    "a declaration stating %s beside a release.json naming %s is damaged",
    async (declared, named) => {
      const root = await newFolder(
        { version: named, releasedOn: "2026-10-22" },
        undefined,
        declared,
      );
      await expectDamaged(root, "declaration.txt");
    },
  );

  it("a declaration.txt stating its version on two 1.c) lines is damaged", async () => {
    const root = await newFolder();
    const text = await readFile(join(root, "declaration.txt"), "utf8");
    const line = text.split("\n").find((candidate) => candidate.startsWith("1.c) "))!;
    expect(line.endsWith(": 1.2.3")).toBe(true);
    await writeFile(join(root, "declaration.txt"), `${text}\n${line}\n`);
    await expectDamaged(root, "declaration.txt");
  });

  it.each(["<p>x</p>", "<body>\n<p>x</p>\n</body>\n<body>\n\n</body>", "\n</body><body>\n"])(
    "a declaration.html not in the renderer's shape is damaged: %s",
    async (html) => {
      const root = await newFolder();
      await writeFile(join(root, "declaration.html"), html);
      await expectDamaged(root, "declaration.html");
    },
  );

  it("a folder that is a file, or lies under one, is damaged", async () => {
    const file = join(base, "a-file");
    await writeFile(file, "x");
    await expectDamaged(file, ".");
    await expectDamaged(join(file, "declaration"), ".", "ENOTDIR");
  });

  it.skipIf(process.getuid?.() === 0)("a folder that cannot be read is damaged", async () => {
    const root = await newFolder();
    await chmod(root, 0o000);
    try {
      const log = vi.fn();
      const response = await appFor(root, log).request("/legal/declaration");
      expect(response.status).toBe(500);
      expect(log.mock.calls).toStrictEqual([
        ["warn", "declaration.folder_damaged", { file: "release.json", code: "EACCES" }],
      ]);
    } finally {
      await chmod(root, 0o755);
    }
  });

  it.each([
    "/legal",
    "/legal/",
    "/legal/declaration/",
    "/legal/declaration.PDF",
    "/legal/declaration.html",
    "/legal/x/y",
    "/legal/about/",
  ])("answers its own 404 at %s", async (address) => {
    const app = appFor(release);
    const response = await app.request(address);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).not.toBe("spa");
    expect(html).toContain(DECLARATION_PAGE_WORDS.en.notFoundTitle);
    const spanish = await app.request(address, { headers: { "Accept-Language": "es" } });
    expect(await spanish.text()).toContain(DECLARATION_PAGE_WORDS.es.notFoundTitle);
  });

  it("a producer value with markup stays escaped", async () => {
    const root = await newFolder(undefined, {
      name: "Smith & Sons <Ltd>",
      taxId: "00000000T",
      address: "1 Example Street",
    });
    const html = await (await appFor(root).request("/legal/declaration")).text();
    expect(html).toContain("Smith &amp; Sons &lt;Ltd&gt;");
    expect(html).not.toContain("<Ltd>");
  });

  it("reads the folder beside the module when no root is given", async () => {
    const app = new Hono();
    mountDeclarationPages(app, { build: "test-build" }, vi.fn());
    const found = await readDeclarationFolder(declarationRoot());
    const about = (await (await app.request("/legal/about")).json()) as LegalAbout;
    expect(about.release).toEqual(
      found.kind === "release" ? { version: found.version, releasedOn: found.releasedOn } : null,
    );
  });

  it("finds its folder beside the module", () => {
    expect(declarationRoot()).toBe(fileURLToPath(new URL("./declaration/", import.meta.url)));
  });

  it("names the build from the environment when none is given", async () => {
    vi.stubEnv("WAITRON_BUILD_ID", "env-build");
    try {
      const app = new Hono();
      mountDeclarationPages(app, { root: release }, vi.fn());
      expect(await (await app.request("/legal/about")).json()).toEqual({
        release: { version: "1.2.3", releasedOn: "2026-10-22" },
        build: "env-build",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
