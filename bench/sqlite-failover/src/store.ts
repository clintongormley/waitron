/**
 * The object store every scenario runs against: one MinIO container per store, with an S3 client
 * pointed at it.
 *
 * MinIO stands in for the production store, which is not chosen yet (spec §5). What S6 will
 * establish about conditional writes is therefore a fact about MinIO on the pin below; the standing
 * obligation to re-run it against whatever store Waitron Cloud picks belongs in the results note
 * this rig's last task writes, `docs/research/2026-09-16-sqlite-failover-prototype.md` (plan Task
 * 10). Neither that note nor the S6 measurement exists yet.
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GenericContainer, Wait } from "testcontainers";

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
  putJson(key: string, value: unknown): Promise<void>;
  getJson(key: string): Promise<unknown>;
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
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
    .start();

  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    // Without it, against this image: `CreateBucket` answers
    // `BadRequest: An unsupported API call for method: PUT at '/'` — the SDK's default
    // virtual-host style leaves the bucket out of the path MinIO reads.
    forcePathStyle: true,
    credentials: { accessKeyId: ROOT_USER, secretAccessKey: ROOT_PASSWORD },
  });
  await client.send(new CreateBucketCommand({ Bucket: BUCKET }));

  return {
    endpoint,
    client,
    bucket: BUCKET,
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
    async stop() {
      client.destroy();
      await container.stop();
    },
  };
}
