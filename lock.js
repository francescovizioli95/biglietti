/* Blocco dell'app: PIN e impronta digitale. Tutto resta sul telefono. */
'use strict';
const Lock = (() => {
  const K = { hash: 'lockHash', salt: 'lockSalt', cred: 'lockCred', fails: 'lockFails', until: 'lockUntil' };
  const RELOCK_MS = 60 * 1000; // si richiude se l'app resta in background più di 1 minuto
  let hiddenAt = 0;
  let pin = '';
  let mode = 'unlock'; // unlock | set1 | set2
  let firstPin = '';
  let onDone = null;

  const enabled = () => !!localStorage[K.hash];
  const hasBio = () => !!localStorage[K.cred];
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function hashPin(p, salt) {
    const data = new TextEncoder().encode(salt + ':' + p);
    let h = await crypto.subtle.digest('SHA-256', data);
    for (let i = 0; i < 2000; i++) h = await crypto.subtle.digest('SHA-256', h);
    return b64(h);
  }
  async function bioAvailable() {
    try {
      return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
    } catch { return false; }
  }

  const el = (s) => document.querySelector(s);
  function render() {
    const dots = el('#lockDots');
    dots.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
    const titles = { unlock: 'Inserisci il PIN', set1: 'Scegli un PIN di 6 cifre', set2: 'Ripeti il PIN' };
    el('#lockTitle').textContent = window.t(titles[mode]);
    el('#lockBio').classList.toggle('hidden', !(mode === 'unlock' && hasBio()));
    el('#lockCancel').classList.toggle('hidden', mode === 'unlock');
  }
  function msg(s, bad) {
    const m = el('#lockMsg');
    m.textContent = s ? window.t(s) : '';
    m.classList.toggle('bad', !!bad);
    if (bad) {
      el('#lockDots').classList.remove('shake');
      void el('#lockDots').offsetWidth;
      el('#lockDots').classList.add('shake');
      try { navigator.vibrate && navigator.vibrate(120); } catch {}
    }
  }
  function show(m) {
    mode = m;
    pin = '';
    msg('');
    render();
    el('#lockView').classList.remove('hidden');
    document.documentElement.classList.add('locked');
  }
  function hide() {
    el('#lockView').classList.add('hidden');
    document.documentElement.classList.remove('locked');
  }
  async function submit() {
    if (mode === 'unlock') {
      const until = +localStorage[K.until] || 0;
      if (Date.now() < until) {
        pin = '';
        render();
        return msg(window.t('Troppi tentativi. Riprova tra {n} secondi', { n: Math.ceil((until - Date.now()) / 1000) }), true);
      }
      if ((await hashPin(pin, localStorage[K.salt])) === localStorage[K.hash]) {
        localStorage[K.fails] = 0;
        hide();
      } else {
        const f = (+localStorage[K.fails] || 0) + 1;
        localStorage[K.fails] = f;
        if (f >= 5) localStorage[K.until] = Date.now() + 30000 * Math.pow(2, f - 5);
        pin = '';
        render();
        msg('PIN errato', true);
      }
    } else if (mode === 'set1') {
      firstPin = pin;
      mode = 'set2';
      pin = '';
      msg('');
      render();
    } else if (mode === 'set2') {
      if (pin !== firstPin) {
        mode = 'set1';
        pin = '';
        render();
        return msg('I PIN non coincidono, riprova', true);
      }
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      localStorage[K.salt] = salt;
      localStorage[K.hash] = await hashPin(pin, salt);
      localStorage[K.fails] = 0;
      hide();
      if (onDone) onDone(true);
    }
  }
  function press(k) {
    if (k === 'del') pin = pin.slice(0, -1);
    else if (pin.length < 6) pin += k;
    msg('');
    render();
    if (pin.length === 6) setTimeout(submit, 120);
  }

  async function bioUnlock() {
    if (!hasBio()) return;
    try {
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: 'public-key', id: unb64(localStorage[K.cred]), transports: ['internal'] }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      localStorage[K.fails] = 0;
      hide();
    } catch (e) {
      if (e && e.name !== 'NotAllowedError') msg('Impronta non disponibile, usa il PIN');
    }
  }
  async function enableBio() {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Biglietti' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'biglietti', displayName: 'Biglietti' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000,
      },
    });
    localStorage[K.cred] = b64(cred.rawId);
  }

  function init() {
    el('#lockPad').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (b) press(b.dataset.k);
    });
    el('#lockBio').onclick = bioUnlock;
    el('#lockCancel').onclick = () => {
      hide();
      if (onDone) onDone(false);
    };
    document.addEventListener('keydown', (e) => {
      if (el('#lockView').classList.contains('hidden')) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
    });
    document.addEventListener('visibilitychange', () => {
      if (!enabled()) return;
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > RELOCK_MS) {
        show('unlock');
        if (hasBio()) bioUnlock();
      }
    });
    if (enabled()) {
      show('unlock');
      if (hasBio()) setTimeout(bioUnlock, 300);
    } else hide();
  }

  return {
    init,
    enabled,
    hasBio,
    bioAvailable,
    lockNow: () => enabled() && show('unlock'),
    setPin: () => new Promise((res) => { onDone = res; show('set1'); }),
    async enableBio() { await enableBio(); },
    disable() {
      for (const k of Object.values(K)) localStorage.removeItem(k);
    },
    disableBio() { localStorage.removeItem(K.cred); },
  };
})();
