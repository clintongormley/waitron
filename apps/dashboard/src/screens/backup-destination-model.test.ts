import { describe, expect, it } from "vitest";
import type { BackupDestinationView, BackupStatusView } from "../api/client.js";
import {
  EMPTY_CUSTOM,
  destinationsBody,
  openingDestinations,
  streamLocation,
} from "./backup-destination-model.js";

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
  namespace: "venue/",
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
  namespace: "copies/",
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
    expect(openingDestinations(status([]))).toEqual({
      folderOn: true,
      folder: "",
      bucket: "none",
      custom: EMPTY_CUSTOM,
    });
  });

  it("opens a stored folder alone with the folder on and no bucket", () => {
    expect(openingDestinations(status([folder]))).toEqual({
      folderOn: true,
      folder: "/srv/backups",
      bucket: "none",
      custom: EMPTY_CUSTOM,
    });
  });

  it("opens a saved bucket as editable fields even when it matches the stream", () => {
    expect(openingDestinations(status([streamMatched]))).toEqual({
      folderOn: false,
      folder: "",
      bucket: "custom-s3",
      custom: { ...stream, secretAccessKey: "" },
    });
  });

  it("opens another stored bucket with its fields and no secret, folder off", () => {
    expect(openingDestinations(status([otherBucket]))).toEqual({
      folderOn: false,
      folder: "",
      bucket: "custom-s3",
      custom: otherCustom,
    });
  });

  it("opens a stored folder and bucket together, whichever is listed first", () => {
    const both = {
      folderOn: true,
      folder: "/srv/backups",
      bucket: "custom-s3",
      custom: otherCustom,
    };
    expect(openingDestinations(status([folder, otherBucket]))).toEqual(both);
    expect(openingDestinations(status([otherBucket, folder]))).toEqual(both);
    expect(openingDestinations(status([streamMatched, folder]))).toEqual({
      ...both,
      bucket: "custom-s3",
      custom: { ...stream, secretAccessKey: "" },
    });
  });

  it("returns a custom copy the caller can change without touching EMPTY_CUSTOM", () => {
    const opened = openingDestinations(status([]));
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

  it("sends another bucket alone, trimmed, with the secret untrimmed", () => {
    expect(destinationsBody(false, "/srv/backups", "custom-s3", typed)).toEqual([customEntry]);
  });

  it("sends the folder first, then the bucket, when both are chosen", () => {
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

describe("archive folder display", () => {
  it("shows the selected bucket and folder without a venue suffix", () => {
    expect(streamLocation({ bucket: "nightly", prefix: "/copies/" })).toBe("nightly/copies/");
    expect(streamLocation({ bucket: "nightly", prefix: "" })).toBe("nightly/");
  });
});
