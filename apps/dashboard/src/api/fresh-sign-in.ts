import type { DashboardRequest } from "@waitron/dashboard-kit";

/** Routes the server checks with `allowRecoveryCode: false`. */
const NO_RECOVERY_CODE = /^\/management-api\/(handover|box-joins\/[^/]+\/(check|approve))$/;

export type FreshSignInContext = { allowRecoveryCode: boolean; passwordOnly?: true };

export function createFreshSignInGate(options: {
  sessionGeneration: () => number;
  prompt: (signal: AbortSignal, context: FreshSignInContext) => Promise<boolean>;
}) {
  let proofVersion = 0;
  let passwordProofVersion = 0;
  let pending:
    | {
        generation: number;
        context: FreshSignInContext;
        stop: AbortController;
        answer: Promise<boolean>;
      }
    | undefined;
  const cancel = () => {
    pending?.stop.abort();
    pending = undefined;
  };
  const ask = (generation: number, context: FreshSignInContext): Promise<boolean> => {
    if (
      pending?.generation === generation &&
      (!context.passwordOnly || pending.context.passwordOnly)
    )
      return pending.answer;
    cancel();
    const stop = new AbortController();
    const cancelled = new Promise<boolean>((resolve) =>
      stop.signal.addEventListener("abort", () => resolve(false), { once: true }),
    );
    const answer = Promise.race([options.prompt(stop.signal, context), cancelled])
      .then((confirmed) => {
        if (confirmed) {
          proofVersion++;
          if (context.passwordOnly) passwordProofVersion++;
        }
        return confirmed;
      })
      .finally(() => {
        if (pending?.stop === stop) pending = undefined;
      });
    pending = { generation, context, stop, answer };
    return answer;
  };
  return {
    cancel,
    wrap(request: DashboardRequest, passive = false): DashboardRequest {
      return async <T>(
        path: string,
        method: string,
        body?: unknown,
        init?: Parameters<DashboardRequest>[3],
      ): Promise<T> => {
        const generation = options.sessionGeneration();
        const context: FreshSignInContext =
          path === "/api/box/shutdown" && method === "POST"
            ? { allowRecoveryCode: false, passwordOnly: true }
            : { allowRecoveryCode: !NO_RECOVERY_CODE.test(path) };
        const proofVersionForRequest = () =>
          context.passwordOnly ? passwordProofVersion : proofVersion;
        const proofAtStart = proofVersionForRequest();
        const original = body instanceof FormData ? new FormData() : structuredClone(body);
        if (body instanceof FormData)
          for (const [key, value] of body) (original as FormData).append(key, value);
        try {
          return await request<T>(path, method, original, init);
        } catch (error) {
          if (
            (error as { code?: string } | null)?.code !== "management_session.proof_required" ||
            (method === "GET" && (init?.passive ?? passive)) ||
            path.startsWith("/management-api/session/me/fresh-sign-in") ||
            init?.signal?.aborted ||
            generation !== options.sessionGeneration()
          )
            throw error;
          init?.signal?.addEventListener("abort", cancel, { once: true });
          try {
            if (
              (proofAtStart === proofVersionForRequest() && !(await ask(generation, context))) ||
              init?.signal?.aborted ||
              generation !== options.sessionGeneration()
            )
              throw error;
          } finally {
            init?.signal?.removeEventListener("abort", cancel);
          }
          return request<T>(path, method, original, init);
        }
      };
    },
  };
}
export type FreshSignInGate = ReturnType<typeof createFreshSignInGate>;
