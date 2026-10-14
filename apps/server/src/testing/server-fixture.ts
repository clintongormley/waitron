import { startServer as bootServer, type StartedServer } from "../boot.js";

/** Guards this fixture's own writes; server requests use the server's database and write queue. */
export function serverFixture() {
  let running = 0;
  const beforeServerStarts = () => {
    if (running > 0) throw new Error("write to the venue database before the server starts");
  };
  const startServer = async (...args: Parameters<typeof bootServer>): Promise<StartedServer> => {
    running += 1;
    try {
      const server = await bootServer(...args);
      let closing: Promise<void> | undefined;
      return {
        ...server,
        close: () =>
          (closing ??= (async () => {
            try {
              await server.close();
            } finally {
              running -= 1;
            }
          })()),
      };
    } catch (error) {
      running -= 1;
      throw error;
    }
  };
  return { beforeServerStarts, startServer };
}
