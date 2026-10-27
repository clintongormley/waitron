import type { serve } from "@hono/node-server";
import { vi } from "vitest";

export const listener = {
  configured: false,
  current: undefined as ReturnType<typeof serve> | undefined,
  port: undefined as number | undefined,
};

export async function ephemeralHttpMock() {
  const actual = await vi.importActual<typeof import("@hono/node-server")>("@hono/node-server");
  return {
    ...actual,
    serve: (options: Parameters<typeof serve>[0], onListen: Parameters<typeof serve>[1]) => {
      listener.current = actual.serve(
        { ...options, port: listener.configured ? options.port : 0 },
        (info) => {
          listener.port = info.port;
          onListen?.(info);
        },
      );
      return listener.current;
    },
  };
}
