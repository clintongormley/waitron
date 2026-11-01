import type { ServerResponse } from "node:http";

export function restartAfterResponse(outgoing: ServerResponse, requestRestart: () => void): void {
  let requested = false;
  const restart = () => {
    if (requested) return;
    requested = true;
    outgoing.off("finish", restart);
    outgoing.off("close", restart);
    requestRestart();
  };
  outgoing.once("finish", restart);
  outgoing.once("close", restart);
  // A disconnect can occur while the committed transaction is still resolving.
  if (outgoing.writableFinished || outgoing.destroyed) restart();
}
