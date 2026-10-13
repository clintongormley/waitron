import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { BucketConfig } from "../s3-client.js";

export type RequestKind =
  "put" | "create" | "part" | "complete" | "abort" | "get" | "list" | "deleteMany" | "delete";

export interface SeenRequest {
  kind: RequestKind;
  /** The object key as the bucket holds it; for a listing, the prefix asked for. */
  key: string;
  uploadId: string | null;
  partNumber: number | null;
  continuationToken: string | null;
  headers: IncomingMessage["headers"];
  /** Set once the whole request body has arrived. */
  body: Buffer | null;
  /** Whether the client's connection closed before an answer was finished. */
  closedEarly: boolean;
}

export interface LoopbackBucketOptions {
  prefix?: string;
  /** Keys per listing page. */
  pageSize?: number;
  /** Called as each request starts, before its body is read. */
  onRequest?: (seen: SeenRequest) => void;
  /** Called with each chunk of a request body as it arrives. */
  onBodyBytes?: (seen: SeenRequest, bytes: number) => void;
  /**
   * Called once the request body has arrived. Return true when it answered the request itself;
   * otherwise the bucket answers as S3 would.
   */
  answer?: (seen: SeenRequest, request: IncomingMessage, response: ServerResponse) => boolean;
}

export interface LoopbackBucket {
  config: BucketConfig;
  /** Every object, by the key the bucket holds it under. */
  objects: Map<string, { body: Buffer; lastModified: Date }>;
  seen: SeenRequest[];
  record: {
    createdIds: string[];
    /** The size of every part the bucket accepted, in the order it accepted them. */
    partBytes: number[];
    completedIds: string[];
    abortedIds: string[];
  };
  /** The S3-shaped answer the bucket gives `seen` (for a test's own `answer` to fall back to). */
  answerAsS3(seen: SeenRequest, response: ServerResponse): void;
  close(): Promise<void>;
}

const xml = { "content-type": "application/xml" };

