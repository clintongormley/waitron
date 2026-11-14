import { bodyLimit } from "hono/body-limit";

export function peerBodyLimit(
  maxSize: number,
  code: "handover.request_invalid" | "management.request_invalid" = "handover.request_invalid",
) {
  return bodyLimit({
    maxSize,
    onError: (c) => c.json({ error: { code, params: { field: "body" } } }, 413),
  });
}
