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

`C:\Users\spect\Downloads\rootcore-license-admin\seed_lifetime_keys.sql`
contiene solo hash e ciphertext. Eseguilo dopo la migrazione.
Le chiavi in chiaro restano in `keys.txt` fuori dal repository.

## 3. Secret delle funzioni

Da `C:\Users\spect\Downloads\rootcore-license-admin\secrets.env`:

```bash
npx supabase secrets set --env-file "C:\Users\spect\Downloads\rootcore-license-admin\secrets.env" --project-ref "$SUPABASE_PROJECT_REF"
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

## 5. Stripe

1. Crea due prezzi ricorrenti: 9,99 €/mese e 79 €/anno.
2. Webhook: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`.
3. Eventi: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`.

La chiave viene generata solo al primo pagamento riuscito e mostrata
nell'area account del sito.

## 6. Contratto API

| Funzione | Auth | Uso |
| --- | --- | --- |
| `license-precheck` | no | verifica formato/esistenza chiave prima del login |
| `license-activate` | JWT | lega la chiave all'account e al dispositivo, emette il lease |
| `license-refresh` | JWT | rinnova il lease (30 giorni) |
| `license-me` | JWT | piano, chiave, attivazioni per la dashboard |
| `license-deactivate` | JWT | libera un posto macchina |
| `stripe-checkout` | JWT | crea la sessione di pagamento |
| `stripe-portal` | JWT | gestione abbonamento |
| `stripe-webhook` | firma Stripe | emissione/rinnovo licenza |

Il lease è firmato Ed25519. La chiave pubblica è in
`rootcore-license-admin/public-key.pem`; la privata resta solo nei secret.

## 7. Rotazione

Se cambi `LICENSE_HMAC_PEPPER` o `LICENSE_AES_KEY`, le chiavi già emesse non
sono più verificabili. Conserva `secrets.json` e `keys.txt` fuori dal repo.
