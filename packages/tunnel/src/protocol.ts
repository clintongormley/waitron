// Newline-delimited JSON frames, used ONLY for the pre-splice handshake; after `go` the connection
// carries raw TLS bytes and is never reframed.
export type Frame =
  | { t: "register"; boxId: string; token: string }
  | { t: "ack" }
  | { t: "reject"; code: string }
  | { t: "ping" }
  | { t: "pong" }
  | { t: "go" };

export function encodeFrame(frame: Frame): Buffer {
  return Buffer.from(`${JSON.stringify(frame)}\n`);
}

/**
 * Parses at most one line, so the raw TLS bytes after a `go` frame come back untouched in `rest`.
 */
export function decodeFrame(buffer: Buffer): { frame: Frame; rest: Buffer } | null {
  const nl = buffer.indexOf(0x0a);
  if (nl === -1) return null;
  const line = buffer.subarray(0, nl).toString();
  const rest = buffer.subarray(nl + 1);
  return { frame: JSON.parse(line) as Frame, rest };
}
