import { makeT, registerCatalogue } from "@waitron/dashboard-kit";

// The Stripe panel's OWN i18n surface: the connect-form and add-reader UI strings, English the source
// of truth. Browser UI (out of the english-only guard's scope), so the Spanish is user-facing
// translation, not schema vocabulary. Registered at load so importing this panel's `t` resolves them.
//
// NOTE: the ERROR-CODE copy (`payment.provider_credential_rejected`,
// `payment.credential_environment_mismatch`, `reader.not_found`, …) lives centrally in
// `apps/dashboard/src/i18n/codes.ts` — that is Task 15's job. This panel falls back to the shared
// `codeMessage` for a rejected connect and renders its own screen strings otherwise.

const en = {
  "payments.stripe.name": "Stripe",
  "payments.stripe.connect_heading": "Connect Stripe",
  "payments.stripe.secret_key": "Secret key",
  "payments.stripe.webhook_secret": "Webhook signing secret",
  "payments.stripe.success_url": "Success URL",
  "payments.stripe.cancel_url": "Cancel URL",
  "payments.stripe.connect": "Connect",
  "payments.stripe.connected_as": "Connected as {name}",
  "payments.stripe.form_problem": "There is a problem with this form",
  "payments.stripe.secret_key_required": "Enter your Stripe secret key",
  "payments.stripe.connect_failed": "That secret key was not accepted. Check it and try again.",
  "payments.stripe.add_reader_heading": "Add a Stripe reader",
  "payments.stripe.reader_name": "Reader name",
  "payments.stripe.reader_id": "Reader ID",
  "payments.stripe.reader_id_help":
    "The Terminal reader's ID from your Stripe dashboard — it starts with tmr_.",
  "payments.stripe.reader_name_required": "Give the reader a name",
  "payments.stripe.reader_id_required": "Enter the reader's Stripe ID",
  "payments.stripe.add": "Add",
  "payments.stripe.add_failed": "That reader ID was not accepted. Check it and try again.",
  "payments.stripe.cancel": "Cancel",
} as const;

const es: Record<keyof typeof en, string> = {
  "payments.stripe.name": "Stripe",
  "payments.stripe.connect_heading": "Conectar Stripe",
  "payments.stripe.secret_key": "Clave secreta",
  "payments.stripe.webhook_secret": "Secreto de firma de webhook",
  "payments.stripe.success_url": "URL de éxito",
  "payments.stripe.cancel_url": "URL de cancelación",
  "payments.stripe.connect": "Conectar",
  "payments.stripe.connected_as": "Conectado como {name}",
  "payments.stripe.form_problem": "Hay un problema con este formulario",
  "payments.stripe.secret_key_required": "Introduce tu clave secreta de Stripe",
  "payments.stripe.connect_failed":
    "No se aceptó esa clave secreta. Compruébala e inténtalo de nuevo.",
  "payments.stripe.add_reader_heading": "Añadir un lector Stripe",
  "payments.stripe.reader_name": "Nombre del lector",
  "payments.stripe.reader_id": "ID del lector",
  "payments.stripe.reader_id_help":
    "El ID del lector Terminal desde tu panel de Stripe: empieza por tmr_.",
  "payments.stripe.reader_name_required": "Ponle un nombre al lector",
  "payments.stripe.reader_id_required": "Introduce el ID de Stripe del lector",
  "payments.stripe.add": "Añadir",
  "payments.stripe.add_failed": "No se aceptó ese ID de lector. Compruébalo e inténtalo de nuevo.",
  "payments.stripe.cancel": "Cancelar",
};

/** The `{ en, es }` catalogue the panel declares (the screen merges it on mount). */
export const STRIPE_STRINGS = { en, es };

registerCatalogue(STRIPE_STRINGS);

/** Translate a Stripe panel key to the active locale, typed to this panel's own key union. */
export const t = makeT<keyof typeof en>();
