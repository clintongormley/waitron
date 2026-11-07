import type {
  ArchiveChoice,
  BackupDestinationView,
  BackupStatusView,
  StreamSettingsView,
} from "../api/client.js";

export type BucketChoice = "none" | "stream-bucket" | "custom-s3";

type StreamBucket = NonNullable<StreamSettingsView["bucket"]>;
type HeldBucket = Extract<BackupDestinationView, { kind: "s3" }>;

/** The fields of another bucket, as typed; `secretAccessKey` is write-only and never prefilled. */
export interface CustomBucket {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const EMPTY_CUSTOM: CustomBucket = {
  endpoint: "",
  region: "",
  bucket: "",
  prefix: "",
  accessKeyId: "",
  secretAccessKey: "",
};

/** Mirrors `normalisePrefix` in `packages/stream/src/names.ts`. */
export function normalisePrefix(prefix: string): string {
  let start = 0;
  let end = prefix.length;
  while (start < end && prefix[start] === "/") start++;
  while (end > start && prefix[end - 1] === "/") end--;
  const trimmed = prefix.slice(start, end);
  return trimmed === "" ? "" : `${trimmed}/`;
}

export function hasUnusableFolder(prefix: string): boolean {
  const root = normalisePrefix(prefix);
  return (
    root !== "" &&
    root
      .slice(0, -1)
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

/** Where the server's `archiveNamespace` puts archives in a bucket. */
export function streamLocation(place: { bucket: string; prefix: string }, venueId: string): string {
  return `${place.bucket}/${normalisePrefix(place.prefix)}archives/${venueId}/`;
}

export function heldBucket(status: BackupStatusView | undefined): HeldBucket | null {
  return status?.destinations.find((d): d is HeldBucket => d.kind === "s3") ?? null;
}

interface Place {
  endpoint: string | null;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
}

function samePlace(a: Place, b: Place): boolean {
  return (
    a.endpoint === b.endpoint &&
    a.region === b.region &&
    a.bucket === b.bucket &&
    normalisePrefix(a.prefix) === normalisePrefix(b.prefix) &&
    a.accessKeyId === b.accessKeyId
  );
}

export function keepsHeldSecret(custom: CustomBucket, held: HeldBucket | null): boolean {
  return (
    held !== null &&
    samePlace(
      { ...held, endpoint: held.endpoint ?? "" },
      {
        endpoint: custom.endpoint.trim(),
        region: custom.region.trim(),
        bucket: custom.bucket.trim(),
        prefix: custom.prefix.trim(),
        accessKeyId: custom.accessKeyId.trim(),
      },
    )
  );
}

export function matchesStream(d: BackupDestinationView, stream: StreamBucket | null): boolean {
  return stream !== null && d.kind === "s3" && samePlace(d, stream);
}

export function sameStreamBucket(a: StreamBucket | null, b: StreamBucket | null): boolean {
  if (a === null || b === null) return a === b;
  return samePlace(a, b);
}

export function openingDestinations(
  status: BackupStatusView,
  stream: StreamBucket | null,
): { folderOn: boolean; folder: string; bucket: BucketChoice; custom: CustomBucket } {
  const stored = status.destinations.find((d) => d.kind === "local-fs");
  const held = heldBucket(status);
  const folderOn = stored !== undefined || held === null;
  const folder = stored?.dir ?? "";
  if (held === null) return { folderOn, folder, bucket: "none", custom: { ...EMPTY_CUSTOM } };
  if (matchesStream(held, stream))
    return { folderOn, folder, bucket: "stream-bucket", custom: { ...EMPTY_CUSTOM } };
  return {
    folderOn,
    folder,
    bucket: "custom-s3",
    custom: {
      endpoint: held.endpoint ?? "",
      region: held.region,
      bucket: held.bucket,
      prefix: held.prefix,
      accessKeyId: held.accessKeyId,
      secretAccessKey: "",
    },
  };
}

/** The folder, when on, is listed before the bucket. */
export function destinationsBody(
  folderOn: boolean,
  folder: string,
  bucket: BucketChoice,
  custom: CustomBucket,
): ArchiveChoice[] {
  const list: ArchiveChoice[] = folderOn ? [{ kind: "local-fs", dir: folder.trim() }] : [];
  if (bucket === "stream-bucket") list.push({ kind: "stream-bucket" });
  if (bucket === "custom-s3") list.push(customBody(custom));
  return list;
}

function customBody(custom: CustomBucket): ArchiveChoice {
  const endpoint = custom.endpoint.trim();
  const prefix = custom.prefix.trim();
  return {
    kind: "custom-s3",
    ...(endpoint === "" ? {} : { endpoint }),
    region: custom.region.trim(),
    bucket: custom.bucket.trim(),
    ...(prefix === "" ? {} : { prefix }),
    accessKeyId: custom.accessKeyId.trim(),
    ...(custom.secretAccessKey === "" ? {} : { secretAccessKey: custom.secretAccessKey }),
  };
}
