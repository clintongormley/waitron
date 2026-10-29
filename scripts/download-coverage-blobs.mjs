import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function readResponse(url, token, status, consume) {
  const response = await globalThis.fetch(url, {
    headers: token
      ? { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }
      : {},
    redirect: "manual",
    signal: globalThis.AbortSignal.timeout(40_000),
  });
  try {
    if (response.status !== status)
      throw new Error(`Artifact request refused (${response.status})`);
    return await consume(response);
  } finally {
    // Close a refused connection even when its server never finishes the response body.
    if (!response.bodyUsed) await response.body?.cancel();
  }
}

export async function downloadCoverageBlobs({
  repository,
  runId,
  token,
  pattern,
  directory,
  expected,
  apiUrl = "https://api.github.com",
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    repository.includes("..") ||
    !/^[1-9]\d*$/.test(runId ?? "") ||
    !token ||
    !/^[a-z][a-z-]+-blob-\*$/.test(pattern ?? "") ||
    !/^[1-9]\d*$/.test(String(expected))
  ) {
    throw new Error("Invalid coverage download inputs");
  }
  apiUrl ||= "https://api.github.com";
  const prefix = pattern.slice(0, -1);
  const artifacts = [];
  for (let page = 1; ; page += 1) {
    const listing = await readResponse(
      `${apiUrl}/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`,
      token,
      200,
      (response) => response.json(),
    );
    artifacts.push(...listing.artifacts.filter((artifact) => artifact.name.startsWith(prefix)));
    if (listing.artifacts.length < 100) break;
  }
  if (artifacts.length === 0) throw new Error("No matching coverage artifacts");
  const latest = new Map();
  for (const artifact of artifacts) {
    if (!Number.isSafeInteger(artifact.id) || artifact.id < 1)
      throw new Error("Invalid coverage artifact id");
    const previous = latest.get(artifact.name);
    if (!previous || artifact.id > previous.id) latest.set(artifact.name, artifact);
  }
  if (latest.size !== Number(expected))
    throw new Error(`Expected ${expected} coverage reports, found ${latest.size}`);
  const reports = [...latest.values()].map((artifact) => {
    const suffix = new RegExp(`^${prefix}([1-9]\\d*|stream)$`).exec(artifact.name)?.[1];
    if (!suffix || artifact.expired || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "")) {
      throw new Error("Invalid coverage artifact metadata");
    }
    return { ...artifact, reportName: `blob-${suffix}.json` };
  });
  for (const artifact of reports) {
    const location = await readResponse(
      `${apiUrl}/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
      token,
      302,
      (response) => response.headers.get("location"),
    );
    if (!location) throw new Error("Missing artifact download location");
    const archive = await readResponse(location, undefined, 200, async (response) =>
      Buffer.from(await response.arrayBuffer()),
    );
    if (`sha256:${createHash("sha256").update(archive).digest("hex")}` !== artifact.digest) {
      throw new Error("Coverage artifact digest mismatch");
    }
    const temporary = await mkdtemp(join(tmpdir(), "coverage-archive-"));
    try {
      const zip = join(temporary, "report.zip");
      const name = artifact.reportName;
      await writeFile(zip, archive);
      const files = execFileSync("unzip", ["-Z1", zip], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
        .trim()
        .split("\n");
      if (files.length !== 1 || files[0] !== name)
        throw new Error("Unexpected coverage archive entries");
      const report = execFileSync("unzip", ["-p", zip, name], { maxBuffer: 128 * 1024 * 1024 });
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, name), report);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  downloadCoverageBlobs({
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    token: process.env.GH_TOKEN,
    apiUrl: process.env.GITHUB_API_URL,
    pattern: process.argv[2],
    directory: process.argv[3],
    expected: process.argv[4],
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
