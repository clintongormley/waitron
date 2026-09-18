/**
 * The object store the scenarios that need one run against: one MinIO container per store, with an
 * S3 client pointed at it. S2 and S5 need none — each models its hand-over between two in-memory
 * SQLite databases.
 *
 * MinIO stands in for the production store, which is not chosen yet (spec §5), so what S6
 * (`store-cas.ts`) establishes about conditional writes is a fact about MinIO on the pin below.
 * Re-running that against whatever store Waitron Cloud picks is an obligation the results note,
 * `docs/research/2026-09-16-sqlite-failover-prototype.md` (plan Task 10), will record; that note does
 * not exist yet.
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GenericContainer, Wait } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";

/**
 * Tag AND digest in the one reference the container is actually started from, so the pull resolves
 * the digest while a reader still sees which release it is. Testcontainers accepts that combined
 * form: `pnpm --filter @waitron/bench-sqlite-failover scenarios` starts a container from this exact
 * string and the smoke scenario passes.
 *
 * quay.io rather than Docker Hub because Docker Hub refuses this image anonymously:
 * `docker pull minio/minio:RELEASE.2025-09-07T16-13-09Z` →
 * "Error response from daemon: pull access denied for minio/minio, repository does not exist or may
 * require 'docker login'".
 */
const MINIO_IMAGE =
  "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e";

/**
 * The credentials are length-constrained, and MinIO refuses to START rather than refusing a request.
 * `docker run --rm -e MINIO_ROOT_USER=short -e MINIO_ROOT_PASSWORD=short
 * quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z server /data` →
 * "FATAL Unable to validate credentials inherited from the shell environment: Invalid credentials",
 * hinting "MINIO_ROOT_USER length should be at least 3, and MINIO_ROOT_PASSWORD length at least 8
 * characters". That run exercised the PASSWORD rule only — `short` is five characters, which already
 * satisfies the ≥3 user rule; the user rule is MinIO's own hint text, not something this run showed.
 */
const ROOT_USER = "waitronbench";
const ROOT_PASSWORD = "waitronbench";
const BUCKET = "waitron-failover";

export type Store = {
  /** `http://host:port` of this store's MinIO container. */
  endpoint: string;
  client: S3Client;
  bucket: string;
  /**
   * The same root credentials the `client` holds, exposed because a second reader needs them: the
   * litestream child process gets them through its environment (`litestream.ts`), and it does not
   * share this client.
   */
  credentials: { accessKeyId: string; secretAccessKey: string };
  putJson(key: string, value: unknown): Promise<void>;
  getJson(key: string): Promise<unknown>;
  /** Every key under `prefix`, whatever a page of the listing holds. */
  listKeys(prefix: string): Promise<string[]>;
  stop(): Promise<void>;
};

/**
 * A fresh container per call: a scenario that raced conditional writes against a store another
 * scenario had already written to would be reading someone else's keys.
 */
export async function startStore(): Promise<Store> {
  const container = await new GenericContainer(MINIO_IMAGE)
    .withCommand(["server", "/data"])
    .withEnvironment({ MINIO_ROOT_USER: ROOT_USER, MINIO_ROOT_PASSWORD: ROOT_PASSWORD })
    // The label scripts/reap-testcontainers.mjs filters on, and the only one it filters on.
    .withLabels({ "com.waitron.reapable": "true" })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
    .start();

  // Everything after `.start()` runs under this guard: a failure there hands the caller an
  // exception instead of a `stop()`, so the container is nobody's to stop afterwards.
  try {
    return await connect(container);
  } catch (error) {
    // The stop's own failure is swallowed: it would otherwise replace the bucket-creation error the
    // caller needs with a Docker one, which names neither the failure nor the leak.
    await container.stop().catch(() => {});
    throw error;
  }
}

async function connect(container: StartedTestContainer): Promise<Store> {
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  const credentials = { accessKeyId: ROOT_USER, secretAccessKey: ROOT_PASSWORD };
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    // Without it, against this image: `CreateBucket` answers
    // `BadRequest: An unsupported API call for method: PUT at '/'` — the SDK's default
    // virtual-host style leaves the bucket out of the path MinIO reads.
    forcePathStyle: true,
    credentials,
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (error) {
    client.destroy();
    throw error;
  }

  return {
    endpoint,
    client,
    bucket: BUCKET,
    credentials,
    async putJson(key, value) {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: JSON.stringify(value),
          ContentType: "application/json",
        }),
      );
    },
    async getJson(key) {
      const output = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      if (!output.Body) throw new Error(`no body for ${key}`);
      return JSON.parse(await output.Body.transformToString());
    },
    async listKeys(prefix) {
      // The continuation loop is not decoration for a rig that writes a handful of keys: the
      // listing comes back a page at a time, and a caller that counted a prefix from one page would
      // read a truncated answer as the whole truth. Measured in this worktree on 2026-09-17 against
      // the pinned image, with 1005 keys written under one prefix: a single `ListObjectsV2` answered
      // `keys=1000 truncated=true`, while this loop returned `keys=1005 unique=1005`.
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
        );
        for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async stop() {
      client.destroy();
      await container.stop();
    },
  };
}
