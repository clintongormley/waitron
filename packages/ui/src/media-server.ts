let server = "";
const listeners = new Set<() => void>();

/** The server media is read from; `""`, the default, is the page's own server. */
export function setMediaServer(base: string): void {
  if (base === server) return;
  server = base;
  for (const listener of listeners) listener();
}

export function mediaAddress(path: string): string {
  return path.startsWith("/media/") ? `${server}${path}` : path;
}

export function onMediaServerChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
