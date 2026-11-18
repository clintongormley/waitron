import type { Server } from "node:net";

export function adoptRetainedListeners(
  entries: readonly { server: Server; host: string; port: number }[],
): { adopted: ReadonlyMap<number, Server>; bound: Promise<Server[]>; restore(): void };
