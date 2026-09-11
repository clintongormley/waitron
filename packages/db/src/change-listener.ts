import type { ResourceChange } from "@waitron/shared";
import pg from "pg";

interface Options {
  onChange(change: ResourceChange): void;
  onReset(): void;
  onError?: (error: unknown) => void;
}

/** A dedicated autocommit connection keeps LISTEN outside application transactions. */
export async function startChangeListener(
  connectionString: string,
  options: Options,
): Promise<{ close(): Promise<void> }> {
  let client: pg.Client | undefined;
  let stopped = false;
  let connecting = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let delay = 1000;

  const schedule = (): void => {
    if (stopped || connecting || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      inFlight = connect().catch((error: unknown) => {
        options.onError?.(error);
        schedule();
      });
    }, delay);
    delay = Math.min(delay * 2, 10_000);
  };

  const connect = async (): Promise<void> => {
    connecting = true;
    const previous = client;
    const next = new pg.Client({
      connectionString,
      application_name: "waitron-live-updates",
      connectionTimeoutMillis: 5000,
    });
    client = next;
    await previous?.end().catch(() => {});
    next.on("error", (error: unknown) => {
      if (client !== next || stopped) return;
      options.onError?.(error);
      schedule();
    });
    next.on("end", () => {
      if (client === next) schedule();
    });
    next.on("notification", (notification) => {
      if (stopped || client !== next || notification.channel !== "waitron_changes") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(notification.payload ?? "");
      } catch {
        return;
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        !("tenantId" in parsed) ||
        !("resources" in parsed)
      )
        return;
      if (parsed.tenantId !== null && typeof parsed.tenantId !== "string") return;
      if (!Array.isArray(parsed.resources)) return;
      const resources: ResourceChange["resources"] = [];
      for (const identity of parsed.resources as unknown[]) {
        if (
          identity === null ||
          typeof identity !== "object" ||
          !("type" in identity) ||
          typeof identity.type !== "string"
        )
          return;
        if ("id" in identity && typeof identity.id !== "string") return;
        resources.push(
          "id" in identity
            ? { type: identity.type, id: identity.id as string }
            : { type: identity.type },
        );
      }
      options.onChange({ tenantId: parsed.tenantId, resources });
    });
    try {
      await next.connect();
      if (stopped) return;
      await next.query("listen waitron_changes");
      if (stopped) return;
      delay = 1000;
      options.onReset();
    } catch (error) {
      if (client === next) client = undefined;
      await next.end().catch(() => {});
      throw error;
    } finally {
      connecting = false;
    }
  };

  await connect();
  return {
    close: async () => {
      stopped = true;
      clearTimeout(retry);
      const held = client;
      client = undefined;
      await held?.end().catch(() => {});
      await inFlight;
    },
  };
}
