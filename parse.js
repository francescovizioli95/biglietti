// Estrae i campi di un biglietto da visita dal testo letto con l'OCR.
// Input: array di righe { text, height } (height = altezza in pixel della riga, se nota).
(function (root) {
  const EMAIL_RE = /[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9.-]+\s?\.\s?[A-Za-z]{2,}/g;
  const URL_RE = /\b((?:https?:\/\/)?(?:www\.)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/\S*)?|[A-Za-z0-9-]+\.(?:it|com|net|org|eu|biz|info|io|co|de|fr|es|ch|uk)\b(?:\/\S*)?)/i;
  const PHONE_RE = /(?:\+|00)?\d[\d\s().\/-]{6,}\d/g;

  const COMPANY_WORDS = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|ltd|inc|gmbh|llc|group|gruppo|studio|società|societa|company|azienda|consulting|srl|spa|onlus|coop|cooperativa|associati|holding|solutions|systems|services|servizi|italia|italy|agency|agenzia)\b/i;
  const ROLE_WORDS = /\b(advisor|adviser|trader|broker|analyst|analista|investor|investitore|private banker|banker|wealth|portfolio|gestore|promotore|ceo|cto|cfo|coo|founder|co-founder|fondatore|titolare|amministratore|direttore|direttrice|director|manager|responsabile|presidente|president|socio|partner|consulente|consultant|ingegnere|engineer|architetto|architect|avvocato|avv\.?|dott\.?|dottore|dottoressa|dr\.?|geom\.?|rag\.?|ing\.?|arch\.?|commerciale|sales|account|marketing|developer|sviluppatore|designer|agente|tecnico|specialist|head|officer|assistant|segretari[ao]|impiegat[ao]|notaio|commercialista|medico|odontoiatra|fisioterapista)\b/i;
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
    return p;
  }

  function prettyPhone(p) {
    // numeri italiani senza prefisso: aggiungo +39 (serve anche per WhatsApp)
    if (!p.startsWith('+') && /^(3\d{8,9}|0\d{5,10})$/.test(p)) p = '+39' + p;
    if (p.startsWith('+39')) {
      const n = p.slice(3);
      if (/^3\d{9}$/.test(n)) return `+39 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
      return '+39 ' + n;
    }
    return p;
  }

  function parseCard(lines) {
    const out = { name: '', company: '', role: '', phones: [], email: '', website: '', address: '' };
    const rows = lines
      .map((l, i) => ({ text: clean(typeof l === 'string' ? l : l.text || ''), height: (l && l.height) || 0, i }))
      .filter((l) => l.text.length > 1);
    const used = new Set();

    // Email
    for (const r of rows) {
      const m = r.text.match(EMAIL_RE);
      if (m && !out.email) {
        out.email = m[0].replace(/\s/g, '').toLowerCase();
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
        const mobileLike = isMobile || /^(\+39)?3\d{8,9}$/.test(n);
        if (!isFax) phones.push({ n, mobile: mobileLike });
        used.add(r.i);
      }
    }
    phones.sort((a, b) => b.mobile - a.mobile);
    out.phones = [...new Set(phones.map((p) => prettyPhone(p.n)))];

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

    // Ruolo
    for (const r of rows) {
      if (used.has(r.i)) continue;
      if (ROLE_WORDS.test(r.text) && !/\d/.test(r.text) && r.text.split(' ').length <= 6 && !TITLE_PREFIX.test(r.text)) {
        out.role = r.text;
        used.add(r.i);
        break;
      }
    }

    // Azienda
    for (const r of rows) {
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
      out.name = best.t.replace(TITLE_PREFIX, '').split(' ').map((w) => (w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
      used.add(best.r.i);
      const tm = best.t.match(TITLE_PREFIX);
      if (tm && !out.role) {
        const map = { avv: 'Avvocato', ing: 'Ingegnere', arch: 'Architetto', geom: 'Geometra', rag: 'Ragioniere', prof: 'Professore' };
        const k = tm[1].toLowerCase().replace(/[^a-z]/g, '').slice(0, 4);
        if (map[k]) out.role = map[k];
      }
    }

    // Azienda di riserva: la riga più grande rimasta senza cifre
    if (!out.company) {
      const rest = rows.filter((r) => !used.has(r.i) && !/\d|@/.test(r.text) && r.text.length >= 3);
      rest.sort((a, b) => b.height - a.height);
      if (rest[0]) out.company = rest[0].text;
    }
    return out;
  }

  const api = { parseCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardParser = api;
})(this);
