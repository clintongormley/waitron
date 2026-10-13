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
        prefix: "venue/archives/v1",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "secret",
      },
    });
    expect(backend).toBeInstanceOf(S3Backend);
    expect(backend.id).toBe("offsite");
    (backend as S3Backend).close();
  });
});
