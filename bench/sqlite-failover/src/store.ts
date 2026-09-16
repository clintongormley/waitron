/**
 * The object store every scenario runs against: one MinIO container per store, with an S3 client
 * pointed at it.
 *
 * MinIO stands in for the production store, which is not chosen yet (spec §5). What S6 establishes
 * about conditional writes is therefore a fact about MinIO on the pin below, and the results note
 * carries the standing obligation to re-run it against whatever store Waitron Cloud picks.
 */
import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GenericContainer, Wait } from "testcontainers";

/**
 * Pinned by tag AND digest so a re-run measures the same MinIO.
 * Digest: sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e.
 *
 * quay.io rather than Docker Hub because Docker Hub refuses the image anonymously:
 * `docker pull minio/minio:RELEASE.2025-04-22T22-12-26Z` →
 * "pull access denied for minio/minio, repository does not exist or may require 'docker login'".
 */
const MINIO_IMAGE = "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z";

/** MinIO refuses to start with a root password shorter than 8 characters. */
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
