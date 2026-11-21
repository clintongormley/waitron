import { execFileSync } from "node:child_process";
import { isNumberedVersion } from "./box/release-list.mjs";

const FOLDER = "packages/fiscal-verifactu/declarations";
const isVersionTag = (name) => name.startsWith("v") && isNumberedVersion(name.slice(1));

/**
 * What breaks "a released declaration never changes" in `repo` at `HEAD`, one line per problem:
 * a release tag whose declaration is missing at `HEAD` or differs from the tag's copy, or
 * a declaration in a checkout with no tags at all.
 *
 * @param {string} repo
 * @returns {string[]}
 */
export function releasedDeclarationProblems(repo) {
  const tags = git(repo, "tag", "--list");
  const atHead = blobs(repo, "HEAD");
  const declared = [...atHead.keys()].filter(isVersionTag);
  if (tags.length === 0)
    return declared.map(
      (name) =>
        `${FOLDER}/${name}.md exists but this checkout holds no tags at all, so it cannot tell a released version from a prepared one`,
    );

  const problems = [];
  const released = tags.filter(isVersionTag);
  for (const name of released) {
    const path = `${FOLDER}/${name}.md`;
    const atTag = blobs(repo, name).get(name);
    if (atTag === undefined) problems.push(`tag ${name} holds no ${path}`);
    else if (!atHead.has(name)) problems.push(`${path} was released as ${name} but is missing`);
    else if (atHead.get(name) !== atTag) problems.push(`${path} differs from its release ${name}`);
  }
  return problems;
}

/** Each `v*.md` declaration at `ref`, by version (`v1.2.3`), to its blob id. */
function blobs(repo, ref) {
  const entries = new Map();
  for (const line of git(repo, "ls-tree", ref, "--", `${FOLDER}/`)) {
    const [meta, path] = line.split("\t");
    const name = /\/(v[^/]+)\.md$/.exec(path)?.[1];
    if (name !== undefined) entries.set(name, meta.split(" ")[2]);
  }
  return entries;
}

// The caller's GIT_DIR and its family would point git at another repository than `repo`.
function git(repo, ...args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "");
}
