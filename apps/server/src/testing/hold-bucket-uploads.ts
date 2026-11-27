import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

/** Hold matching bucket writes at the HTTP boundary until the scenario releases them. */
export async function holdBucketUploads(upstreamEndpoint: () => string) {
  let shouldHold: ((url: string) => boolean) | undefined;
  let sawUpload = false;
  const pending = new Set<() => void>();
  const proxy = createServer((incoming, outgoing) => {
    const url = incoming.url!;
    const forward = () => {
      const upstream = request(
        new URL(url, upstreamEndpoint()),
        {
          headers: incoming.headers,
          method: incoming.method,
          agent: false,
        },
        (response) => {
          outgoing.writeHead(response.statusCode!, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("error", (error) => outgoing.destroy(error));
      outgoing.on("close", () => upstream.destroy());
      incoming.pipe(upstream);
    };
    if (incoming.method === "PUT" && shouldHold?.(url)) {
      sawUpload = true;
      pending.add(forward);
      outgoing.once("close", () => pending.delete(forward));
    } else forward();
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  return {
    endpoint,
    hold(predicate: (url: string) => boolean) {
      sawUpload = false;
      shouldHold = predicate;
    },
    sawUpload: () => sawUpload,
    release() {
      shouldHold = undefined;
      for (const forward of pending) forward();
      pending.clear();
    },
    async close() {
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    },
  };
}
