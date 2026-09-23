// Measurement 5 (slice-2 spec §8.1 item 5): the pinned binary on Linux, both processor types.
//
// For each of linux/amd64 and linux/arm64: build `node:26-slim` + ca-certificates (deploy/Dockerfile's
// runtime stage installs them the same way), run ./linux-inside.ts in it against a MinIO on a private
// Docker network (mode `full`), then run the TLS half alone in bare `node:26-slim` (mode `tls-only`,
// the control).
//
// FAILING result — `LINUX_BINARIES_RUN=false`, with the failing platform's inside line showing which
// of sha256-matches-release, version, roundtrip-equal, control-refused or tls is wrong.
// PASSING result — `LINUX_BINARIES_RUN=true` and both inside lines reading PASS.
// CONTROL — each bare-image line should read `tls=roots-missing`; `tls=ok` there prints
// `tls-control=indistinguishable`, and the TLS half is then not established by this probe.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { BUCKET, MINIO_IMAGE, ROOT_PASSWORD, ROOT_USER } from "../store.ts";
import { report, sleep } from "./common.ts";

const PROBE = "m5-linux-binaries";
const RIG = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE_IMAGE = "node:26-slim";
const CA_DOCKERFILE = [
  `FROM ${BASE_IMAGE}`,
  `RUN set -eux; apt-get update; apt-get install -y --no-install-recommends ca-certificates; rm -rf /var/lib/apt/lists/*`,
  ``,
].join("\n");
const PLATFORMS = [
  { platform: "linux/amd64", tag: "amd64" },
  { platform: "linux/arm64", tag: "arm64" },
] as const;
const RUN_ID = `waitron-m5-${process.pid}`;
/** The label `scripts/reap-testcontainers.mjs` selects on, so an interrupted run is reapable. */
const LABEL = "com.waitron.reapable=true";

function docker(args: string[], options: { input?: string; timeoutMs?: number } = {}): string {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input: options.input,
    timeout: options.timeoutMs ?? 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`docker ${args.join(" ")} exited ${result.status}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function waitForHealth(endpoint: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ok = await fetch(`${endpoint}/minio/health/live`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`MinIO at ${endpoint} never answered its health check`);
}

function inside(
  platform: string,
  image: string,
  network: string,
  mode: "full" | "tls-only",
): string {
  const run = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--platform",
      platform,
      "--network",
      network,
      "--label",
      LABEL,
      "-v",
      `${RIG}:/rig:ro`,
      "-e",
      `M5_MODE=${mode}`,
      "-e",
      "M5_ENDPOINT=http://minio:9000",
      "-e",
      `M5_BUCKET=${BUCKET}`,
      "-e",
      `M5_ACCESS_KEY_ID=${ROOT_USER}`,
      "-e",
      `M5_SECRET_ACCESS_KEY=${ROOT_PASSWORD}`,
      image,
      "node",
      "/rig/src/probes/linux-inside.ts",
    ],
    { encoding: "utf8", timeout: 900_000 },
  );
  return (
    (run.stdout ?? "")
      .split("\n")
      .filter((line) => line.startsWith("| m5-inside"))
      .at(-1) ??
    `| m5-inside | NO-RESULT | exit=${run.status} stderr=${JSON.stringify((run.stderr ?? "").trim().slice(-400))} |`
  );
}

async function main(): Promise<void> {
  const hostArch = docker(["version", "--format", "{{.Server.Arch}}"]);
  const network = RUN_ID;
  const minio = `${RUN_ID}-minio`;
  docker(["network", "create", "--label", LABEL, network]);
  try {
    docker(
      [
        "run",
        "-d",
        "--name",
        minio,
        "--label",
        LABEL,
        "--network",
        network,
        "--network-alias",
        "minio",
        "-p",
        "127.0.0.1::9000",
        "-e",
        `MINIO_ROOT_USER=${ROOT_USER}`,
        "-e",
        `MINIO_ROOT_PASSWORD=${ROOT_PASSWORD}`,
        MINIO_IMAGE,
        "server",
        "/data",
      ],
      { timeoutMs: 600_000 },
    );
    const port = docker(["port", minio, "9000/tcp"]).split("\n")[0]!.split(":").at(-1)!;
    const endpoint = `http://127.0.0.1:${port}`;
    await waitForHealth(endpoint);
    const client = new S3Client({
      endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: ROOT_USER, secretAccessKey: ROOT_PASSWORD },
    });
    try {
      await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } finally {
      client.destroy();
    }

    const lines: Record<string, string> = {};
    let allPass = true;
    for (const { platform, tag } of PLATFORMS) {
      const image = `${RUN_ID}-ca:${tag}`;
      docker(["build", "--platform", platform, "--label", LABEL, "-t", image, "-"], {
        input: CA_DOCKERFILE,
        timeoutMs: 900_000,
      });
      try {
        const full = inside(platform, image, network, "full");
        const control = inside(platform, BASE_IMAGE, network, "tls-only");
        console.log(full);
        console.log(control);
        allPass &&= full.includes("| PASS |");
        lines[`${tag}-pass`] = full.includes("| PASS |") ? "true" : "false";
        lines[`${tag}-sha256`] = /sha256=([0-9a-f]{64})/.exec(full)?.[1] ?? "unknown";
        lines[`${tag}-tls-control`] = control.includes("tls=roots-missing")
          ? "discriminates"
          : control.includes("tls=ok")
            ? "indistinguishable"
            : "not-established";
      } finally {
        docker(["image", "rm", "-f", image]);
      }
    }
    report(PROBE, `LINUX_BINARIES_RUN=${allPass}`, {
      "host-arch": hostArch,
      "base-image": BASE_IMAGE,
      ...lines,
    });
  } finally {
    spawnSync("docker", ["rm", "-f", minio], { encoding: "utf8" });
    spawnSync("docker", ["network", "rm", network], { encoding: "utf8" });
  }
}

await main().catch((error: unknown) => {
  report(PROBE, "VOID", { reason: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
