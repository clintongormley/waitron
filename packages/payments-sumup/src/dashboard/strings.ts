import { makeT, registerCatalogue } from "@waitron/dashboard-kit";

// The SumUp panel's OWN i18n surface: the connect-form and add-reader UI strings, English the source
// of truth. This is browser UI (out of the english-only guard's scope), so the Spanish is user-facing
// translation, not schema vocabulary. The module registers its catalogue at load — before any t()
// runs — so importing this module's `t` is enough to make the strings resolve; the panel also declares
// these strings so the screen registers them on mount.
//
// NOTE: the ERROR-CODE copy for `payment.provider_merchant_ambiguous`,
// `payment.provider_credential_rejected`, `payment.pairing_expired` and `payment.pairing_refused`
// lives centrally in `apps/dashboard/src/i18n/codes.ts` (registered via `registerCodeMessages`) — that
// is Task 15's job. This panel is self-contained: it renders its OWN screen strings for the pairing
// outcomes (`pairing_expired`, `pairing_failed`) and falls back to the shared `codeMessage` for a
// rejected connect, so it needs no code copy of its own here.

const en = {
  "payments.sumup.name": "SumUp",
  "payments.sumup.connect_heading": "Connect SumUp",
  "payments.sumup.api_key": "API key",
  "payments.sumup.affiliate_app_id": "Affiliate app ID",
  "payments.sumup.affiliate_key": "Affiliate key",
  "payments.sumup.affiliate_help":
    "Only fill these in if SumUp gave you affiliate credentials for card readers. Leave both blank otherwise.",
  "payments.sumup.affiliate_help_label": "About the affiliate fields",
  "payments.sumup.connect": "Connect",
  "payments.sumup.connected_as": "Connected as {name}",
  "payments.sumup.merchant_prompt":
    "This key covers more than one merchant. Choose which one to connect.",
  "payments.sumup.merchant_label": "Merchant",
  "payments.sumup.form_problem": "There is a problem with this form",
  "payments.sumup.api_key_required": "Enter your SumUp API key",
  "payments.sumup.merchant_required": "Choose a merchant to connect",
  "payments.sumup.connect_failed": "That API key was not accepted. Check it and try again.",
  "payments.sumup.add_reader_heading": "Add a SumUp reader",
  "payments.sumup.reader_name": "Reader name",
  "payments.sumup.pairing_code": "Pairing code",
  "payments.sumup.reader_name_required": "Give the reader a name",
  "payments.sumup.pairing_code_required": "Enter the pairing code shown on the reader",
  "payments.sumup.pairing_steps":
    "On the Solo reader open Settings, then Pairing, and read off the 8–9 character code. Pairing switches off standalone use on that Solo — afterwards it only takes payments sent from Waitron.",
  "payments.sumup.pair": "Pair",
  "payments.sumup.pairing_in_progress": "Waiting for the reader to confirm…",
  "payments.sumup.pairing_time_left": "{time} left",
  "payments.sumup.pairing_expired": "The pairing code ran out before the reader confirmed.",
  "payments.sumup.pairing_failed": "Pairing did not work. Check the code and try again.",
  "payments.sumup.try_again": "Try again",
  "payments.sumup.cancel": "Cancel",
} as const;

const es: Record<keyof typeof en, string> = {
  "payments.sumup.name": "SumUp",
  "payments.sumup.connect_heading": "Conectar SumUp",
  "payments.sumup.api_key": "Clave de API",
  "payments.sumup.affiliate_app_id": "ID de app de afiliado",
  "payments.sumup.affiliate_key": "Clave de afiliado",
  "payments.sumup.affiliate_help":
    "Rellena estos campos solo si SumUp te dio credenciales de afiliado para los lectores. Déjalos en blanco en caso contrario.",
  "payments.sumup.affiliate_help_label": "Acerca de los campos de afiliado",
  "payments.sumup.connect": "Conectar",
  "payments.sumup.connected_as": "Conectado como {name}",
  "payments.sumup.merchant_prompt": "Esta clave abarca más de un comercio. Elige cuál conectar.",
  "payments.sumup.merchant_label": "Comercio",
  "payments.sumup.form_problem": "Hay un problema con este formulario",
  "payments.sumup.api_key_required": "Introduce tu clave de API de SumUp",
  "payments.sumup.merchant_required": "Elige un comercio para conectar",
  "payments.sumup.connect_failed":
    "No se aceptó esa clave de API. Compruébala e inténtalo de nuevo.",
  "payments.sumup.add_reader_heading": "Añadir un lector SumUp",
  "payments.sumup.reader_name": "Nombre del lector",
  "payments.sumup.pairing_code": "Código de emparejamiento",
  "payments.sumup.reader_name_required": "Ponle un nombre al lector",
  "payments.sumup.pairing_code_required": "Introduce el código que muestra el lector",
  "payments.sumup.pairing_steps":
    "En el lector Solo abre Ajustes, luego Emparejamiento, y lee el código de 8-9 caracteres. El emparejamiento desactiva el uso autónomo de ese Solo: después solo aceptará pagos enviados desde Waitron.",
  "payments.sumup.pair": "Emparejar",
  "payments.sumup.pairing_in_progress": "Esperando a que el lector confirme…",
  "payments.sumup.pairing_time_left": "quedan {time}",
  "payments.sumup.pairing_expired":
    "El código de emparejamiento caducó antes de que el lector confirmara.",
  "payments.sumup.pairing_failed":
    "El emparejamiento no funcionó. Comprueba el código e inténtalo de nuevo.",
  "payments.sumup.try_again": "Inténtalo de nuevo",
  "payments.sumup.cancel": "Cancelar",
};

/** The `{ en, es }` catalogue the panel declares (the screen merges it on mount). */
export const SUMUP_STRINGS = { en, es };

registerCatalogue(SUMUP_STRINGS);

/** Translate a SumUp panel key to the active locale, typed to this panel's own key union so an unknown
 * key is a compile error. Resolution (region-strip, English-degrade) is the kit's. */
export const t = makeT<keyof typeof en>();
