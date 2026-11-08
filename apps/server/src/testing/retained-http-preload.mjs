import process from "node:process";
import { Server } from "node:net";
import { adoptRetainedListeners } from "./retained-http-adoption.mjs";

if (!process.connected || process.send === undefined)
  throw new Error("dedicated test IPC required");

const entries = await new Promise((resolve, reject) => {
  const held = [];
  const disconnected = () => reject(new Error("test IPC ended before listener transfer"));
  const receive = (message, server) => {
    if (message?.kind !== "retained-listeners.handle") return;
    if (!(server instanceof Server)) {
      reject(new Error("a retained TCP server handle is required"));
      return;
    }
    server.on("connection", (socket) => socket.destroy());
    server.unref();
    held.push({ server, host: message.host, port: message.port });
    if (held.length === message.count) {
      process.off("message", receive);
      process.off("disconnect", disconnected);
      resolve(held);
    }
  };
  process.on("message", receive);
  process.once("disconnect", disconnected);
  process.send({ kind: "retained-listeners.request" }, (error) => {
    if (error) reject(error);
  });
});

adoptRetainedListeners(entries);
await new Promise((resolve, reject) => {
  process.send({ kind: "retained-listeners.received", count: entries.length }, (error) => {
    if (error) reject(error);
    else resolve();
  });
});
process.disconnect();
