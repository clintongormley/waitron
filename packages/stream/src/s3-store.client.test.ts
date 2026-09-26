import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createS3ObjectStore, type BucketConfig } from "./s3-store.js";

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

const lastClientSettings = (): S3ClientConfig => vi.mocked(S3Client).mock.calls.at(-1)![0]!;

describe("the client the store builds", () => {
  it("gives a request up after thirty seconds with nothing sent or received on its connection", () => {
    createS3ObjectStore(CONFIG);
    expect(lastClientSettings().requestHandler).toEqual({ socketTimeout: 30_000 });
  });

  it("takes a test's own network as given", () => {
    const network = { handle: vi.fn() };
    createS3ObjectStore(CONFIG, { requestHandler: network, idleMs: 5 });
    expect(lastClientSettings().requestHandler).toBe(network);
  });
});
