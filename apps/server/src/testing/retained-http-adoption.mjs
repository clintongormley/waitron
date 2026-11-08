import { Server } from "node:net";

export function adoptRetainedListeners(entries) {
  for (const entry of entries) {
    const address = entry.server.address();
    if (
      address === null ||
      typeof address === "string" ||
      address.port !== entry.port ||
      address.address !== entry.host
    ) {
      throw new Error("retained listener address mismatch");
    }
  }
  const pending = new Map(entries.map((entry) => [entry.port, entry]));
  const original = Server.prototype.listen;
  const boundServers = [];
  let ready;
  const bound = new Promise((resolve) => {
    ready = resolve;
  });
  const restore = () => {
    if (Server.prototype.listen === intercept) Server.prototype.listen = original;
  };
  function intercept(...args) {
    const entry = pending.get(args[0]);
    if (entry === undefined) return Reflect.apply(original, this, args);
    if (args[1] !== entry.host) throw new Error("retained listener host mismatch");
    pending.delete(entry.port);
    if (pending.size === 0) restore();
    this.once("listening", () => {
      boundServers.push(this);
      if (boundServers.length === entries.length) ready(boundServers);
    });
    const callback = args.at(-1);
    const result = Reflect.apply(
      original,
      this,
      typeof callback === "function" ? [entry.server, callback] : [entry.server],
    );
    this.ref();
    return result;
  }
  Server.prototype.listen = intercept;
  return { bound, restore };
}
