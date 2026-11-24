(function () {
    'use strict';

    var cfg = window.PERRY_SITE || {};
    var $ = function (id) { return document.getElementById(id); };
    var params = new URLSearchParams(location.search);
    var slug = (params.get('plan') || 'annual').toLowerCase();
    var authClient = window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey
        ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        })
        : null;
    var session = null;
    var authChecked = false;

    var FALLBACK = {
        monthly: {
            slug: 'monthly', name: 'Mensile', licensePlan: 'monthly',
            amountCents: 599, currency: 'EUR', intervalUnit: 'month', available: true
        },
        annual: {
            slug: 'annual', name: 'Annuale', licensePlan: 'annual',
            amountCents: 3999, currency: 'EUR', intervalUnit: 'year', available: true
        },
        founder_annual: {
            slug: 'founder_annual', name: 'Annuale Fondatore', licensePlan: 'annual',
            amountCents: 2999, currency: 'EUR', intervalUnit: 'year', campaign: 'founder',
            limit: 500, sold: 0, available: true
        },
        christmas_annual: {
            slug: 'christmas_annual', name: 'Annuale Christmas', licensePlan: 'annual',
            amountCents: 3499, currency: 'EUR', intervalUnit: 'year', campaign: 'christmas',
            available: true
        },
        lifetime: {
            slug: 'lifetime', name: 'Lifetime', licensePlan: 'lifetime',
            amountCents: 19900, currency: 'EUR', intervalUnit: null, available: true
        },
        founder_lifetime: {
            slug: 'founder_lifetime', name: 'Lifetime Fondatore', licensePlan: 'lifetime',
            amountCents: 14900, currency: 'EUR', intervalUnit: null, campaign: 'founder',
            limit: 100, sold: 0, available: true
        },
        christmas_lifetime: {
            slug: 'christmas_lifetime', name: 'Lifetime Christmas', licensePlan: 'lifetime',
            amountCents: 16900, currency: 'EUR', intervalUnit: null, campaign: 'christmas',
            available: true
        }
    };

    var DESCS = {
        monthly: 'Trenta giorni pieni, tutte le funzioni. Alla scadenza non parte nulla: decidi tu se rinnovare.',
        annual: 'Dodici mesi di PERRY al prezzo di poco più di sei pass mensili. Nessun addebito automatico.',
        founder_annual: 'Lo stesso annuale, riservato ai primi 500 utenti. Il prezzo resta bloccato per la durata del pass.',
        christmas_annual: 'L\'annuale in versione Christmas, disponibile fino al 6 gennaio. Stesse funzioni, prezzo più basso.',
        lifetime: 'Una volta sola, per sempre. La licenza non scade e non prevede rinnovi.',
        founder_lifetime: 'La lifetime per i primi 100 utenti. Nessuna scadenza, prezzo di lancio.',
        christmas_lifetime: 'La lifetime in versione Christmas, fino al 6 gennaio. Nessuna scadenza.'
    };

    var plan = FALLBACK[slug] || null;
    var busy = false;

    function fmt(cents, currency) {
        try {
            return new Intl.NumberFormat('it-IT', {
                style: 'currency',
                currency: currency || 'EUR'
            }).format(Number(cents) / 100);
        } catch (_) {
            return (Number(cents) / 100).toFixed(2) + ' €';
        }
    }

    function setMsg(text, kind) {
        var el = $('buy-msg');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'buy-msg' + (kind ? ' is-' + kind : '');
    }

    function redirectToAccount() {
        var next = '/perry/buy/?plan=' + encodeURIComponent(slug);
        location.replace('/perry/account/?plan=' + encodeURIComponent(slug) + '&mode=login&next=' + encodeURIComponent(next));
    }

    async function loadSession() {
        if (!authClient) return false;
        try {
            var out = await authClient.auth.getSession();
            session = out && out.data ? out.data.session : null;
        } catch (_) {
            session = null;
        }
        authChecked = true;
        if (!session) {
            redirectToAccount();
            return false;
        }
        var email = $('buy-email');
        if (email && !email.value && session.user && session.user.email) email.value = session.user.email;
        return true;
    }

    function campaignLabel(p) {
        if (p.campaign === 'founder') return 'Founder';
        if (p.campaign === 'christmas') return 'Christmas';
        return p.licensePlan === 'lifetime' ? 'Lifetime' : 'Pass';
    }

    function render(p) {
        if (!p) {
            $('buy-kind').textContent = 'Piano non disponibile';
            $('buy-plan-name').textContent = 'Scegli un piano valido.';
            $('buy-price').textContent = '—';
            $('buy-per').textContent = '';
            $('buy-desc').textContent = 'Il piano richiesto non esiste o non è più in vendita.';
            $('buy-submit').disabled = true;
            setMsg('Torna alla pagina dei piani per scegliere un\'opzione attiva.', 'error');
            return;
        }

        $('buy-kind').textContent = campaignLabel(p) + ' · PERRY';
        $('buy-plan-name').textContent = p.name;
        $('buy-price').textContent = fmt(p.amountCents, p.currency);
        $('buy-per').textContent = p.licensePlan === 'lifetime'
            ? '/ una volta'
            : (p.intervalUnit === 'year' ? '/ 12 mesi' : '/ 30 giorni');

        var desc = DESCS[p.slug] || 'Licenza PERRY per due dispositivi.';
        if (p.limit && p.available) {
            var left = Math.max(0, p.limit - (p.sold || 0));
            desc += ' Restano ' + left + ' posti.';
        }
        if (!p.available) {
            desc = 'Questa offerta è esaurita. Scegli un altro piano dalla pagina prezzi.';
        }
        $('buy-desc').textContent = desc;

        var btn = $('buy-submit');
        if (!authChecked) {
            btn.disabled = true;
            btn.textContent = 'Verifico l\'accesso…';
        } else if (!session) {
            btn.disabled = true;
            btn.textContent = 'Accedi per acquistare';
        } else {
            btn.disabled = !p.available;
            btn.textContent = p.available
                ? 'Paga ' + fmt(p.amountCents, p.currency) + ' con crypto'
                : 'Offerta esaurita';
        }
        document.title = 'Acquista PERRY ' + p.name + ' — pagamento crypto | RootCore';
    }

    async function loadPlans() {
        if (!cfg.functionsUrl || !cfg.supabaseAnonKey) return;
        try {
            var res = await fetch(cfg.functionsUrl.replace(/\/+$/, '') + '/commerce-plans', {
                headers: {
                    apikey: cfg.supabaseAnonKey,
                    Authorization: 'Bearer ' + cfg.supabaseAnonKey
                }
            });
            if (!res.ok) throw new Error('plans');
            var data = await res.json();
            var found = (data.plans || []).find(function (x) { return x.slug === slug; });
            if (found) plan = found;
            else if (data.plans && data.plans.length) plan = null;
        } catch (_) {
            // Il fallback statico permette di aprire il checkout anche se la
            // funzione piani è momentaneamente irraggiungibile; il server
            // rivalida comunque slug e prezzo.
        }
        render(plan);
    }

    async function submit(event) {
        event.preventDefault();
        if (busy || !plan || !plan.available) return;
        if (!authClient || !session) {
            redirectToAccount();
            return;
        }

        var email = String(($('buy-email') || {}).value || '').trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            setMsg('L\'email non sembra valida. Puoi anche lasciarla vuota.', 'error');
            return;
        }
        if (!cfg.functionsUrl || !cfg.supabaseAnonKey) {
            setMsg('Pagamenti non configurati su questo sito. Scrivi a perryadmin@proton.me.', 'error');
            return;
        }

        busy = true;
        var btn = $('buy-submit');
        var old = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Apro NOWPayments…';
        setMsg('Creo l\'ordine sicuro. Non chiudere questa pagina.', '');

        try {
            var fresh = await authClient.auth.getSession();
            session = fresh && fresh.data ? fresh.data.session : null;
            if (!session) {
                redirectToAccount();
                return;
            }
            var res = await fetch(cfg.functionsUrl.replace(/\/+$/, '') + '/create-order', {
                method: 'POST',
                headers: {
                    apikey: cfg.supabaseAnonKey,
                    Authorization: 'Bearer ' + session.access_token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ plan: plan.slug, email: email || null })
            });
            var data = null;
            try { data = await res.json(); } catch (_) {}
            if (res.ok && data && data.invoiceUrl) {
                setMsg('Ordine creato. Ti porto al checkout di NOWPayments…', 'ok');
                location.assign(data.invoiceUrl);
                return;
            }
            var code = data && data.error;
            var map = {
                sold_out: 'Questa offerta è appena finita. Scegli un altro piano.',
                plan_unavailable: 'Questo piano non è più in vendita.',
                rate_limited: 'Troppi tentativi ravvicinati. Aspetta qualche minuto.',
                provider_unavailable: 'NOWPayments non risponde in questo momento. Riprova tra poco.',
                invalid_email: 'L\'email non è valida.',
                account_required: 'Accedi al tuo account per acquistare.',
                order_create_failed: 'Non sono riuscito a creare l\'ordine. Riprova.'
            };
            setMsg(map[code] || 'Pagamento non avviato. Riprova o scrivi a perryadmin@proton.me.', 'error');
        } catch (_) {
            setMsg('Connessione non disponibile. Controlla la rete e riprova.', 'error');
        }

        busy = false;
        btn.disabled = false;
        btn.textContent = old;
    }

    if (params.get('canceled') === '1') {
        setMsg('Pagamento annullato. Nessun addebito: puoi riprovare quando vuoi.', '');
    }

    var form = $('buy-form');
    if (form) form.addEventListener('submit', submit);
    render(plan);
    loadPlans();
    loadSession().then(function (ok) {
        if (ok) render(plan);
    });
})();
