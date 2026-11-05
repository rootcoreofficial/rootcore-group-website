(function () {
    'use strict';

    var cfg = window.PERRY_SITE || {};
    var $ = function (id) { return document.getElementById(id); };
    var params = new URLSearchParams(location.search);
    var wantMode = params.get('mode') === 'signup' ? 'signup' : 'login';
    var wantPlan = ['monthly', 'annual'].indexOf(params.get('plan')) !== -1 ? params.get('plan') : null;

    var client = null;
    if (window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey) {
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
    }

    var state = {
        session: null,
        profile: null,
        license: null,
        activations: [],
        key: null,
        keyAvailable: false,
        revealed: false,
        loadingLicense: false,
        checkoutBusy: false,
        releasing: false
    };

    var PLAN_LABEL = { monthly: 'Mensile', annual: 'Annuale', lifetime: 'Lifetime' };
    var PLAN_DESC = {
        monthly: 'Licenza desktop attiva con rinnovo mensile. Disdici quando vuoi.',
        annual: 'Licenza desktop attiva per un anno. Due mesi in meno rispetto al mensile.',
        lifetime: 'Licenza a vita, legata al tuo account. Nessun rinnovo.'
    };
    var NO_LICENSE_DESC = 'Nessuna licenza attiva. PERRY non ha un piano gratuito: scegli un piano per attivare l\'app.';

    function msg(el, text, kind) {
        if (!el) return;
        el.textContent = text;
        el.className = 'form-msg' + (kind ? ' is-' + kind : '');
    }
    function clearMsg(el) {
        if (!el) return;
        el.textContent = '';
        el.className = 'form-msg';
    }

    function fmtDate(value) {
        if (!value) return '—';
        try {
            return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
        } catch (_) { return '—'; }
    }

    function setMode(mode) {
        var login = mode !== 'signup';
        $('tab-login').setAttribute('aria-selected', login ? 'true' : 'false');
        $('tab-signup').setAttribute('aria-selected', login ? 'false' : 'true');
        $('login-form').hidden = !login;
        $('signup-form').hidden = login;
        $('page-title').textContent = login ? 'Bentornato in sala.' : 'Il tuo posto in sala.';
        $('page-sub').textContent = login
            ? 'Entra con lo stesso account che usi nell\'app PERRY. Da qui vedi piano, chiave e dispositivi.'
            : 'Crea l\'account PERRY. Non esiste un piano gratuito: l\'account serve per scegliere e gestire la licenza.';
        clearMsg($('auth-msg'));
    }

    function showAuth() {
        state.session = null;
        $('auth-shell').classList.remove('is-hidden');
        $('dash').classList.remove('is-active');
        setMode(wantMode);
    }

    function showDashboard(session) {
        state.session = session;
        $('auth-shell').classList.add('is-hidden');
        $('dash').classList.add('is-active');
        $('page-title').textContent = 'Il tuo posto in sala.';
        $('page-sub').textContent = 'Piano, chiave di licenza e dispositivi. Tutto nello stesso account dell\'app.';
        var user = session.user;
        $('dash-mail').textContent = user.email || '';
        var name = (state.profile && (state.profile.display_name || state.profile.username)) ||
            (user.user_metadata && (user.user_metadata.display_name || user.user_metadata.username)) || 'Perry';
        $('dash-name').textContent = name;
        $('dash-avatar').textContent = String(name).charAt(0).toUpperCase();
        loadLicense();
    }

    function planOf() {
        return (state.license && state.license.plan) || 'none';
    }

    function render() {
        var lic = state.license;
        var plan = planOf();
        var status = lic && lic.status;
        var statusLabel = !lic
            ? 'Nessuna licenza'
            : status === 'active' ? 'Attiva'
            : status === 'past_due' ? 'Da rinnovare'
            : status === 'canceled' ? 'Disdetta'
            : status === 'revoked' ? 'Revocata'
            : 'Scaduta';

        $('plan-name').textContent = lic ? (PLAN_LABEL[plan] || plan) : 'Nessuna licenza';
        $('plan-renew').textContent = !lic ? '—'
            : plan === 'lifetime' ? 'Per sempre'
            : lic.expires_at ? 'Fino al ' + fmtDate(lic.expires_at) : '—';
        $('plan-desc').textContent = lic ? (PLAN_DESC[plan] || '') : NO_LICENSE_DESC;

        var badge = $('plan-badge');
        badge.textContent = statusLabel;
        badge.className = 'badge ' + (!lic ? '' : plan === 'lifetime' ? 'lifetime' : status === 'active' ? 'active' : '');

        var actions = $('plan-actions');
        actions.textContent = '';
        if (!lic) {
            var pick = document.createElement('button');
            pick.type = 'button';
            pick.className = 'btn btn-primary';
            pick.textContent = 'Scegli un piano';
            pick.addEventListener('click', function () {
                var card = $('upsell-card');
                if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
            actions.appendChild(pick);
        } else if (plan === 'monthly' || plan === 'annual') {
            var portal = document.createElement('button');
            portal.type = 'button';
            portal.className = 'btn btn-ghost';
            portal.textContent = 'Gestisci abbonamento';
            portal.addEventListener('click', openPortal);
            actions.appendChild(portal);
            if (plan === 'monthly') {
                var up = document.createElement('button');
                up.type = 'button';
                up.className = 'btn btn-quiet';
                up.textContent = 'Passa all\'annuale';
                up.setAttribute('data-checkout', 'annual');
                actions.appendChild(up);
            }
        } else if (plan === 'lifetime') {
            var span = document.createElement('span');
            span.className = 'badge lifetime';
            span.textContent = 'Licenza a vita';
            actions.appendChild(span);
        }

        $('upsell-card').hidden = !!lic;

        renderKey();
        renderActivations();

        var dl = $('dl-license');
        dl.textContent = lic ? (PLAN_LABEL[plan] || plan) + ' · ' + statusLabel : 'Nessuna licenza desktop';
        var dlBtn = $('dl-btn');
        if (cfg.downloadUrl) {
            dlBtn.href = cfg.downloadUrl;
            dlBtn.textContent = 'Scarica PERRY';
            $('dl-version').textContent = cfg.version || '1.1.5';
        } else {
            dlBtn.href = '/perry/#download';
            dlBtn.textContent = 'Vai al download';
        }
    }

    function renderKey() {
        var lic = state.license;
        var code = $('key-code');
        var box = $('key-box');
        var help = $('key-help');
        var stateBadge = $('key-state');
        var reveal = $('key-reveal');
        var copy = $('key-copy');

        if (!lic) {
            code.textContent = 'PERRY-•••••-•••••-•••••-•••••';
            box.classList.add('is-locked');
            stateBadge.textContent = 'Nessuna';
            stateBadge.className = 'badge';
            help.textContent = 'PERRY non ha un piano gratuito. La chiave viene emessa con un piano Mensile, Annuale o con una licenza lifetime su invito.';
            reveal.hidden = true;
            copy.hidden = true;
            return;
        }

        stateBadge.textContent = lic.status === 'active' ? 'Attiva' : 'Non attiva';
        stateBadge.className = 'badge ' + (lic.status === 'active' ? 'active' : '');

        if (state.keyAvailable && state.key) {
            box.classList.remove('is-locked');
            if (state.revealed) {
                code.textContent = state.key;
                reveal.textContent = 'Nascondi';
            } else {
                code.textContent = 'PERRY-•••••-•••••-•••••-' + state.key.slice(-5);
                reveal.textContent = 'Mostra';
            }
            reveal.hidden = false;
            copy.hidden = false;
            help.textContent = 'Conservala in un posto sicuro. La chiave è legata alla tua licenza e va inserita una sola volta nell\'app.';
        } else {
            box.classList.add('is-locked');
            var last = lic.hint ? lic.hint.slice(-5) : '•••••';
            code.textContent = 'PERRY-•••••-•••••-•••••-' + last;
            reveal.hidden = true;
            copy.hidden = true;
            help.textContent = 'La chiave completa è disponibile tramite l\'area sicura. Se non compare, contatta l\'assistenza RootCore.';
        }
    }

    function renderActivations() {
        var list = $('activation-list');
        var empty = $('activation-empty');
        var seats = $('seats-label');
        list.textContent = '';

        var max = (state.license && state.license.maxSeats) || 0;
        var used = state.activations ? state.activations.length : 0;
        seats.textContent = max ? used + ' / ' + max + ' posti' : '—';

        if (!used) {
            empty.hidden = false;
            return;
        }
        empty.hidden = true;

        state.activations.forEach(function (a) {
            var li = document.createElement('li');
            var dev = document.createElement('div');
            dev.className = 'dev';
            dev.textContent = a.label || 'Dispositivo';
            var meta = document.createElement('div');
            meta.className = 'when';
            meta.textContent = a.lastSeenAt ? 'Ultimo accesso ' + fmtDate(a.lastSeenAt) : 'Attivato';
            dev.appendChild(meta);

            var side = document.createElement('div');
            side.className = 'dev-side';
            var release = document.createElement('button');
            release.type = 'button';
            release.className = 'dev-release';
            release.textContent = 'Libera';
            var armed = false;
            var disarm = null;
            release.addEventListener('click', function () {
                if (state.releasing) return;
                if (!armed) {
                    armed = true;
                    release.textContent = 'Conferma';
                    release.classList.add('is-armed');
                    disarm = setTimeout(function () {
                        armed = false;
                        release.textContent = 'Libera';
                        release.classList.remove('is-armed');
                    }, 3500);
                    return;
                }
                if (disarm) clearTimeout(disarm);
                armed = false;
                releaseDevice(a.id, release);
            });
            side.appendChild(release);

            li.appendChild(dev);
            li.appendChild(side);
            list.appendChild(li);
        });
    }

    async function releaseDevice(activationId, btn) {
        if (!client || !activationId || state.releasing) return;
        state.releasing = true;
        btn.disabled = true;
        btn.textContent = 'Libero…';
        clearMsg($('dash-msg'));

        var released = false;
        try {
            var res = await client.functions.invoke('license-deactivate', {
                method: 'POST',
                body: { activationId: activationId }
            });
            released = !res.error && res.data && res.data.ok;
        } catch (_) { released = false; }

        state.releasing = false;
        await loadLicense();

        msg($('dash-msg'), released
            ? 'Dispositivo liberato. Puoi attivare un altro PC con la stessa chiave.'
            : 'Liberazione non riuscita. Ricarica la pagina e riprova.',
            released ? 'ok' : 'error');
    }

    async function loadLicense() {
        if (!client || !state.session || state.loadingLicense) return;
        state.loadingLicense = true;

        try {
            var res = await client.functions.invoke('license-me', { method: 'POST' });
            if (!res.error && res.data && res.data.license !== undefined) {
                state.license = res.data.license || null;
                state.activations = (res.data.license && res.data.license.activations) || [];
                state.key = (res.data.license && res.data.license.key) || null;
                state.keyAvailable = !!state.key;
                clearMsg($('dash-msg'));
            } else {
                state.license = null;
                state.activations = [];
                state.key = null;
                state.keyAvailable = false;
                msg($('dash-msg'), 'Impossibile leggere la licenza in questo momento. Ricarica la pagina o riprova tra poco.', 'error');
            }
        } catch (_) {
            state.license = null;
            state.activations = [];
            state.key = null;
            state.keyAvailable = false;
            msg($('dash-msg'), 'Servizio licenze non raggiungibile. Riprova tra poco.', 'error');
        }

        render();
        state.loadingLicense = false;
    }

    async function openPortal() {
        clearMsg($('dash-msg'));
        try {
            var res = await client.functions.invoke('stripe-portal', { method: 'POST', body: {} });
            if (!res.error && res.data && res.data.url) {
                location.href = res.data.url;
                return;
            }
            msg($('dash-msg'), 'La gestione automatica non è ancora attiva. Scrivi a rootcoregroup.official@gmail.com per modificare il piano.', 'error');
        } catch (_) {
            msg($('dash-msg'), 'La gestione automatica non è ancora attiva. Scrivi a rootcoregroup.official@gmail.com per modificare il piano.', 'error');
        }
    }

    async function checkout(plan) {
        if (!client || state.checkoutBusy) return;
        if (!state.session) {
            setMode('login');
            msg($('auth-msg'), 'Entra nel tuo account per scegliere un piano.', 'error');
            return;
        }
        state.checkoutBusy = true;
        clearMsg($('dash-msg'));
        var buttons = document.querySelectorAll('[data-checkout]');
        buttons.forEach(function (b) { b.setAttribute('aria-disabled', 'true'); });

        try {
            var res = await client.functions.invoke('stripe-checkout', { method: 'POST', body: { plan: plan } });
            if (!res.error && res.data && res.data.url) {
                location.href = res.data.url;
                return;
            }
            var message = (res.data && res.data.message) || 'Pagamenti in attivazione. Scrivici per attivare il piano.';
            msg($('dash-msg'), message + ' · rootcoregroup.official@gmail.com', 'error');
        } catch (_) {
            msg($('dash-msg'), 'Pagamenti in attivazione. Scrivi a rootcoregroup.official@gmail.com per attivare il piano.', 'error');
        }

        state.checkoutBusy = false;
        buttons.forEach(function (b) { b.removeAttribute('aria-disabled'); });
    }

    async function onLogin(event) {
        event.preventDefault();
        clearMsg($('auth-msg'));
        var email = $('login-email').value.trim();
        var pass = $('login-pass').value;
        if (!email || !pass) {
            msg($('auth-msg'), 'Inserisci email e password.', 'error');
            return;
        }
        var btn = $('login-btn');
        btn.disabled = true;
        btn.textContent = 'Entro…';
        try {
            var result = await client.auth.signInWithPassword({ email: email, password: pass });
            if (result.error) {
                msg($('auth-msg'), 'Email o password non corretti. Riprova.', 'error');
            } else {
                await afterAuth(result.data.session);
            }
        } catch (_) {
            msg($('auth-msg'), 'Accesso non disponibile. Riprova tra poco.', 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Entra nel tuo account';
    }

    async function onSignup(event) {
        event.preventDefault();
        clearMsg($('auth-msg'));
        var username = $('signup-user').value.trim();
        var email = $('signup-email').value.trim();
        var pass = $('signup-pass').value;

        if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) {
            msg($('auth-msg'), 'Username: da 3 a 20 caratteri tra lettere, numeri, punto e trattobasso.', 'error');
            return;
        }
        if (!email) {
            msg($('auth-msg'), 'Inserisci la tua email.', 'error');
            return;
        }
        if (pass.length < 6) {
            msg($('auth-msg'), 'La password deve avere almeno 6 caratteri.', 'error');
            return;
        }

        var btn = $('signup-btn');
        btn.disabled = true;
        btn.textContent = 'Creo l\'account…';
        try {
            var free = await client.rpc('username_available', { candidate: username });
            if (free.error) {
                msg($('auth-msg'), 'Impossibile verificare lo username. Riprova.', 'error');
            } else if (free.data === false) {
                msg($('auth-msg'), 'Username già in uso. Scegline un altro.', 'error');
            } else {
                var result = await client.auth.signUp({
                    email: email,
                    password: pass,
                    options: { data: { username: username, display_name: username } }
                });
                if (result.error) {
                    msg($('auth-msg'), result.error.message || 'Registrazione non riuscita.', 'error');
                } else if (result.data.session) {
                    await afterAuth(result.data.session);
                } else {
                    msg($('auth-msg'), 'Account creato. Controlla la mail per confermare, poi torna qui ed entra.', 'ok');
                }
            }
        } catch (_) {
            msg($('auth-msg'), 'Registrazione non disponibile. Riprova tra poco.', 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Crea il tuo account';
    }

    async function afterAuth(session) {
        if (!session) {
            showAuth();
            return;
        }
        state.session = session;
        try {
            var row = await client.from('profiles').select('username,display_name').eq('id', session.user.id).maybeSingle();
            if (!row.error) state.profile = row.data;
        } catch (_) { /* il profilo arriva comunque dai metadati */ }
        showDashboard(session);

        if (wantPlan) {
            msg($('dash-msg'), 'Piano selezionato: ' + (wantPlan === 'annual' ? 'Annuale' : 'Mensile') + '. Apro il pagamento…', 'ok');
            setTimeout(function () { checkout(wantPlan); }, 1200);
        }
        if (params.get('checkout') === 'success') {
            msg($('dash-msg'), 'Pagamento ricevuto. Sto aggiornando la licenza…', 'ok');
            setTimeout(loadLicense, 1600);
            setTimeout(loadLicense, 4200);
        }
    }

    async function logout() {
        try { await client.auth.signOut(); } catch (_) {}
        state.session = null;
        state.profile = null;
        state.license = null;
        state.activations = [];
        state.key = null;
        showAuth();
    }

    function wire() {
        if (!client) {
            msg($('auth-msg'), 'Configurazione del sito non disponibile. Riprova più tardi.', 'error');
            return;
        }

        $('tab-login').addEventListener('click', function () { setMode('login'); });
        $('tab-signup').addEventListener('click', function () { setMode('signup'); });
        $('login-form').addEventListener('submit', onLogin);
        $('signup-form').addEventListener('submit', onSignup);
        $('logout-btn').addEventListener('click', logout);

        $('forgot-link').addEventListener('click', async function (e) {
            e.preventDefault();
            var email = $('login-email').value.trim();
            if (!email) {
                msg($('auth-msg'), 'Scrivi prima la tua email, poi richiedi il reset.', 'error');
                $('login-email').focus();
                return;
            }
            try {
                var r = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/perry/account/' });
                if (r.error) throw r.error;
                msg($('auth-msg'), 'Ti abbiamo inviato il link per reimpostare la password.', 'ok');
            } catch (_) {
                msg($('auth-msg'), 'Invio non riuscito. Riprova tra poco.', 'error');
            }
        });

        $('key-reveal').addEventListener('click', function () {
            state.revealed = !state.revealed;
            renderKey();
        });

        $('key-copy').addEventListener('click', async function () {
            if (!state.key) return;
            var btn = $('key-copy');
            try {
                await navigator.clipboard.writeText(state.key);
                btn.textContent = 'Copiata';
                setTimeout(function () { btn.textContent = 'Copia'; }, 1800);
            } catch (_) {
                var box = $('key-box');
                if (box) {
                    var range = document.createRange();
                    range.selectNodeContents($('key-code'));
                    var sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
                msg($('dash-msg'), 'Seleziona e copia la chiave manualmente.', 'ok');
            }
        });

        document.addEventListener('click', function (e) {
            var target = e.target.closest('[data-checkout]');
            if (!target) return;
            e.preventDefault();
            checkout(target.getAttribute('data-checkout'));
        });

        window.addEventListener('scroll', function () {
            var header = document.getElementById('site-header');
            if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);
        }, { passive: true });

        client.auth.onAuthStateChange(function (event, session) {
            if (event === 'SIGNED_OUT') {
                showAuth();
            } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session && !state.session) {
                setTimeout(function () { afterAuth(session); }, 0);
            }
        });

        setMode(wantMode);

        client.auth.getSession().then(function (result) {
            var session = result.data && result.data.session;
            if (session) afterAuth(session);
            else showAuth();
        }).catch(function () { showAuth(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire);
    } else {
        wire();
    }
})();