export function errorXml(code: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>no</Message></Error>`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function unescapeXml(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function classify(method: string, url: URL): RequestKind {
  const query = url.searchParams;
  if (method === "POST" && query.has("uploads")) return "create";
  if (method === "POST" && query.has("uploadId")) return "complete";
  if (method === "POST" && query.has("delete")) return "deleteMany";
  if (method === "PUT" && query.has("uploadId")) return "part";
  if (method === "PUT") return "put";
  if (method === "DELETE" && query.has("uploadId")) return "abort";
  if (method === "DELETE") return "delete";
  if (query.get("list-type") === "2") return "list";
  return "get";
}

/**
 * An S3-compatible bucket on 127.0.0.1, addressed by path, that keeps its objects in memory and
 * records every request, so a test drives the real client over a real connection.
 */
export async function loopbackBucket(options: LoopbackBucketOptions = {}): Promise<LoopbackBucket> {
  const objects: LoopbackBucket["objects"] = new Map();
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  const seenRequests: SeenRequest[] = [];
  const record: LoopbackBucket["record"] = {
    createdIds: [],
    partBytes: [],
    completedIds: [],
    abortedIds: [],
  };
  const pageSize = options.pageSize ?? 1000;
  const bucketPath = "/owner-bucket";

  function answerAsS3(seen: SeenRequest, response: ServerResponse): void {
    const body = seen.body!;
    const missing = (code: string) => {
      response.writeHead(404, xml);
      response.end(errorXml(code));
    };
    switch (seen.kind) {
      case "put":
        objects.set(seen.key, { body, lastModified: new Date() });
        response.writeHead(200, { etag: '"put"' });
        response.end();
        return;
      case "create": {
        const id = `upload-${record.createdIds.length + 1}`;
        record.createdIds.push(id);
        uploads.set(id, { key: seen.key, parts: new Map() });
        response.writeHead(200, xml);
        response.end(
          `<InitiateMultipartUploadResult><Bucket>owner-bucket</Bucket><Key>${escapeXml(seen.key)}</Key>` +
            `<UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
        );
        return;
      }
      case "part": {
        const upload = uploads.get(seen.uploadId!)!;
        upload.parts.set(seen.partNumber!, body);
        record.partBytes.push(body.length);
        response.writeHead(200, { etag: `"part-${seen.partNumber}"` });
        response.end();
        return;
      }
      case "complete": {
        const upload = uploads.get(seen.uploadId!);
        if (upload === undefined) return missing("NoSuchUpload");
        const numbers = [...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map(
          (match) => Number(match[1]),
        );
        objects.set(upload.key, {
          body: Buffer.concat(numbers.map((n) => upload.parts.get(n)!)),
          lastModified: new Date(),
        });
        uploads.delete(seen.uploadId!);
        record.completedIds.push(seen.uploadId!);
        response.writeHead(200, xml);
        response.end(
          `<CompleteMultipartUploadResult><Bucket>owner-bucket</Bucket><Key>${escapeXml(upload.key)}</Key>` +
            `<ETag>"complete"</ETag></CompleteMultipartUploadResult>`,
        );
        return;
      }
      case "abort":
        if (!uploads.delete(seen.uploadId!)) return missing("NoSuchUpload");
        record.abortedIds.push(seen.uploadId!);
        response.writeHead(204);
        response.end();
        return;
      case "get": {
        const object = objects.get(seen.key);
        if (object === undefined) return missing("NoSuchKey");
        response.writeHead(200, { etag: '"got"', "content-length": String(object.body.length) });
        response.end(object.body);
        return;
      }
      case "list": {
        const keys = [...objects.keys()].filter((key) => key.startsWith(seen.key)).sort();
        const start = Number(seen.continuationToken ?? 0);
        const page = keys.slice(start, start + pageSize);
        const truncated = start + pageSize < keys.length;
        response.writeHead(200, xml);
        response.end(
          "<ListBucketResult>" +
            page
              .map(
                (key) =>
                  `<Contents><Key>${escapeXml(key)}</Key>` +
                  `<LastModified>${objects.get(key)!.lastModified.toISOString()}</LastModified>` +
                  `<Size>${objects.get(key)!.body.length}</Size></Contents>`,
              )
              .join("") +
            `<IsTruncated>${truncated}</IsTruncated>` +
            (truncated
              ? `<NextContinuationToken>${start + pageSize}</NextContinuationToken>`
              : "") +
            "</ListBucketResult>",
        );
        return;
      }
      case "deleteMany":
        for (const match of body.toString().matchAll(/<Key>([^<]*)<\/Key>/g))
          objects.delete(unescapeXml(match[1]!));
        response.writeHead(200, xml);
        response.end("<DeleteResult></DeleteResult>");
        return;
      case "delete":
        objects.delete(seen.key);
        response.writeHead(204);
        response.end();
        return;
    }
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://bucket");
    const kind = classify(request.method!, url);
    const path = decodeURIComponent(url.pathname);
    const seen: SeenRequest = {
      kind,
      key:
        kind === "list"
          ? (url.searchParams.get("prefix") ?? "")
          : path.slice(bucketPath.length + 1),
      uploadId: url.searchParams.get("uploadId"),
      partNumber: url.searchParams.has("partNumber")
        ? Number(url.searchParams.get("partNumber"))
        : null,
      continuationToken: url.searchParams.get("continuation-token"),
      headers: request.headers,
      body: null,
      closedEarly: false,
    };
    seenRequests.push(seen);
    response.on("close", () => {
      if (!response.writableFinished) seen.closedEarly = true;
    });
    options.onRequest?.(seen);
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      options.onBodyBytes?.(seen, chunk.length);
    });
    request.on("end", () => {
      seen.body = Buffer.concat(chunks);
      if (options.answer?.(seen, request, response)) return;
      answerAsS3(seen, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    config: {
      endpoint: `http://127.0.0.1:${port}`,
      region: "us-east-1",
      bucket: "owner-bucket",
      prefix: options.prefix ?? "",
      accessKeyId: "AKIAEXAMPLE0000",
      secretAccessKey: "not-a-real-secret",
    },
    objects,
    seen: seenRequests,
    record,
    answerAsS3,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
