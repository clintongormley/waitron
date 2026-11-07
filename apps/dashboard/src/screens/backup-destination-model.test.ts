import { describe, expect, it } from "vitest";
import type { BackupDestinationView, BackupStatusView } from "../api/client.js";
import { EMPTY_CUSTOM, destinationsBody, openingDestinations } from "./backup-destination-model.js";

const stream = {
  endpoint: "https://s3.example.test",
  region: "eu-west-1",
  bucket: "stream-bucket",
  prefix: "venue/",
  accessKeyId: "AKSTREAM",
};

const folder: BackupDestinationView = { id: "d1", kind: "local-fs", dir: "/srv/backups" };
const streamMatched: BackupDestinationView = {
  id: "d2",
  kind: "s3",
  ...stream,
  namespace: "venue/archives/v1/",
  credentialPresent: true,
};
const otherBucket: BackupDestinationView = {
  id: "d3",
  kind: "s3",
  endpoint: null,
  region: "us-east-1",
  bucket: "other",
  prefix: "copies",
  accessKeyId: "AKOTHER",
  namespace: "copies/archives/v1/",
  credentialPresent: true,
};

function status(destinations: BackupDestinationView[]): BackupStatusView {
  return { destinations } as BackupStatusView;
}

const otherCustom = {
  endpoint: "",
  region: "us-east-1",
  bucket: "other",
  prefix: "copies",
  accessKeyId: "AKOTHER",
  secretAccessKey: "",
};

describe("openingDestinations", () => {
  it("opens a fresh box with the folder on, empty, and no bucket", () => {
    expect(openingDestinations(status([]), stream)).toEqual({
      folderOn: true,
      folder: "",
      bucket: "none",
      custom: EMPTY_CUSTOM,
    });
  });

  it("opens a stored folder alone with the folder on and no bucket", () => {
    expect(openingDestinations(status([folder]), stream)).toEqual({
      folderOn: true,
      folder: "/srv/backups",
      bucket: "none",
      custom: EMPTY_CUSTOM,
    });
  });

  it("opens a stored bucket matching the bucket copy's as the bucket copy's bucket, folder off", () => {
    expect(openingDestinations(status([streamMatched]), stream)).toEqual({
      folderOn: false,
      folder: "",
      bucket: "stream-bucket",
      custom: EMPTY_CUSTOM,
    });
  });

  it("opens another stored bucket with its fields and no secret, folder off", () => {
    expect(openingDestinations(status([otherBucket]), stream)).toEqual({
      folderOn: false,
      folder: "",
      bucket: "custom-s3",
      custom: otherCustom,
    });
  });

  it("reads a bucket matching nothing as another bucket when there is no bucket copy", () => {
    expect(openingDestinations(status([streamMatched]), null).bucket).toBe("custom-s3");
  });

  it("opens a stored folder and bucket together, whichever is listed first", () => {
    const both = {
      folderOn: true,
      folder: "/srv/backups",
      bucket: "custom-s3",
      custom: otherCustom,
    };
    expect(openingDestinations(status([folder, otherBucket]), stream)).toEqual(both);
    expect(openingDestinations(status([otherBucket, folder]), stream)).toEqual(both);
    expect(openingDestinations(status([streamMatched, folder]), stream)).toEqual({
      ...both,
      bucket: "stream-bucket",
      custom: EMPTY_CUSTOM,
    });
  });

  it("returns a custom copy the caller can change without touching EMPTY_CUSTOM", () => {
    const opened = openingDestinations(status([]), null);
    opened.custom.bucket = "changed";
    expect(EMPTY_CUSTOM.bucket).toBe("");
  });
});

const typed = {
  endpoint: "  https://s3.other.test  ",
  region: " us-east-1 ",
  bucket: " other ",
  prefix: " copies ",
  accessKeyId: " AKOTHER ",
  secretAccessKey: " s3cret ",
};
const customEntry = {
  kind: "custom-s3",
  endpoint: "https://s3.other.test",
  region: "us-east-1",
  bucket: "other",
  prefix: "copies",
  accessKeyId: "AKOTHER",
  secretAccessKey: " s3cret ",
};

describe("destinationsBody", () => {
  it("sends the folder alone, trimmed, when only the folder is on", () => {
    expect(destinationsBody(true, "  /srv/backups  ", "none", typed)).toEqual([
      { kind: "local-fs", dir: "/srv/backups" },
    ]);
  });

  it("sends the bucket copy's bucket alone when the folder is off", () => {
    expect(destinationsBody(false, "/srv/backups", "stream-bucket", typed)).toEqual([
      { kind: "stream-bucket" },
    ]);
  });

  it("sends another bucket alone, trimmed, with the secret untrimmed", () => {
    expect(destinationsBody(false, "/srv/backups", "custom-s3", typed)).toEqual([customEntry]);
  });

  it("sends the folder first, then the bucket, when both are chosen", () => {
    expect(destinationsBody(true, "/srv/backups", "stream-bucket", typed)).toEqual([
      { kind: "local-fs", dir: "/srv/backups" },
      { kind: "stream-bucket" },
    ]);
    expect(destinationsBody(true, "/srv/backups", "custom-s3", typed)).toEqual([
      { kind: "local-fs", dir: "/srv/backups" },
      customEntry,
    ]);
  });

  it("sends nothing when neither is chosen", () => {
    expect(destinationsBody(false, "/srv/backups", "none", typed)).toEqual([]);
  });

  it("leaves out an empty secret, endpoint and prefix", () => {
    expect(
      destinationsBody(false, "", "custom-s3", {
        ...typed,
        endpoint: "  ",
        prefix: " ",
        secretAccessKey: "",
      }),
    ).toEqual([
      { kind: "custom-s3", region: "us-east-1", bucket: "other", accessKeyId: "AKOTHER" },
    ]);
  });
});
