import Busboy from "@fastify/busboy";
import { AppError, isAppError } from "@waitron/shared";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { errnoOf } from "./errno.js";
import { freeBytes } from "./free-bytes.js";
import { START_FREE_SPACE_FLOOR } from "./start-space.js";
import "./errors.js";
export const MAX_ARCHIVE_UPLOAD_BYTES = 4 * 1024 ** 3;
export interface ArchiveUpload {
  artifactPath: string;
  byteLength: number;
  fields: Map<string, string>;
  dispose(): Promise<void>;
}
export interface ArchiveUploadOptions {
  fields?: readonly string[];
  exactFields?: boolean;
  maxBytes?: number;
  oversizeIsInvalid?: boolean;
  reserveBytes?: number;
}
function invalid(field = "artifact"): AppError {
  return new AppError("setup.request_invalid", { field });
}
function capacity(): AppError {
  return new AppError("restore.archive_resource_limit", {});
}
export type ReceiveArchive = (
  request: Request,
  options?: ArchiveUploadOptions,
) => Promise<ArchiveUpload>;
export async function receiveSetupArchive(
  request: Request,
  stagingDir: string,
  options: ArchiveUploadOptions = {},
): Promise<ArchiveUpload> {
  const max = options.maxBytes ?? MAX_ARCHIVE_UPLOAD_BYTES;
  const multipart = request.headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith("multipart/form-data");
  const declared = Number(request.headers.get("content-length"));
  const limit = max + (multipart ? 262144 : 0);
  const oversize = () => (options.oversizeIsInvalid ? invalid() : capacity());
  if (declared > limit) {
    await request.body?.cancel();
    throw oversize();
  }
  if (!request.body) throw invalid();
  let dir: string | undefined;
  let fileTask: Promise<void> | undefined;
  let fileError: unknown;
  const fields = new Map<string, string>();
  let byteLength = 0;
  try {
    await mkdir(stagingDir, { recursive: true, mode: 0o700 });
    dir = await mkdtemp(join(stagingDir, "upload-"));
    const artifactPath = join(dir, "artifact");
    const dispose = () => rm(dir!, { recursive: true, force: true });
    const input = Readable.fromWeb(
      request.body as import("node:stream/web").ReadableStream<Uint8Array>,
    );
    let total = 0;
    const bound = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        total += chunk.length;
        if (total > limit) return done(oversize());
        freeBytes(dir!).then((free) => {
          if (
            free === null ||
            free - chunk.length < (options.reserveBytes ?? START_FREE_SPACE_FLOOR)
          )
            done(capacity());
          else done(null, chunk);
        }, done);
      },
    });
    const count = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        byteLength += chunk.length;
        done(byteLength > max ? oversize() : null, chunk);
      },
    });
    if (!multipart) {
      await pipeline(
        input,
        bound,
        count,
        createWriteStream(artifactPath, { flags: "wx", mode: 0o600 }),
        { signal: request.signal },
      );
    } else {
      const parser = new Busboy({
        headers: { "content-type": request.headers.get("content-type")! },
        limits: { fieldSize: 131072, fields: 64, headerSize: 16384 },
      });
      const refuse = (error: Error) => {
        parser.destroy(error);
      };
      const fieldRefusal = (name: string) => invalid(options.exactFields ? "body" : name);
      parser.on("file", (name, stream) => {
        if (name !== "artifact") {
          stream.resume();
          if (options.exactFields || options.fields?.includes(name)) refuse(fieldRefusal(name));
          return;
        }
        if (fileTask) {
          stream.resume();
          refuse(fieldRefusal(name));
          return;
        }
        fileTask = pipeline(
          stream,
          count,
          createWriteStream(artifactPath, { flags: "wx", mode: 0o600 }),
          { signal: request.signal },
        );
        void fileTask.catch((error) => {
          fileError = error;
          refuse(error as Error);
        });
      });
      parser.on("field", (name, value, nameCut, valueCut) => {
        if (name === "artifact") return refuse(fileTask ? fieldRefusal(name) : invalid(name));
        if (nameCut || valueCut || fields.has(name)) return refuse(fieldRefusal(name));
        if (!options.fields?.includes(name)) {
          if (options.exactFields) refuse(invalid("body"));
          return;
        }
        fields.set(name, value);
      });
      parser.on("fieldsLimit", () => refuse(invalid("body")));
      await pipeline(input, bound, parser, { signal: request.signal });
      await fileTask;
      if (total - byteLength > 262144) throw capacity();
    }
    if (byteLength === 0) throw invalid();
    request.signal.throwIfAborted();
    return { artifactPath, byteLength, fields, dispose };
  } catch (caught) {
    await fileTask?.catch(() => {});
    await request.body?.cancel().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true });
    const error = isAppError(caught) ? caught : (fileError ?? caught);
    if (["ENOSPC", "EDQUOT"].includes(errnoOf(error) ?? "")) throw capacity();
    if (isAppError(error) || request.signal.aborted) throw error;
    throw invalid(options.exactFields ? "body" : "artifact");
  }
}
