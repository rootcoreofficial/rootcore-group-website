# Licenze PERRY — deploy del backend condiviso

Stesso progetto Supabase dell'app PERRY: un solo database per app e sito.

## 1. Migrazione

```bash
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push
```

Oppure esegui `migrations/014_licenses.sql` nel SQL Editor del progetto.
Il file crea `licenses`, `license_activations`, `license_events`, la RPC di
attivazione atomica e chiude tutto ad `anon`/`authenticated`.

## 2. Seed lifetime

`<cartella-locale>/rootcore-license-admin/seed_lifetime_keys.sql`
contiene solo hash e ciphertext. Eseguilo dopo la migrazione.
Le chiavi in chiaro restano in `keys.txt` fuori dal repository.

## 3. Secret delle funzioni

Da `<cartella-locale>/rootcore-license-admin/secrets.env`:

```bash
npx supabase secrets set --env-file "<cartella-locale>/rootcore-license-admin/secrets.env" --project-ref "$SUPABASE_PROJECT_REF"
```

Variabili richieste: `LICENSE_HMAC_PEPPER`, `LICENSE_AES_KEY`,
`LICENSE_SIGNING_KEY`. `SUPABASE_URL`, `SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY` sono già iniettate dal runtime.

Per i pagamenti, quando Stripe è pronto:

```bash
npx supabase secrets set \
  STRIPE_SECRET_KEY=... \
  STRIPE_WEBHOOK_SECRET=... \
  STRIPE_PRICE_MONTHLY=... \
  STRIPE_PRICE_ANNUAL=... \
  SITE_URL=https://www.rootcoregroup.com \
  --project-ref "$SUPABASE_PROJECT_REF"
```

Senza queste variabili `stripe-checkout` risponde 503 e il sito mostra
"Pagamenti in attivazione". Le licenze lifetime funzionano comunque.

## 4. Funzioni

```bash
npx supabase functions deploy \
  license-precheck license-activate license-refresh license-me license-deactivate \
  stripe-checkout stripe-portal \
  --project-ref "$SUPABASE_PROJECT_REF"

# Il webhook arriva da Stripe senza JWT: la firma la verifica la funzione.
npx supabase functions deploy stripe-webhook --no-verify-jwt --project-ref "$SUPABASE_PROJECT_REF"
```

Endpoint: `https://<project-ref>.supabase.co/functions/v1/<nome>`.
CORS consentito: `www.rootcoregroup.com`, `rootcoregroup.com`,
`127.0.0.1:8091`, `localhost:8091`.

`license-precheck` e le altre funzioni restano con la verifica JWT della
piattaforma: l'app le chiama con la anon key (precheck) o con il token
dell'utente (attivazione, refresh, dashboard).

## 5. NOWPayments

Il canale attivo è NOWPayments. I piani e i prezzi stanno nella migrazione
`035_commerce_c1.sql`; il codice non decide mai l'importo.

1. Secret Edge: `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_KEY`, `PERRY_SITE_URL`.
2. Webhook: `https://<project-ref>.supabase.co/functions/v1/nowpayments-webhook`,
   deployato con `--no-verify-jwt`. La firma HMAC-SHA512 è verificata sulla
   canonicalizzazione del payload; solo `finished` emette il codice.
3. Checkout: `create-order` crea l'invoice ospitata su NOWPayments e salva
   `token` (hash), `invoice_id` e importo. Il successo torna su
   `/perry/success/?order=…&token=…`.
4. Consegna: `order-status` mostra il codice cifrato solo con ordine + token.
   `recover-order` lo ripete con ordine + email (se lasciata al checkout).
5. Attivazione: `license-precheck` riconosce i codici; `license-activate`
   crea la sessione anonima Supabase e lega il dispositivo. Lo stesso codice
   copre due dispositivi; il refresh del secondo passa da `license-refresh`.

Le funzioni Stripe restano nel progetto come canale legacy, ma il sito non
le usa più per i nuovi acquisti.

## 6. Contratto API

| Funzione | Auth | Uso |
| --- | --- | --- |
| `license-precheck` | no | verifica chiave/codice e disponibilità posti |
| `license-activate` | JWT (anche anonimo) | lega la chiave al dispositivo, emette il lease |
| `license-refresh` | JWT (anche anonimo) | rinnova il lease (30 giorni) per dispositivo |
| `license-me` | JWT | piano, chiave, attivazioni per la dashboard |
| `license-deactivate` | JWT | libera un posto macchina |
| `commerce-plans` | no | piani attivi, prezzi e disponibilità |
| `create-order` | anon key | crea ordine e invoice NOWPayments |
| `order-status` | token ordine | stato e consegna del codice |
| `recover-order` | ordine + email | recupero del codice |
| `nowpayments-webhook` | firma IPN | chiusura ordine ed emissione codice |
| `stripe-checkout` | JWT | canale legacy |
| `stripe-portal` | JWT | canale legacy |
| `stripe-webhook` | firma Stripe | canale legacy |

Il lease è firmato Ed25519. La chiave pubblica è in
`rootcore-license-admin/public-key.pem`; la privata resta solo nei secret.

## 7. Rotazione

Se cambi `LICENSE_HMAC_PEPPER` o `LICENSE_AES_KEY`, le chiavi già emesse non
sono più verificabili. Conserva `secrets.json` e `keys.txt` fuori dal repo.
