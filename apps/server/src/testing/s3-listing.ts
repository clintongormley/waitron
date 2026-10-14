import {
  ListMultipartUploadsCommand,
  type ListMultipartUploadsCommandOutput,
} from "@aws-sdk/client-s3";

export interface Outcome<T> {
  output?: T;
  error?: unknown;
}

const MAX_LIST_PAGES = 10_000;

/**
 * Yields each page's answer until one fails or is the last. A truncated page whose next position is
 * missing or already seen is followed by `repeated()` as a failure; at most MAX_LIST_PAGES are read.
 * Once `signal` aborts, its reason is yielded as a failure in place of the next page.
 */
export async function* listPages<T extends { IsTruncated?: boolean | undefined }, P>(
  list: (position: P | undefined) => Promise<Outcome<T>>,
  nextPosition: (output: T) => { position: P; seen: string } | undefined,
  repeated: () => Error,
  signal?: AbortSignal,
): AsyncGenerator<Outcome<T>> {
  const seen = new Set<string>();
  let position: P | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    if (signal?.aborted === true) {
      yield { error: signal.reason };
      return;
    }
    const listed = await list(position);
    yield listed;
    if (listed.error !== undefined || listed.output?.IsTruncated !== true) return;
    const next = nextPosition(listed.output);
    if (next === undefined || seen.has(next.seen)) {
      yield { error: repeated() };
      return;
    }
    seen.add(next.seen);
    position = next.position;
  }
}

export interface ListedUpload {
  key: string;
  uploadId: string;
}

const UPLOADS_REPEATED = "ListMultipartUploads repeated its marker";

/**
 * The unfinished multipart uploads in `bucket`, under `prefix` when one is given, one page at a time.
 * A page that carries an `error` has no uploads and is the last.
 */
export async function* listUploads(
  list: (
    command: ListMultipartUploadsCommand,
  ) => Promise<Outcome<Partial<ListMultipartUploadsCommandOutput>>>,
  opts: {
    bucket: string;
    prefix?: string;
    failure: (message: string) => Error;
    signal?: AbortSignal;
  },
): AsyncGenerator<{ uploads: ListedUpload[]; error?: unknown }> {
  for await (const listed of listPages<
    Partial<ListMultipartUploadsCommandOutput>,
    { keyMarker: string | undefined; uploadIdMarker: string | undefined }
  >(
    (markers) =>
      list(
        new ListMultipartUploadsCommand({
          Bucket: opts.bucket,
          ...(opts.prefix === undefined ? {} : { Prefix: opts.prefix }),
          ...(markers?.keyMarker === undefined ? {} : { KeyMarker: markers.keyMarker }),
          ...(markers?.uploadIdMarker === undefined
            ? {}
            : { UploadIdMarker: markers.uploadIdMarker }),
        }),
      ),
    ({ NextKeyMarker: keyMarker, NextUploadIdMarker: uploadIdMarker }) => ({
      position: { keyMarker, uploadIdMarker },
      seen: `${keyMarker ?? ""}\u0000${uploadIdMarker ?? ""}`,
    }),
    () => opts.failure(UPLOADS_REPEATED),
    opts.signal,
  )) {
    if (listed.error !== undefined) {
      yield { uploads: [], error: listed.error };
      return;
    }
    const uploads: ListedUpload[] = [];
    for (const { Key, UploadId } of listed.output?.Uploads ?? []) {
      if (Key !== undefined && UploadId !== undefined)
        uploads.push({ key: Key, uploadId: UploadId });
    }
    yield { uploads };
  }
}
