import type {
  ArchiveChoice,
  BackupDestinationView,
  BackupStatusView,
  StreamSettingsView,
} from "../api/client.js";

export type DestinationChoice = "local-fs" | "stream-bucket";

type StreamBucket = NonNullable<StreamSettingsView["bucket"]>;

/** Mirrors `normalisePrefix` in `packages/stream/src/names.ts`. */
export function normalisePrefix(prefix: string): string {
  let start = 0;
  let end = prefix.length;
  while (start < end && prefix[start] === "/") start++;
  while (end > start && prefix[end - 1] === "/") end--;
  const trimmed = prefix.slice(start, end);
  return trimmed === "" ? "" : `${trimmed}/`;
}

/** Where the server's `archiveNamespace` puts archives for the stream's bucket. */
export function streamLocation(stream: StreamBucket, venueId: string): string {
  return `${stream.bucket}/${normalisePrefix(stream.prefix)}archives/${venueId}/`;
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

/** A stored bucket the form cannot name yet opens as an empty local folder. */
export function openingDestination(
  status: BackupStatusView,
  stream: StreamBucket | null,
): { choice: DestinationChoice; folder: string } {
  const first = status.destinations[0];
  if (first?.kind === "local-fs") return { choice: "local-fs", folder: first.dir };
  if (first !== undefined && matchesStream(first, stream))
    return { choice: "stream-bucket", folder: "" };
  return { choice: "local-fs", folder: "" };
}

export function destinationBody(choice: DestinationChoice, folder: string): ArchiveChoice {
  return choice === "stream-bucket"
    ? { kind: "stream-bucket" }
    : { kind: "local-fs", dir: folder.trim() };
}
