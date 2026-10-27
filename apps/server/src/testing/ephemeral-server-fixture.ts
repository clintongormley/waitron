import { once } from "node:events";
import { listener } from "./ephemeral-listener.js";
import { serverFixture } from "./server-fixture.js";

/** Requires the test's Hono mock to delegate to `ephemeralHttpMock`. */
export function ephemeralServerFixture() {
  const fixture = serverFixture();
  const currentListener = () => listener.current;
  const httpPort = () => {
    if (listener.port === undefined) throw new Error("the boot listener has not bound");
    return listener.port;
  };
  const startServer = async (...args: Parameters<typeof fixture.startServer>) => {
    listener.current = undefined;
    listener.port = undefined;
    const server = await fixture.startServer(...args);
    try {
      const bound = currentListener();
      if (!bound) throw new Error("boot returned without an HTTP listener");
      if (!bound.listening) await once(bound, "listening");
      return server;
    } catch (error) {
      await server.close();
      throw error;
    }
  };
  const startConfiguredServer = async (...args: Parameters<typeof fixture.startServer>) => {
    listener.configured = true;
    try {
      return await fixture.startServer(...args);
    } finally {
      listener.configured = false;
    }
  };
  return { ...fixture, startServer, startConfiguredServer, httpPort };
}
