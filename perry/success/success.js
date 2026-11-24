(function () {
    'use strict';

    var cfg = window.PERRY_SITE || {};
    var $ = function (id) { return document.getElementById(id); };
    var params = new URLSearchParams(location.search);
    var ORDER_KEY = 'perry_order_id';
    var TOKEN_KEY = 'perry_order_token';
    var ORDER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    var TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

    var orderId = (params.get('order') || '').trim();
    var token = (params.get('token') || '').trim();
    try {
        if (!orderId) orderId = sessionStorage.getItem(ORDER_KEY) || '';
        if (!token) token = sessionStorage.getItem(TOKEN_KEY) || '';
        if (ORDER_RE.test(orderId)) sessionStorage.setItem(ORDER_KEY, orderId);
        if (TOKEN_RE.test(token)) sessionStorage.setItem(TOKEN_KEY, token);
    } catch (_) {}

    var polling = false;
    var attempts = 0;
    var finished = false;
    var timer = null;

    function setPill(label, done) {
        var pill = $('status-pill');
        var text = $('status-label');
        if (text) text.textContent = label;
        if (pill) pill.className = 'status-pill' + (done ? ' is-done' : '');
    }

    function setStatus(title, text, pill, done) {
        var h = $('success-title');
        var p = $('success-text');
        if (h) h.textContent = title;
        if (p) p.textContent = text;
        setPill(pill, done);
    }

    function revealRecover() {
        var card = $('recover-card');
        if (card) card.hidden = false;
        var link = $('recover-link');
        if (link) link.hidden = true;
        var status = $('status-card');
        if (status) status.hidden = true;
        var title = $('page-title');
        if (title) title.textContent = 'Recupera il codice.';
        var sub = $('page-sub');
        if (sub) sub.textContent = 'Inserisci l\'ID ordine e l\'email lasciata al checkout.';
        if (polling) {
            polling = false;
            if (timer) clearTimeout(timer);
        }
    }

    function showCode(code) {
        finished = true;
        if (timer) clearTimeout(timer);
        var checkout = $('open-invoice');
        if (checkout) checkout.remove();
        var status = $('status-card');
        if (status) status.hidden = false;
        var box = $('code-box');
        var value = $('code-value');
        if (box) box.hidden = false;
        if (value) value.textContent = code;
        setStatus(
            'Ecco il tuo codice.',
            'Incollalo nella schermata di licenza di PERRY. Il profilo ospite viene creato in automatico: nessuna email, nessuna password.',
            'Pagamento confermato',
            true
        );
        var link = $('recover-link');
        if (link) link.hidden = true;
        try {
            var clean = location.pathname + '?order=' + encodeURIComponent(orderId);
            history.replaceState({}, '', clean);
        } catch (_) {}
    }

    function invoiceButton(url) {
        if (!url) return;
        try {
            var u = new URL(url);
            if (u.protocol !== 'https:' || (u.hostname !== 'nowpayments.io' && !u.hostname.endsWith('.nowpayments.io'))) return;
        } catch (_) {
            return;
        }
        var actions = $('success-actions');
        if (!actions) return;
        var existing = $('open-invoice');
        if (existing) {
            existing.href = url;
            return;
        }
        var a = document.createElement('a');
        a.className = 'btn btn-primary';
        a.id = 'open-invoice';
        a.href = url;
        a.textContent = 'Apri il checkout';
        actions.insertBefore(a, actions.firstChild);
    }

    function schedule() {
        if (finished || !polling) return;
        if (attempts >= 180) {
            setStatus(
                'Sto ancora aspettando.',
                'Se hai già pagato, la conferma può richiedere qualche minuto. Conserva l\'ID ordine e usa il recupero qui sotto.',
                'In attesa',
                false
            );
            return;
        }
        timer = setTimeout(check, 5000);
    }

    async function check() {
        if (finished || !polling) return;
        attempts += 1;
        try {
            var res = await fetch(cfg.functionsUrl.replace(/\/+$/, '') + '/order-status', {
                method: 'POST',
                headers: {
                    apikey: cfg.supabaseAnonKey,
                    Authorization: 'Bearer ' + cfg.supabaseAnonKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ orderId: orderId, token: token })
            });
            if (res.status === 404) {
                polling = false;
                revealRecover();
                return;
            }
            if (!res.ok) {
                schedule();
                return;
            }
            var data = await res.json();
            invoiceButton(data.invoiceUrl);

            if (data.status === 'finished') {
                var open = $('open-invoice');
                if (open) open.remove();
                if (data.code) {
                    showCode(data.code);
                } else {
                    setStatus(
                        'Pagamento confermato.',
                        'Sto preparando il codice. Questa pagina si aggiorna da sola tra pochi secondi.',
                        'Confermato',
                        true
                    );
                    schedule();
                }
                return;
            }

            if (data.status === 'failed' || data.status === 'expired' || data.status === 'refunded') {
                finished = true;
                setStatus(
                    'Ordine non completato.',
                    'Il pagamento non è andato a buon fine. Nessun codice è stato emesso: puoi riprovare con un nuovo ordine.',
                    'Non completato',
                    false
                );
                return;
            }

            if (data.status === 'partially_paid') {
                setStatus(
                    'Importo incompleto.',
                    'La rete ha ricevuto un importo parziale. Scrivi all\'assistenza con l\'ID ordine prima di riprovare.',
                    'Importo parziale',
                    false
                );
                schedule();
                return;
            }

            if (data.status === 'confirming' || data.status === 'sending') {
                setStatus(
                    'La rete sta confermando.',
                    'Il pagamento è arrivato. Attendo la conferma definitiva: il codice compare qui appena NOWPayments chiude la transazione.',
                    'Conferma in corso',
                    false
                );
            } else {
                setStatus(
                    'Aspetto il pagamento.',
                    'Completa il checkout NOWPayments. Questa pagina controlla l\'ordine ogni pochi secondi e non richiede di ricaricare.',
                    'In attesa',
                    false
                );
            }
            schedule();
        } catch (_) {
            schedule();
        }
    }

    async function copyCode() {
        var value = $('code-value');
        var btn = $('copy-code');
        if (!value || !btn) return;
        var text = value.textContent || '';
        var ok = false;
        try {
            await navigator.clipboard.writeText(text);
            ok = true;
        } catch (_) {
            try {
                var area = document.createElement('textarea');
                area.value = text;
                area.setAttribute('readonly', '');
                area.style.position = 'fixed';
                area.style.opacity = '0';
                document.body.appendChild(area);
                area.select();
                ok = document.execCommand('copy');
                area.remove();
            } catch (_) {}
        }
        btn.textContent = ok ? 'Copiato' : 'Seleziona e copia';
        setTimeout(function () { btn.textContent = 'Copia il codice'; }, 2200);
    }

    async function recover(event) {
        event.preventDefault();
        var id = String(($('recover-order') || {}).value || '').trim().toLowerCase();
        var email = String(($('recover-email') || {}).value || '').trim();
        var msg = $('recover-msg');
        var btn = $('recover-submit');
        if (!ORDER_RE.test(id) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            if (msg) { msg.textContent = 'Controlla ID ordine ed email.'; msg.className = 'buy-msg is-error'; }
            return;
        }
        if (msg) { msg.textContent = 'Cerco l\'ordine…'; msg.className = 'buy-msg'; }
        if (btn) { btn.disabled = true; btn.textContent = 'Cerco…'; }
        try {
            var res = await fetch(cfg.functionsUrl.replace(/\/+$/, '') + '/recover-order', {
                method: 'POST',
                headers: {
                    apikey: cfg.supabaseAnonKey,
                    Authorization: 'Bearer ' + cfg.supabaseAnonKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ orderId: id, email: email })
            });
            var data = null;
            try { data = await res.json(); } catch (_) {}
            if (res.ok && data && data.code) {
                orderId = id;
                try { sessionStorage.setItem(ORDER_KEY, id); } catch (_) {}
                var card = $('recover-card');
                if (card) card.hidden = true;
                var status = $('status-card');
                if (status) status.hidden = false;
                showCode(data.code);
                if (msg) { msg.textContent = ''; msg.className = 'buy-msg'; }
                return;
            }
            if (msg) {
                msg.textContent = data && data.status && data.status !== 'finished'
                    ? 'L\'ordine esiste ma non è ancora stato pagato o confermato.'
                    : 'Nessun ordine trovato con questi dati. Controlla ID ed email, oppure scrivi all\'assistenza.';
                msg.className = 'buy-msg is-error';
            }
        } catch (_) {
            if (msg) {
                msg.textContent = 'Connessione non disponibile. Riprova.';
                msg.className = 'buy-msg is-error';
            }
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Mostra il codice'; }
    }

    var copyBtn = $('copy-code');
    if (copyBtn) copyBtn.addEventListener('click', copyCode);
    var form = $('recover-form');
    if (form) form.addEventListener('submit', recover);

    var wantsRecover = params.get('recover') === '1';
    if (!ORDER_RE.test(orderId) || !TOKEN_RE.test(token) || wantsRecover) {
        revealRecover();
    } else {
        polling = true;
        check();
    }
})();
