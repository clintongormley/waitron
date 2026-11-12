import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { releasedDeclarationProblems } from "./released-declarations.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FOLDER = "packages/fiscal-verifactu/declarations";
const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): void {
  execFileSync("git", ["-C", repo, ...args], { env: CLEAN_ENV, stdio: "pipe" });
}

/** A scratch repository whose first commit holds a README and the given declarations. */
function repository(files: Record<string, string> = {}): string {
  const repo = mkdtempSync(join(tmpdir(), "released-declarations-"));
  scratch.push(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "tag.gpgsign", "false");
  writeFileSync(join(repo, "README"), "scratch\n");
  commit(repo, files, "first");
  return repo;
}

function commit(repo: string, files: Record<string, string>, message: string): void {
  mkdirSync(join(repo, FOLDER), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, FOLDER, name), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", message);
}

const tag = (repo: string, name: string) => git(repo, "tag", name);

describe("releasedDeclarationProblems", () => {
  it("passes a checkout with no declarations and no tags", () => {
    expect(releasedDeclarationProblems(repository())).toEqual([]);
  });

  it("fails a declaration in a checkout holding no tags at all", () => {
    const problems = releasedDeclarationProblems(repository({ "v1.0.0.md": "one\n" }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("v1.0.0.md");
  });

  it("passes the one prepared version when some other tag exists", () => {
    const repo = repository({ "v1.0.0.md": "one\n" });
    tag(repo, "pre-sqlite-migration");
    expect(releasedDeclarationProblems(repo)).toEqual([]);
  });

  it("fails a version below the highest that has no tag of its own", () => {
    const repo = repository({ "v1.0.0.md": "one\n", "v1.0.1.md": "two\n" });
    tag(repo, "pre-sqlite-migration");
    const problems = releasedDeclarationProblems(repo);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no tag v1.0.0");
  });

  it("orders versions as numbers, not text", () => {
    const repo = repository({ "v1.0.9.md": "nine\n", "v1.0.10.md": "ten\n" });
    tag(repo, "v1.0.9");
    expect(releasedDeclarationProblems(repo)).toEqual([]);
  });

  it("orders versions past JavaScript's exact whole numbers", () => {
    const repo = repository({
      "v9007199254740992.0.0.md": "lower\n",
      "v9007199254740993.0.0.md": "higher\n",
    });
    tag(repo, "v9007199254740993.0.0");
    const problems = releasedDeclarationProblems(repo);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no tag v9007199254740992.0.0");
  });

  it("passes a tagged version whose file is unchanged", () => {
    const repo = repository({ "v1.0.0.md": "one\n", "template.md": "t\n" });
    tag(repo, "v1.0.0");
    commit(repo, { "template.md": "changed\n" }, "later");
    expect(releasedDeclarationProblems(repo)).toEqual([]);
  });

  it("fails a tagged version whose file was edited after the tag", () => {
    const repo = repository({ "v1.0.0.md": "one\n" });
    tag(repo, "v1.0.0");
    commit(repo, { "v1.0.0.md": "edited\n" }, "edit");
    const problems = releasedDeclarationProblems(repo);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("v1.0.0");
  });

  it("fails a tagged version whose file was deleted after the tag", () => {
    const repo = repository({ "v1.0.0.md": "one\n" });
    tag(repo, "v1.0.0");
    unlinkSync(join(repo, FOLDER, "v1.0.0.md"));
    commit(repo, {}, "delete");
    const problems = releasedDeclarationProblems(repo);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("v1.0.0");
  });

  it("fails a version tag whose commit holds no declaration", () => {
    const repo = repository();
    tag(repo, "v1.0.0");
    const problems = releasedDeclarationProblems(repo);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("v1.0.0");
  });

  it("ignores tags and files that are not plain versions", () => {
    const repo = repository({ "v01.0.0.md": "x\n", "template.md": "t\n", "notes.md": "n\n" });
    for (const name of ["pre-sqlite-migration", "v1.2", "v1.2.3-rc1"]) tag(repo, name);
    expect(releasedDeclarationProblems(repo)).toEqual([]);
  });

  // 50 characters is the most a record's version holds (`isReleaseVersion` in @waitron/shared).
  it("ignores a tag and a file whose version is longer than 50 characters", () => {
    const long = `v1.0.${"9".repeat(47)}`;
    const repo = repository({ [`${long}.md`]: "long\n", "v1.0.0.md": "one\n" });
    tag(repo, long);
    commit(repo, { [`${long}.md`]: "edited\n" }, "edit");
    expect(releasedDeclarationProblems(repo)).toEqual([]);
  });

  it("finds nothing wrong in this repository", () => {
    expect(releasedDeclarationProblems(ROOT)).toEqual([]);
  });
});
