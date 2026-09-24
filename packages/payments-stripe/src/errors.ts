import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    /** Declared but not raised: a reader timeout resolves the payment to `failed` instead. */
    "stripe.collect_timeout": { paymentRef: string; readerId: string };
    /** Carries the key's ENVIRONMENT, never the key or any prefix of it. */
    "payment.credential_environment_mismatch": {
      keyEnvironment: string;
      hostEnvironment: string;
    };
  }
}
