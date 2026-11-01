/* Accesso riservato: senza il codice l'app non si apre.
   I biglietti precaricati (profili.js) sono cifrati con AES-GCM:
   la chiave si ricava dal codice d'accesso, che non è scritto da nessuna parte nel codice. */
'use strict';
const Access = (() => {
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function decrypt(code) {
    const E = typeof ENC_PROFILES !== 'undefined' ? ENC_PROFILES : null;
    if (!E) throw new Error('no data');
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm(code)), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(E.salt), iterations: E.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(E.iv) }, key, b64(E.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Restituisce i dati precaricati al primo accesso, null se l'accesso era già stato fatto
  function ready() {
    if (localStorage.accessOk) return Promise.resolve(null);
    document.documentElement.classList.add('gated');
    const view = document.getElementById('accessView');
    const input = document.getElementById('accessCode');
    const msg = document.getElementById('accessMsg');
    const btn = view.querySelector('button[type=submit]');
    view.classList.remove('hidden');
    setTimeout(() => input.focus(), 300);
    document.getElementById('accessLang').onclick = () => {
      setLang(LANG === 'it' ? 'en' : 'it');
    };
    return new Promise((resolve) => {
      let fails = +localStorage.accessFails || 0;
      document.getElementById('accessForm').onsubmit = async (e) => {
        e.preventDefault();
        const wait = (+localStorage.accessUntil || 0) - Date.now();
        if (wait > 0) {
          msg.className = 'lock-msg bad';
          msg.textContent = t('Troppi tentativi. Riprova tra {n} secondi', { n: Math.ceil(wait / 1000) });
          return;
        }
        if (norm(input.value).length < 8) return;
        btn.disabled = true;
        msg.className = 'lock-msg';
        msg.textContent = t('Controllo il codice...');
        try {
          const data = await decrypt(input.value);
          localStorage.accessOk = '1';
          localStorage.removeItem('accessFails');
          localStorage.removeItem('accessUntil');
          view.classList.add('hidden');
          document.documentElement.classList.remove('gated');
          resolve(data);
        } catch {
          fails++;
          localStorage.accessFails = fails;
          if (fails >= 5) localStorage.accessUntil = Date.now() + Math.min(300, 15 * 2 ** (fails - 5)) * 1000;
          msg.className = 'lock-msg bad';
          msg.textContent = t('Codice errato');
          input.select();
        } finally {
          btn.disabled = false;
        }
      };
    });
  }
  return { ready, decrypt };
})();
