import type { MdnsAnswer, MdnsPeer, MdnsQuestion, MdnsSocket } from "../mdns.js";

/** A responder socket a boot test hands queries to and reads the answered names from. */
export function fakeMdnsSocket() {
  let onQuery: ((query: { questions: MdnsQuestion[] }, from: MdnsPeer) => void) | undefined;
  const responses: { answers: MdnsAnswer[] }[] = [];
  const socket: MdnsSocket = {
    on: ((event: string, handler: never) => {
      if (event === "query") onQuery = handler;
    }) as MdnsSocket["on"],
    respond: (response, sent) => {
      responses.push(response);
      if (typeof sent === "function") sent();
    },
    destroy: (cb) => cb?.(),
  };
  return {
    socket,
    /** Throws when no responder took this socket, so an empty answer cannot mean an unwired one. */
    query: (name: string) => {
      if (onQuery === undefined) throw new Error("no mDNS responder is listening on this socket");
      onQuery({ questions: [{ name, type: "A" }] }, { address: "192.168.10.60", port: 5353 });
    },
    answered: () => [...new Set(responses.flatMap((r) => r.answers.map((a) => a.name)))],
    answers: () => responses.flatMap((r) => r.answers),
    clear: () => responses.splice(0),
  };
}
