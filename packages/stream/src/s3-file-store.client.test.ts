import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createS3FileStore } from "./s3-file-store.js";
import type { BucketConfig } from "./s3-client.js";

// The real client, built as the store asks, so the settings it was given can be read.
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: vi.fn(function (config: S3ClientConfig) {
      return new actual.S3Client(config);
    }),
  };
});

const CONFIG: BucketConfig = {
  region: "eu-south-2",
  bucket: "owner-bucket",
  prefix: "",
  accessKeyId: "AKIAEXAMPLE0000",
  secretAccessKey: "not-a-real-secret",
};

describe("the client the file store builds", () => {
  it("is the shared bucket client, sending a checksum only where the request requires one", () => {
    createS3FileStore(CONFIG);
    const settings = vi.mocked(S3Client).mock.calls.at(-1)![0]!;
    expect(settings).toMatchObject({
      region: "eu-south-2",
      maxAttempts: 3,
      requestHandler: { socketTimeout: 30_000 },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  });

  it("is destroyed when the store is closed", () => {
    const store = createS3FileStore(CONFIG);
    const client = vi.mocked(S3Client).mock.results.at(-1)!.value as S3Client;
    const destroy = vi.spyOn(client, "destroy");
    store.close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
