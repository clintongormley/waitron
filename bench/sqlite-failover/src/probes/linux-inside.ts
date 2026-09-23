// Measurement 5, the half that runs inside a Linux container (driven by ./linux-binaries.ts).
// Prints one line: `| m5-inside-<arch> | PASS|FAIL|CONTROL | … |`.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LITESTREAM_VERSION, restore, syncOnce, writeConfig } from "../litestream.ts";
import { openNode, recordSale } from "../model.ts";

type Asset = { name: string; browser_download_url: string; digest?: string };
const MODE = process.env.M5_MODE === "tls-only" ? "tls-only" : "full";
const ARCH = process.arch === "x64" ? "x86_64" : process.arch;
const ASSET = `litestream-${LITESTREAM_VERSION}-linux-${ARCH}.tar.gz`;
const RELEASE_API = `https://api.github.com/repos/benbjohnson/litestream/releases/tags/v${LITESTREAM_VERSION}`;
const STORE = {
  bucket: process.env.M5_BUCKET ?? "",
  endpoint: process.env.M5_ENDPOINT ?? "",
  credentials: {
    accessKeyId: process.env.M5_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.M5_SECRET_ACCESS_KEY ?? "",
  },
};
/** Long enough for the SDK's own retries: the S4 probe saw a first sync error only after 116s. */
const TLS_CHECK_MS = 150_000;

async function download(
  work: string,
): Promise<{ bin: string; sha256: string; matchesRelease: boolean; inChecksums: boolean }> {
  const response = await fetch(RELEASE_API, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "waitron-bench-sqlite-failover",
    },
  });
  if (!response.ok) throw new Error(`${RELEASE_API} answered ${response.status}`);
  const assets = ((await response.json()) as { assets?: Asset[] }).assets ?? [];
  const asset = assets.find((candidate) => candidate.name === ASSET);
  const sums = assets.find((candidate) => candidate.name === "checksums.txt");
  if (!asset || !sums) throw new Error(`release lists no ${ASSET} or no checksums.txt`);
  const tarball = Buffer.from(await (await fetch(asset.browser_download_url)).arrayBuffer());
  const sha256 = createHash("sha256").update(tarball).digest("hex");
  const checksums = await (await fetch(sums.browser_download_url)).text();
  writeFileSync(join(work, ASSET), tarball);
  const untar = spawnSync("tar", ["-xzf", ASSET, "-C", work], { cwd: work, encoding: "utf8" });
  if (untar.status !== 0) throw new Error(`tar exited ${untar.status}: ${untar.stderr}`);
  return {
    bin: join(work, "litestream"),
    sha256,
    matchesRelease: asset.digest === `sha256:${sha256}`,
    inChecksums: checksums
      .split("\n")
      .some((line) => line.includes(sha256) && line.includes(ASSET)),
  };
}

async function roundTrip(
  bin: string,
  work: string,
): Promise<{ equal: boolean; rows: number; controlRefused: boolean }> {
  const dbPath = join(work, "venue.db");
  const node = openNode("box-linux", dbPath);
  let written: string[];
  try {
    for (let i = 0; i < 3; i += 1) recordSale(node, 1000 + i);
    written = node
      .all<{ payload: string }>("SELECT payload FROM records ORDER BY secuencia")
      .map((row) => row.payload);
  } finally {
    node.close();
  }
  const config = writeConfig({
    dbPath,
    store: STORE,
    prefix: `venues/v1/gen-1-linux-${ARCH}-20260923T000000Z`,
    configPath: join(work, "rt.yml"),
  });
  await syncOnce(bin, config);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  const out = join(work, "restored.db");
  await restore(bin, config, dbPath, out);
  const reader = openNode("reader", out);
  let restored: string[];
  try {
    restored = reader
      .all<{ payload: string }>("SELECT payload FROM records ORDER BY secuencia")
      .map((row) => row.payload);
  } finally {
    reader.close();
  }
  const control = writeConfig({
    dbPath,
    store: STORE,
    prefix: `venues/v1/never-streamed-${ARCH}`,
    configPath: join(work, "control.yml"),
  });
  const refusal = await restore(bin, control, dbPath, join(work, "control.db")).then(
    () => "",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  return {
    equal: JSON.stringify(restored) === JSON.stringify(written),
    rows: restored.length,
    controlRefused:
      /no matching backup files available/.test(refusal) && !existsSync(join(work, "control.db")),
  };
}

function tlsCheck(bin: string, work: string): { tls: string; evidence: string } {
  const dbPath = join(work, "tls.db");
  openNode("tls", dbPath).close();
  const config = join(work, "tls.yml");
  // A made-up key and a bucket nobody owns: the only question is WHO refuses — S3, after a
  // completed TLS handshake, or this machine's certificate verification, before one.
  writeFileSync(
    config,
    [
      `dbs:`,
      `  - path: ${dbPath}`,
      `    replica:`,
      `      url: s3://waitron-m5-tls-probe-${process.pid}/x?region=us-east-1`,
      `      access-key-id: AKIAWAITRONPROBE0000`,
      `      secret-access-key: not-a-real-secret`,
      ``,
    ].join("\n"),
  );
  const run = spawnSync(bin, ["replicate", "-once", "-config", config], {
    encoding: "utf8",
    timeout: TLS_CHECK_MS,
  });
  const text = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const last = text.trim().split("\n").at(-1) ?? "";
  if (/x509|certificate signed by unknown authority|certificate verify|tls: failed/i.test(text))
    return { tls: "roots-missing", evidence: last };
  if (
    /InvalidAccessKeyId|AccessDenied|SignatureDoesNotMatch|NoSuchBucket|AuthorizationHeaderMalformed|PermanentRedirect|StatusCode: (301|403)/.test(
      text,
    )
  ) {
    return { tls: "ok", evidence: last };
  }
  return { tls: "not-established", evidence: last };
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "m5-"));
  const machine = uname();
  try {
    const got = await download(work);
    const version = spawnSync(got.bin, ["version"], { encoding: "utf8" }).stdout.trim();
    const detail: Record<string, string | number | boolean> = {
      mode: MODE,
      "uname-m": machine,
      asset: ASSET,
      sha256: got.sha256,
      "sha256-matches-release": got.matchesRelease,
      "sha256-in-checksums": got.inChecksums,
      version,
    };
    let pass = got.matchesRelease && got.inChecksums && version === LITESTREAM_VERSION;
    if (MODE === "full") {
      const trip = await roundTrip(got.bin, work);
      detail["roundtrip-rows"] = `${trip.rows}/3`;
      detail["roundtrip-equal"] = trip.equal;
      detail["control-refused"] = trip.controlRefused;
      pass &&= trip.equal && trip.controlRefused;
    }
    const tls = tlsCheck(got.bin, work);
    detail.tls = tls.tls;
    detail["tls-evidence"] = JSON.stringify(tls.evidence);
    if (MODE === "full") pass &&= tls.tls === "ok";
    const verdict = MODE === "tls-only" ? "CONTROL" : pass ? "PASS" : "FAIL";
    const text = Object.entries(detail)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");
    console.log(`| m5-inside-${process.arch} | ${verdict} | ${text} |`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main().catch((error: unknown) => {
  console.log(
    `| m5-inside-${process.arch} | FAIL | uname-m=${uname()} reason=${JSON.stringify(error instanceof Error ? error.message : String(error))} |`,
  );
  process.exitCode = 1;
});

function uname(): string {
  return spawnSync("uname", ["-m"], { encoding: "utf8" }).stdout.trim();
}
