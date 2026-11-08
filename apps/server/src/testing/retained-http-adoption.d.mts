import type { Server } from "node:net";

export function adoptRetainedListeners(
  entries: readonly { server: Server; host: string; port: number }[],
): { bound: Promise<Server[]>; restore(): void };
