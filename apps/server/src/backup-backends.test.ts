import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildBackupBackend } from "./backup-backends.js";
import { LocalFsBackend } from "./local-fs-backend.js";
import { S3Backend } from "./s3-backend.js";

describe("buildBackupBackend", () => {
  it("builds a folder destination as a local backend under its id", () => {
    const backend = buildBackupBackend({ kind: "local-fs", id: "usb", dir: "/mnt/usb" });
    expect(backend).toBeInstanceOf(LocalFsBackend);
    expect(backend.id).toBe("usb");
  });

  it("builds a bucket destination as a bucket backend under its id", () => {
    const backend = buildBackupBackend({
      kind: "s3",
      id: "offsite",
      bucket: {
        region: "eu-north-1",
        bucket: "archives",
        prefix: "nightly",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "secret",
      },
    });
    expect(backend).toBeInstanceOf(S3Backend);
    expect(backend.id).toBe("offsite");
    (backend as S3Backend).close();
  });

  it("keeps a bucket destination's objects under the selected archive folder", async () => {
    const asked: { method: string; path: string; prefix: unknown }[] = [];
    const backend = buildBackupBackend(
      {
        kind: "s3",
        id: "bucket",
        bucket: {
          endpoint: "https://s3.example.test",
          region: "eu-north-1",
          bucket: "owner-bucket",
          prefix: "/box/",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "secret",
        },
      },
      {
        requestHandler: {
          async handle(request: { method: string; path: string; query: Record<string, unknown> }) {
            asked.push({
              method: request.method,
              path: request.path,
              prefix: request.query.prefix,
            });
            const body =
              request.method === "GET"
                ? "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"
                : "";
            return {
              response: {
                statusCode: 200,
                headers: { "content-type": "application/xml", etag: '"e"' },
                body: Readable.from(body === "" ? [] : [Buffer.from(body)]),
              },
            };
          },
        } as never,
      },
    );
    const call = { signal: new AbortController().signal };
    await backend.put("probe", new Uint8Array([1]), call);
    await backend.list("waitron-", call);
    backend.close();
    expect(asked[0]).toMatchObject({ method: "PUT" });
    expect(asked[0]!.path).toMatch(/box\/probe$/);
    expect(asked[1]).toMatchObject({ method: "GET", prefix: "box/waitron-" });
  });
});
