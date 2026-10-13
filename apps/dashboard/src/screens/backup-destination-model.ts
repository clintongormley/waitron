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

/** An empty, `.` or `..` folder once the ends' slashes are trimmed. */
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

export function keepsHeldSecret(custom: CustomBucket, held: HeldBucket | null): boolean {
  return (
    held !== null &&
    (held.endpoint ?? "") === custom.endpoint.trim() &&
    held.region === custom.region.trim() &&
    held.bucket === custom.bucket.trim() &&
    normalisePrefix(held.prefix) === normalisePrefix(custom.prefix.trim()) &&
    held.accessKeyId === custom.accessKeyId.trim()
  );
}

export function matchesStream(d: BackupDestinationView, stream: StreamBucket | null): boolean {
  return (
    stream !== null &&
    d.kind === "s3" &&
    d.endpoint === stream.endpoint &&
    d.region === stream.region &&
    d.bucket === stream.bucket &&
    normalisePrefix(d.prefix) === normalisePrefix(stream.prefix) &&
    d.accessKeyId === stream.accessKeyId
  );
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
