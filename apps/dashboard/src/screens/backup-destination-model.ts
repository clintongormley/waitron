import type {
  ArchiveChoice,
  BackupDestinationView,
  BackupStatusView,
  StreamSettingsView,
} from "../api/client.js";

export type DestinationChoice = "local-fs" | "stream-bucket" | "custom-s3";

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

export function openingDestination(
  status: BackupStatusView,
  stream: StreamBucket | null,
): { choice: DestinationChoice; folder: string; custom: CustomBucket } {
  const first = status.destinations[0];
  if (first?.kind === "local-fs")
    return { choice: "local-fs", folder: first.dir, custom: { ...EMPTY_CUSTOM } };
  if (first === undefined) return { choice: "local-fs", folder: "", custom: { ...EMPTY_CUSTOM } };
  if (matchesStream(first, stream))
    return { choice: "stream-bucket", folder: "", custom: { ...EMPTY_CUSTOM } };
  return {
    choice: "custom-s3",
    folder: "",
    custom: {
      endpoint: first.endpoint ?? "",
      region: first.region,
      bucket: first.bucket,
      prefix: first.prefix,
      accessKeyId: first.accessKeyId,
      secretAccessKey: "",
    },
  };
}

export function destinationBody(
  choice: DestinationChoice,
  folder: string,
  custom: CustomBucket,
): ArchiveChoice {
  if (choice === "stream-bucket") return { kind: "stream-bucket" };
  if (choice === "local-fs") return { kind: "local-fs", dir: folder.trim() };
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
