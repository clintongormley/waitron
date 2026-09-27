import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** Carries the key's ENVIRONMENT, never the key or any prefix of it. */
    "payment.credential_environment_mismatch": {
      keyEnvironment: string;
      hostEnvironment: string;
    };
  }
}
