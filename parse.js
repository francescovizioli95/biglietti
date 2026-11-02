// Estrae i campi di un biglietto da visita dal testo letto con l'OCR.
// Input: array di righe { text, height } (height = altezza in pixel della riga, se nota).
(function (root) {
  const EMAIL_RE = /[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9.-]+\s?\.\s?[A-Za-z]{2,}/g;
  const URL_RE = /\b((?:https?:\/\/)?(?:www\.)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/\S*)?|[A-Za-z0-9-]+\.(?:it|com|net|org|eu|biz|info|io|co|de|fr|es|ch|uk|ai|ae|app|tech|us|ca|au|nl|be|at|pt|sm|me|tv|pro|finance|capital|digital|global|group|trade|markets|money|bank)\b(?:\/\S*)?)/i;
  const PHONE_RE = /(?:\+|00)?\d[\d\s().\/-]{6,}\d/g;

  const COMPANY_WORDS = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|ltd|inc|gmbh|llc|group|gruppo|studio|società|societa|company|azienda|consulting|srl|spa|onlus|coop|cooperativa|associati|holding|solutions|systems|services|servizi|italia|italy|agency|agenzia)\b/i;
  const ROLE_WORDS = /\b(advisor|adviser|trader|broker|analyst|analista|investor|investitore|private banker|banker|wealth|portfolio|gestore|promotore|ceo|cto|cfo|coo|founder|co-founder|fondatore|titolare|amministratore|direttore|direttrice|director|manager|manag\w*|direct\w*|business development|head of \w+|responsabile|presidente|president|socio|partner|consulente|consultant|ingegnere|engineer|architetto|architect|avvocato|avv\.?|dott\.?|dottore|dottoressa|dr\.?|geom\.?|rag\.?|ing\.?|arch\.?|commerciale|sales|account|marketing|developer|sviluppatore|designer|agente|tecnico|specialist|head|officer|assistant|segretari[ao]|impiegat[ao]|notaio|commercialista|medico|odontoiatra|fisioterapista)\b/i;
  const ADDRESS_WORDS = /\b(via|viale|v\.le|piazza|p\.za|p\.zza|corso|c\.so|largo|vicolo|strada|str\.|località|loc\.|contrada|borgo|street|st\.|avenue|road)\b/i;
  const CAP_RE = /\b\d{5}\b/;
  const LABEL_RE = /^(?:(?:tel|telefono|phone|ph|cell|cellulare|mobile|mob|fax|e-?mail|mail|web|sito|ufficio|office)\s*[:.]?\s+|(?:tel|telefono|phone|ph|cell|cellulare|mobile|mob|fax|e-?mail|mail|web|sito|ufficio|office|[tmfpew])\s*[:.]\s*)/i;
  const TITLE_PREFIX = /^(dott\.?ssa|dott\.?|dr\.?|ing\.?|avv\.?|arch\.?|geom\.?|rag\.?|prof\.?ssa|prof\.?|sig\.?ra|sig\.?)\s+/i;

  function clean(s) {
    return s.replace(/[|_~`«»•·©®]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normPhone(raw) {
    let p = raw.replace(/[^\d+]/g, '');
    if (p.startsWith('00')) p = '+' + p.slice(2);
    if (/^4393\d{9}$/.test(p)) p = '+' + p.slice(1); // il segno + letto come 4
    return p;
  }

  function prettyPhone(p, raw) {
    // numeri italiani senza prefisso: aggiungo +39 (serve anche per WhatsApp)
    if (!p.startsWith('+') && /^(3\d{8,9}|0\d{5,10})$/.test(p)) p = '+39' + p;
    if (p.startsWith('+39')) {
      const n = p.slice(3);
      if (/^3\d{9}$/.test(n)) return `+39 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
      if (raw) {
        const groups = raw.replace(/^(\+|00)39/, '').trim().split(/[\s().\/-]+/).filter(Boolean);
        if (groups.length > 1 && groups.join('') === n) return '+39 ' + groups.join(' ');
      }
      return '+39 ' + n;
    }
    if (p.startsWith('+971') && /^5\d{8}$/.test(p.slice(4))) { const n = p.slice(4); return `+971 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`; }
    if (raw && p.startsWith('+')) {
      const pretty = raw.replace(/^00/, '+').replace(/[\s().\/-]+/g, ' ').trim();
      if (pretty.replace(/[^\d+]/g, '') === p) return pretty;
    }
    return p;
  }

  // "ROSSI" -> "Rossi", "D'ANGELO" -> "D'Angelo", "DE LUCA" -> "De Luca"
  function cap(w) {
    return String(w).toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }
  const PARTICLES = /^(de|di|da|del|della|dello|dei|degli|delle|dal|dalla|dall'|lo|la|li|le|van|von|der|den|al|el|bin|ben|mc|mac|dos|das|do|du|st\.?|san|santa)$/i;
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 3) return 9;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  // Divide nome e cognome: gestisce "De Luca", "Al Mansouri", "ROSSI Mario" e l'ordine dell'email
  function splitName(full, email) {
    let w = String(full || '').replace(TITLE_PREFIX, '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return { first: '', last: '' };
    if (w.length === 1) return { first: cap(w[0]), last: '' };
    const isUp = (x) => x.length > 1 && x === x.toUpperCase() && /\p{L}/u.test(x);
    const isTitle = (x) => !isUp(x);
    const fix = (arr) => arr.map((x) => (isUp(x) || x === x.toLowerCase() ? cap(x) : x)).join(' ');
    // cognome scritto tutto maiuscolo e nome normale: "ROSSI Mario" / "Mario ROSSI"
    const ups = w.map(isUp);
    if (ups.some(Boolean) && ups.some((u) => !u)) {
      const last = w.filter(isUp), first = w.filter(isTitle);
      return { first: fix(first), last: fix(last) };
    }
    // il cognome inizia dalla prima particella dopo il nome ("Luca De Santis")
    let k = w.length - 1;
    for (let i = 1; i < w.length - 1; i++) if (PARTICLES.test(w[i])) { k = i; break; }
    let first = w.slice(0, k), last = w.slice(k);
    // email del tipo rossi.mario@ o rossim@: l'ordine sul biglietto è cognome nome
    const u = (email || '').split('@')[0].toLowerCase();
    if (u && w.length === 2) {
      const a = w[0].toLowerCase(), b = w[1].toLowerCase();
      const ia = u.indexOf(a), ib = u.indexOf(b);
      if (ia >= 0 && ib >= 0 && ia > ib) { first = [w[1]]; last = [w[0]]; }
    }
    return { first: fix(first), last: fix(last) };
  }

  function parseCard(lines) {
    const out = { name: '', firstName: '', lastName: '', company: '', role: '', phones: [], email: '', website: '', address: '' };
    const rows = lines
      .map((l, i) => ({ text: clean(typeof l === 'string' ? l : l.text || ''), height: (l && l.height) || 0, i }))
      .filter((l) => l.text.length > 1);
    const used = new Set();

    // Email
    for (const r of rows) {
      const et = r.text.replace(/(\w)\s*\.\s+(?=[\w.%+-]*\s?@)/g, '$1.'); // "laura. marino@" -> "laura.marino@"
      let m = et.match(EMAIL_RE);
      if (!m) {
        const m2 = et.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\s(it|com|net|org|eu|io|co|ae|uk|ch|de|fr|es|biz|info)\b/i);
        if (m2) m = [m2[1] + '.' + m2[2]];
      }
      if (m && !out.email) {
        out.email = m[0].replace(/\s/g, '').replace(/[.,;:]+$/, '').toLowerCase();
        used.add(r.i);
      }
    }

    // Telefoni (cell prima)
    const phones = [];
    for (const r of rows) {
      const isFax = /\bfax\b|^f\s*[:.]/i.test(r.text);
      const isMobile = /\b(cell|mobile|mob)\b|^m\s*[:.]/i.test(r.text);
      const textNoMail = r.text.replace(EMAIL_RE, ' ');
      const m = textNoMail.match(PHONE_RE);
      if (!m) continue;
      for (const raw of m) {
        const digits = raw.replace(/\D/g, '');
        if (digits.length < 8 || digits.length > 15) continue;
        if (/^\d{11}$/.test(digits) && /p\.?\s?iva|c\.?f\.?|vat/i.test(r.text)) continue; // partita IVA
        if (/p\.?\s?iva|vat|c\.?f\./i.test(r.text)) continue;
        const n = normPhone(raw);
        const mobileLike = isMobile || /^(\+39)?3\d{8,9}$/.test(n) || /^\+9715\d{8}$/.test(n);
        if (!isFax) phones.push({ n, raw, mobile: mobileLike });
        used.add(r.i);
      }
    }
    phones.sort((a, b) => b.mobile - a.mobile);
    out.phones = [...new Set(phones.map((p) => prettyPhone(p.n, p.raw)))];

    // Sito web
    for (const r of rows) {
      if (out.website) break;
      const t = r.text.replace(EMAIL_RE, ' ');
      const m = t.match(URL_RE);
      if (m) {
        out.website = m[1].toLowerCase();
        used.add(r.i);
      }
    }
    if (out.website && out.email) {
      const ed = out.email.split('@')[1] || '';
      const wd = out.website.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      if (ed !== wd && ed.length > 4 && lev(ed, wd) <= 2) out.email = out.email.split('@')[0] + '@' + wd;
    }
    if (!out.website && out.email) {
      const dom = out.email.split('@')[1];
      if (dom && !/gmail|yahoo|hotmail|outlook|libero|icloud|live|virgilio|tiscali|alice|pec|aruba|fastweb|tim\.it|email\.it|me\.com/i.test(dom)) {
        out.website = 'www.' + dom;
      }
    }

    // Indirizzo
    const addr = [];
    for (const r of rows) {
      if (used.has(r.i)) continue;
      if (ADDRESS_WORDS.test(r.text) || (CAP_RE.test(r.text) && /[A-Za-z]{3,}/.test(r.text))) {
        addr.push(r.text.replace(LABEL_RE, ''));
        used.add(r.i);
      }
    }
    out.address = addr.join(', ');

    const emailUserHas = (txt) => {
      const u = out.email ? out.email.split('@')[0].toLowerCase() : '';
      return !!u && txt.split(' ').some((w) => w.length > 2 && u.includes(w.toLowerCase().replace(/[^a-zà-ÿ]/g, '')));
    };
    // Ruolo
    for (const r of rows) {
      if (used.has(r.i)) continue;
      if (ROLE_WORDS.test(r.text) && !/\d/.test(r.text) && r.text.split(' ').length <= 6 && !TITLE_PREFIX.test(r.text)) {
        out.role = r.text;
        used.add(r.i);
        break;
      }
    }

    // Azienda: la riga che corrisponde al dominio del sito o dell'email (es. "Emirates NBD" -> emiratesnbd.com)
    const domains = [out.website, out.email && !/gmail|yahoo|hotmail|outlook|libero|icloud|live|pec\./i.test(out.email) ? out.email.split('@')[1] : '']
      .filter(Boolean).map((d) => d.replace(/^(https?:\/\/)?(www\.)?/i, '').split('.')[0].toLowerCase());
    const compact = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    const domainLine = (r) => {
      const c = compact(r.text.replace(COMPANY_WORDS, ''));
      return c.length >= 3 && domains.some((d) => d.length >= 3 && (d === c || (c.length >= 4 && d.includes(c)) || (d.length >= 4 && c.includes(d)) || lev(c, d) <= 1));
    };
    for (const r of rows) {
      if (used.has(r.i) || out.company || /@|www|http/i.test(r.text)) continue;
      if (domainLine(r) && !(r.text.split(' ').length === 2 && emailUserHas(r.text))) {
        out.company = r.text;
        used.add(r.i);
      }
    }
    for (const r of rows) {
      if (out.company) break;
      if (used.has(r.i)) continue;
      if (COMPANY_WORDS.test(r.text)) {
        out.company = r.text;
        used.add(r.i);
        break;
      }
    }

    // Nome: righe senza cifre, 2-4 parole, lettere maiuscole iniziali. Preferisci testo grande.
    const emailUser = out.email ? out.email.split('@')[0].toLowerCase() : '';
    let best = null;
    for (const r of rows) {
      if (used.has(r.i)) continue;
      const t = r.text.replace(LABEL_RE, '');
      if (/\d|@|www|http/i.test(t)) continue;
      const bare = t.replace(TITLE_PREFIX, '');
      const words = bare.split(' ').filter(Boolean);
      if (words.length < 2 || words.length > 4) continue;
      if (!words.every((w) => /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*$/.test(w))) continue;
      let score = 10;
      score += r.height ? r.height / 4 : 0;
      if (words.length === 2) score += 3;
      if (TITLE_PREFIX.test(t)) score += 4;
      if (emailUser && words.some((w) => w.length > 2 && emailUser.includes(w.toLowerCase().replace(/[^a-zà-ÿ]/g, '')))) score += 10;
      if (COMPANY_WORDS.test(t) || ROLE_WORDS.test(bare)) score -= 8;
      score -= r.i * 0.3; // il nome di solito sta in alto
      if (!best || score > best.score) best = { r, score, t };
    }
    if (best) {
      const sp = splitName(best.t.replace(TITLE_PREFIX, ''), out.email);
      out.firstName = sp.first;
      out.lastName = sp.last;
      out.name = [sp.first, sp.last].filter(Boolean).join(' ');
      used.add(best.r.i);
      const tm = best.t.match(TITLE_PREFIX);
      if (tm && !out.role) {
        const map = { avv: 'Avvocato', ing: 'Ingegnere', arch: 'Architetto', geom: 'Geometra', rag: 'Ragioniere', prof: 'Professore' };
        const k = tm[1].toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
        if (map[k]) out.role = map[k];
      }
    }

    // Nessun nome sul biglietto leggibile: lo ricavo dall'email (mario.rossi@...)
    if (!out.name && out.email) {
      const u = out.email.split('@')[0];
      const parts = u.split(/[._-]/).filter((x) => /^[a-z]{2,}$/i.test(x));
      if (parts.length === 2 && !/^(info|sales|office|admin|contact|contatti|support|hello|marketing|amministrazione|segreteria|ufficio)$/i.test(parts[0])) {
        out.firstName = cap(parts[0]);
        out.lastName = cap(parts[1]);
        out.name = out.firstName + ' ' + out.lastName;
      }
    }

    // Azienda di riserva: la riga più grande rimasta senza cifre
    if (!out.company) {
      const rest = rows.filter((r) => !used.has(r.i) && !/\d|@/.test(r.text) && r.text.replace(/[^\p{L}]/gu, '').length >= 3 && /^[\p{Lu}\d]/u.test(r.text));
      rest.sort((a, b) => b.height - a.height);
      if (rest[0]) out.company = rest[0].text;
    }
    return out;
  }

  const api = { parseCard, splitName, cap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardParser = api;
})(this);
