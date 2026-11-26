import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GenericContainer, Wait } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";

// Include the digest to pin what runs and the tag to identify the release.
export const MINIO_IMAGE =
  "quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e";

// MinIO enforces credential lengths at startup, before the client can issue requests.
export const ROOT_USER = "waitronbench";
export const ROOT_PASSWORD = "waitronbench";
export const BUCKET = "waitron-failover";

export type Store = {
  endpoint: string;
  client: S3Client;
  bucket: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  putJson(key: string, value: unknown): Promise<void>;
  getJson(key: string): Promise<unknown>;
  listKeys(prefix: string): Promise<string[]>;
  stop(): Promise<void>;
};

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
    // Use path-style requests so the bucket stays in the request path MinIO serves.
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
