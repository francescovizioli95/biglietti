/* Biglietti — rubrica di biglietti da visita + il tuo biglietto con QR.
   Tutto gira sul telefono: nessun server, nessun costo. */
'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const abs = (p) => new URL(p, location.href).href;
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const state = {
  view: 'list',
  tab: 'list',
  current: null,
  draft: null,
  cards: [],
  filter: 'all', // all | review | event:<nome>
  sort: 'recent',
};

/* =================== Utilità =================== */
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const digits = (s) => String(s || '').replace(/\D/g, '');
function initials(s) {
  const w = String(s || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function scaledCanvas(src, max) {
  const w = src.naturalWidth || src.videoWidth || src.width;
  const h = src.naturalHeight || src.videoHeight || src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
// Per l'OCR: scala di grigi + contrasto automatico → lettura più precisa
function ocrCanvas(src) {
  const c = scaledCanvas(src, 2200);
  const ctx = c.getContext('2d');
  const im = ctx.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = g;
    hist[g | 0]++;
  }
  const total = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < total * 0.01) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]) < total * 0.01) hi--;
  const range = Math.max(30, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return c.toDataURL('image/jpeg', 0.92);
}
function imagesFrom(src) {
  return { store: scaledCanvas(src, 1400).toDataURL('image/jpeg', 0.82), ocr: ocrCanvas(src) };
}
async function imagesFromFile(file) {
  return imagesFrom(await loadImage(await fileToDataURL(file)));
}
function vibrate(ms) {
  try { navigator.vibrate && navigator.vibrate(ms); } catch {}
}

/* =================== OCR (Tesseract.js, sul telefono) =================== */
let workerP = null;
let ocrProgress = null;
function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      if (!window.Tesseract) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'vendor/tesseract/tesseract.min.js';
          s.onload = res;
          s.onerror = () => rej(new Error('Lettore di testo non disponibile'));
          document.head.appendChild(s);
        });
      }
      const w = await Tesseract.createWorker(['ita', 'eng'], 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core'),
        langPath: abs('vendor/tesseract/lang'),
        logger: (m) => ocrProgress && ocrProgress(m),
      });
      await w.setParameters({ preserve_interword_spaces: '1' });
      return w;
    })().catch((e) => {
      workerP = null;
      throw e;
    });
  }
  return workerP;
}
let ocrChain = Promise.resolve();
function runOcr(dataUrl, onProgress) {
  // una lettura alla volta
  const job = ocrChain.then(async () => {
    ocrProgress = onProgress || null;
    const worker = await getWorker();
    const { data } = await worker.recognize(dataUrl);
    ocrProgress = null;
    const lines = (data.lines || [])
      .filter((l) => l.confidence > 30 && l.text.trim().length > 1)
      .map((l) => ({ text: l.text.replace(/[|_~`«»•·]+/g, ' ').replace(/\s+/g, ' ').trim(), height: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0 }));
    const hs = lines.map((l) => l.height).filter(Boolean).sort((a, b) => a - b);
    const med = hs[Math.floor(hs.length / 2)] || 1;
    lines.forEach((l) => (l.height = Math.round((l.height / med) * 20)));
    return { lines, text: lines.map((l) => l.text).join('\n') };
  });
  ocrChain = job.catch(() => {});
  return job;
}
function fieldsFromOcr(lines) {
  const f = CardParser.parseCard(lines);
  return {
    name: f.name, company: f.company, role: f.role, email: f.email,
    website: f.website, address: f.address, phone: f.phones[0] || '', phone2: f.phones[1] || '',
  };
}

/* =================== Coda di lettura (scansione rapida) =================== */
let queueRunning = false;
async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (;;) {
      const all = await DB.all();
      const next = all.filter((c) => c.status === 'pending').sort((a, b) => a.created - b.created)[0];
      updateQueueBar(all);
      if (!next) break;
      try {
        const { lines, text } = await runOcr(next.ocrSrc || next.image, (m) => {
          if (m.status === 'recognizing text') updateQueueBar(null, Math.round(m.progress * 100));
          if (state.view === 'edit' && state.draft && state.draft.id === next.id) showOcrProgress(m);
        });
        const f = fieldsFromOcr(lines);
        const fresh = (await DB.get(next.id)) || next;
        if (fresh.status !== 'pending') continue; // modificato a mano nel frattempo
        Object.assign(fresh, {
          name: fresh.name || f.name, company: fresh.company || f.company, role: fresh.role || f.role,
          email: fresh.email || f.email, website: fresh.website || f.website, address: fresh.address || f.address,
          phones: fresh.phones && fresh.phones.length ? fresh.phones : [f.phone, f.phone2].filter(Boolean),
          ocrLines: lines, rawText: text, status: 'review',
        });
        delete fresh.ocrSrc;
        await DB.put(fresh);
        if (state.view === 'edit' && state.draft && state.draft.id === fresh.id) applyOcrToForm(f, lines, false);
      } catch (e) {
        console.error(e);
        const fresh = await DB.get(next.id);
        if (fresh) {
          fresh.status = 'review';
          delete fresh.ocrSrc;
          await DB.put(fresh);
        }
        toast('Non sono riuscito a leggere un biglietto: aprilo e scrivi a mano', 4000);
      }
      await refresh();
    }
  } finally {
    queueRunning = false;
    updateQueueBar(await DB.all());
  }
}
function updateQueueBar(all, pct) {
  const bar = $('#queueBar');
  if (all) updateQueueBar._n = all.filter((c) => c.status === 'pending').length;
  const n = updateQueueBar._n || 0;
  if (!n) return bar.classList.add('hidden');
  bar.classList.remove('hidden');
  bar.innerHTML = `<div class="spinner small"></div><span>Sto leggendo ${n === 1 ? '1 biglietto' : n + ' biglietti'}${pct != null ? ' · ' + pct + '%' : ''}</span>`;
}
async function enqueue(imgs, extra = {}) {
  const card = {
    id: uid(), created: Date.now(), updated: Date.now(), status: 'pending',
    image: imgs.store, ocrSrc: imgs.ocr, phones: [], event: extra.event || '', ...extra,
  };
  await DB.put(card);
  processQueue();
  return card;
}

/* =================== Navigazione =================== */
const TITLES = { list: 'Biglietti', me: 'Il mio biglietto' };
function show(view, title) {
  state.view = view;
  for (const v of ['list', 'edit', 'detail', 'me']) $('#' + v + 'View').classList.toggle('hidden', v !== view);
  const top = view === 'list' || view === 'me';
  $('#tabbar').classList.toggle('hidden', !top);
  $('#backBtn').classList.toggle('hidden', top);
  $('#menuBtn').classList.toggle('hidden', view !== 'list');
  $('#qrQuickBtn').classList.toggle('hidden', !top);
  $('#title').textContent = title || TITLES[view] || 'Biglietti';
  $('#menu').classList.add('hidden');
  $$('#tabbar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === view));
  if (view === 'list') renderList();
  window.scrollTo(0, 0);
}
function go(view, title) {
  history.pushState({ view }, '');
  show(view, title);
}
const overlays = ['#camView', '#qrView', '#pickSheet', '#assignSheet'];
window.addEventListener('popstate', () => {
  for (const o of overlays) {
    if (!$(o).classList.contains('hidden')) {
      closeOverlay(o);
      return;
    }
  }
  if (state.view !== 'list' && state.view !== 'me') show(state.tab);
  else if (state.view === 'me') { state.tab = 'list'; show('list'); }
});
function openOverlay(sel) {
  history.pushState({ overlay: sel }, '');
  $(sel).classList.remove('hidden');
}
function closeOverlay(sel) {
  $(sel).classList.add('hidden');
  if (sel === '#camView') stopCam();
  if (sel === '#qrView') releaseWake();
}
function backFromOverlay(sel) {
  if (!$(sel).classList.contains('hidden')) history.back();
}
$('#backBtn').onclick = () => history.back();
$$('#tabbar [data-tab]').forEach((b) =>
  (b.onclick = () => {
    const t = b.dataset.tab;
    if (t === state.view) return;
    if (t === 'me') {
      state.tab = 'me';
      history.pushState({ view: 'me' }, '');
      show('me');
      renderMe();
    } else history.back();
  })
);

/* =================== Rubrica =================== */
async function refresh() {
  state.cards = await DB.all();
  if (state.view === 'list') renderList();
  renderEventList();
}
function renderEventList() {
  const evs = [...new Set(state.cards.map((c) => c.event).filter(Boolean))];
  $('#eventList').innerHTML = evs.map((e) => `<option value="${esc(e)}">`).join('');
  return evs;
}
function sortCards(arr) {
  if (state.sort === 'az') return arr.sort((a, b) => (a.name || a.company || '~').localeCompare(b.name || b.company || '~', 'it'));
  return arr.sort((a, b) => b.created - a.created);
}
function renderChips() {
  const evs = renderEventList();
  const nReview = state.cards.filter((c) => c.status === 'review' || c.status === 'pending').length;
  const chips = [
    ['all', 'Tutti (' + state.cards.length + ')'],
    nReview ? ['review', 'Da controllare (' + nReview + ')'] : null,
    ...evs.map((e) => ['event:' + e, e]),
  ].filter(Boolean);
  if (state.filter !== 'all' && !chips.some((c) => c[0] === state.filter)) state.filter = 'all';
  $('#chips').innerHTML =
    chips.map(([k, l]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-k="${esc(k)}">${esc(l)}</button>`).join('') +
    `<button class="chip sort" data-sort="1">${state.sort === 'az' ? 'A-Z' : 'Recenti'} ⇅</button>`;
  $('#chips').classList.toggle('hidden', state.cards.length === 0);
}
$('#chips').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sort) state.sort = state.sort === 'az' ? 'recent' : 'az';
  else state.filter = b.dataset.k;
  renderList();
};
function renderList() {
  renderChips();
  const q = $('#search').value.trim().toLowerCase();
  const qd = digits(q);
  let items = state.cards.filter((c) => {
    if (state.filter === 'review' && !(c.status === 'review' || c.status === 'pending')) return false;
    if (state.filter.startsWith('event:') && c.event !== state.filter.slice(6)) return false;
    if (!q) return true;
    const hay = [c.name, c.company, c.role, c.email, c.notes, c.address, c.event, c.website, c.rawText].join(' ').toLowerCase();
    return hay.includes(q) || (qd.length >= 3 && (c.phones || []).some((p) => digits(p).includes(qd)));
  });
  items = sortCards(items);
  $('#list').innerHTML = items
    .map((c) => {
      const title = c.name || c.company || (c.status === 'pending' ? 'Lettura in corso...' : 'Senza nome');
      const sub = [c.role, c.name ? c.company : ''].filter(Boolean).join(' · ');
      const badge =
        c.status === 'pending' ? '<span class="badge wait">in lettura</span>' :
        c.status === 'review' ? '<span class="badge rev">da controllare</span>' : '';
      return `<li data-id="${c.id}">
        <div class="thumb">${c.image ? `<img src="${c.image}" alt="" loading="lazy">` : `<span>${esc(initials(title))}</span>`}</div>
        <div class="info">
          <div class="n">${esc(title)} ${badge}</div>
          ${sub ? `<div class="s">${esc(sub)}</div>` : ''}
          <div class="s m">${esc((c.phones || [])[0] || c.email || c.event || '')}</div>
        </div>
      </li>`;
    })
    .join('');
  $('#empty').classList.toggle('hidden', state.cards.length > 0);
}
$('#search').addEventListener('input', renderList);
$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const c = state.cards.find((x) => x.id === li.dataset.id);
  if (c && (c.status === 'pending' || c.status === 'review')) startEdit(c, 'Controlla i dati');
  else openDetail(li.dataset.id);
});

/* =================== Aggiungi =================== */
$('#fab').onclick = () => openOverlay('#pickSheet');
$('#pickSheet').onclick = (e) => {
  if (e.target.id === 'pickSheet') history.back();
};
$('#pickScan').onclick = () => {
  if ($('#pickSheet').classList.contains('hidden')) history.pushState({ overlay: '#camView' }, '');
  else history.replaceState({ overlay: '#camView' }, '');
  $('#pickSheet').classList.add('hidden');
  $('#camView').classList.remove('hidden');
  startCam();
};
$('#pickGallery').onclick = () => {
  history.back();
  $('#galleryInput').click();
};
$('#pickManual').onclick = () => {
  history.back();
  setTimeout(() => startEdit({ id: uid(), created: Date.now(), phones: [], event: localStorage.lastEvent || '' }, 'Nuovo biglietto'), 30);
};
$('#galleryInput').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  toast(files.length > 1 ? `Aggiungo ${files.length} biglietti...` : 'Preparo la foto...');
  let last;
  for (const f of files) last = await enqueue(await imagesFromFile(f), { event: '' });
  await refresh();
  if (files.length === 1) startEdit(last, 'Controlla i dati');
  else toast(`${files.length} biglietti in lettura. Li trovi in "Da controllare".`, 3500);
};

/* =================== Fotocamera live (scansione rapida) =================== */
let camStream = null;
let camShots = 0;
let lastShotId = null;
let torchOn = false;
let frameVertical = false;
async function startCam() {
  camShots = 0;
  lastShotId = null;
  $('#camCount').textContent = '0';
  $('#camThumb').innerHTML = '';
  $('#camEvent').value = localStorage.lastEvent || '';
  $('#camHint').textContent = 'Inquadra il biglietto nel riquadro';
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
  } catch (e) {
    console.warn(e);
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
    } catch (e2) {
      backFromOverlay('#camView');
      toast('Fotocamera non disponibile: uso quella del telefono');
      $('#cameraInput').click();
      return;
    }
  }
  const v = $('#camVideo');
  v.srcObject = camStream;
  await v.play().catch(() => {});
  const track = camStream.getVideoTracks()[0];
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    $('#camTorch').classList.toggle('hidden', !caps.torch);
    if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  } catch {}
}
function stopCam() {
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null;
  torchOn = false;
  $('#camVideo').srcObject = null;
}
$('#camTorch').onclick = async () => {
  const track = camStream && camStream.getVideoTracks()[0];
  if (!track) return;
  torchOn = !torchOn;
  track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
  $('#camTorch').classList.toggle('on', torchOn);
};
$('#camFrame').onclick = () => {
  frameVertical = !frameVertical;
  $('#camFrame').classList.toggle('vertical', frameVertical);
};
$('#camEvent').onchange = () => (localStorage.lastEvent = $('#camEvent').value.trim());
$('#camShot').onclick = async () => {
  const v = $('#camVideo');
  if (!v.videoWidth) return;
  // ritaglia l'area del riquadro (con un po' di margine) dal video a piena risoluzione
  const vr = v.getBoundingClientRect();
  const fr = $('#camFrame').getBoundingClientRect();
  const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
  const offX = (vr.width - v.videoWidth * scale) / 2;
  const offY = (vr.height - v.videoHeight * scale) / 2;
  const m = 0.07;
  let sx = (fr.left - vr.left - offX - fr.width * m) / scale;
  let sy = (fr.top - vr.top - offY - fr.height * m) / scale;
  let sw = (fr.width * (1 + 2 * m)) / scale;
  let sh = (fr.height * (1 + 2 * m)) / scale;
  sx = Math.max(0, sx); sy = Math.max(0, sy);
  sw = Math.min(v.videoWidth - sx, sw); sh = Math.min(v.videoHeight - sy, sh);
  const c = document.createElement('canvas');
  c.width = Math.round(sw);
  c.height = Math.round(sh);
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  vibrate(25);
  const fl = $('#camFlash');
  fl.classList.remove('go');
  void fl.offsetWidth;
  fl.classList.add('go');
  const ev = $('#camEvent').value.trim();
  localStorage.lastEvent = ev;
  const imgs = imagesFrom(c);
  $('#camThumb').innerHTML = `<img src="${imgs.store}" alt="">`;
  camShots++;
  $('#camCount').textContent = camShots;
  $('#camHint').textContent = camShots === 1 ? 'Ottimo! Passa al prossimo, lo leggo io' : `${camShots} biglietti salvati`;
  const card = await enqueue(imgs, { event: ev });
  lastShotId = card.id;
};
$('#camClose').onclick = async () => {
  const shots = camShots;
  const id = lastShotId;
  history.back();
  await refresh();
  if (shots === 1 && id) {
    const c = await DB.get(id);
    setTimeout(() => startEdit(c, 'Controlla i dati'), 60);
  } else if (shots > 1) {
    state.filter = 'review';
    renderList();
    toast(`${shots} biglietti salvati. Li sto leggendo, poi controllali qui.`, 3500);
  }
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && camStream) stopCam();
  else if (!document.hidden && !$('#camView').classList.contains('hidden') && !camStream) startCam();
});
// Ripiego: fotocamera di sistema
$('#cameraInput').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const imgs = await imagesFromFile(file);
  if (photoTarget === 'front' && state.view === 'edit') {
    state.draft.image = imgs.store;
    $('#editImg').src = imgs.store;
    ocrInEdit(imgs.ocr, true);
  } else if (photoTarget === 'back' && state.view === 'edit') {
    state.draft.backImage = imgs.store;
    $('#editBackImg').src = imgs.store;
    $('#editBackImg').classList.remove('hidden');
    ocrInEdit(imgs.ocr, false);
  } else {
    const card = await enqueue(imgs, { event: localStorage.lastEvent || '' });
    await refresh();
    startEdit(card, 'Controlla i dati');
  }
  photoTarget = null;
};

/* =================== Modifica =================== */
let photoTarget = null;
const FIELDS = ['name', 'company', 'role', 'email', 'website', 'address', 'event', 'notes'];
function startEdit(card, title) {
  state.draft = { ...card };
  const form = $('#form');
  form.reset();
  for (const k of FIELDS) form[k].value = card[k] || '';
  form.phone.value = (card.phones || [])[0] || '';
  form.phone2.value = (card.phones || [])[1] || '';
  $('#editImg').src = card.image || '';
  $('.photo-box').classList.toggle('hidden', !card.image);
  $('#editBackImg').src = card.backImage || '';
  $('#editBackImg').classList.toggle('hidden', !card.backImage);
  $('#rereadBtn').classList.toggle('hidden', !card.image);
  $('#backPhotoBtn').classList.toggle('hidden', !card.image);
  $('#retakeBtn').textContent = card.image ? 'Rifai foto' : 'Aggiungi foto';
  renderLines(card.ocrLines || []);
  $('#ocrStatus').classList.toggle('hidden', card.status !== 'pending');
  if (card.status === 'pending') setOcrText('In coda per la lettura...');
  checkDup();
  go('edit', title);
}
function setOcrText(t) {
  $('#ocrText').textContent = t;
}
function showOcrProgress(m) {
  $('#ocrStatus').classList.remove('hidden');
  if (m.status === 'recognizing text') setOcrText('Leggo il biglietto... ' + Math.round(m.progress * 100) + '%');
  else if (/load|initializ/.test(m.status)) setOcrText('Preparo il lettore...');
}
function applyOcrToForm(f, lines, overwrite) {
  const form = $('#form');
  for (const k of ['name', 'company', 'role', 'phone', 'phone2', 'email', 'website', 'address']) {
    if (f[k] && (overwrite || !form[k].value)) form[k].value = f[k];
  }
  const prev = overwrite ? [] : state.draft.ocrLines || [];
  state.draft.ocrLines = prev.concat(lines);
  state.draft.rawText = state.draft.ocrLines.map((l) => l.text).join('\n');
  renderLines(state.draft.ocrLines);
  $('#ocrStatus').classList.add('hidden');
  checkDup();
  const found = f.name || f.phone || f.email;
  toast(found ? 'Letto! Controlla e salva.' : 'Ho letto poco: tocca le righe qui sotto o scrivi a mano.', 3200);
}
async function ocrInEdit(src, overwrite) {
  $('#ocrStatus').classList.remove('hidden');
  setOcrText('Leggo il biglietto...');
  try {
    const { lines } = await runOcr(src, showOcrProgress);
    applyOcrToForm(fieldsFromOcr(lines), lines, overwrite);
  } catch (e) {
    console.error(e);
    $('#ocrStatus').classList.add('hidden');
    toast('Errore nella lettura: ' + (e.message || e), 4000);
  }
}
function renderLines(lines) {
  $('#linesBox').classList.toggle('hidden', !lines.length);
  $('#lines').innerHTML = lines.map((l, i) => `<button type="button" class="line" data-i="${i}">${esc(l.text)}</button>`).join('');
}
let assignIdx = null;
$('#lines').onclick = (e) => {
  const b = e.target.closest('.line');
  if (!b) return;
  assignIdx = +b.dataset.i;
  $('#assignText').textContent = state.draft.ocrLines[assignIdx].text;
  openOverlay('#assignSheet');
};
$('#assignSheet').onclick = (e) => {
  if (e.target.id === 'assignSheet') return history.back();
  const b = e.target.closest('[data-f]');
  if (!b) return;
  const form = $('#form');
  let t = state.draft.ocrLines[assignIdx].text;
  const f = b.dataset.f;
  if (f === 'phone' || f === 'phone2') {
    const m = t.match(/(?:\+|00)?\d[\d\s().\/-]{5,}\d/);
    if (m) t = m[0].replace(/[^\d+]/g, '').replace(/^00/, '+');
  } else if (f === 'email') {
    const m = t.replace(/\s/g, '').match(/[^\s:]+@[^\s]+/);
    if (m) t = m[0].toLowerCase();
  } else {
    t = t.replace(/^(tel|cell|mobile|e-?mail|mail|web|sito|fax)\s*[:.]\s*/i, '');
  }
  if (f === 'notes') form.notes.value = (form.notes.value ? form.notes.value + '\n' : '') + t;
  else form[f].value = t;
  form[f].classList.add('flash');
  setTimeout(() => form[f].classList.remove('flash'), 600);
  checkDup();
  history.back();
};
$('#retakeBtn').onclick = () => {
  photoTarget = 'front';
  $('#cameraInput').click();
};
$('#backPhotoBtn').onclick = () => {
  photoTarget = 'back';
  $('#cameraInput').click();
};
$('#rereadBtn').onclick = async () => {
  if (!state.draft.image) return;
  const img = await loadImage(state.draft.image);
  ocrInEdit(ocrCanvas(img), true);
};
$('#cancelBtn').onclick = () => history.back();
['phone', 'phone2', 'email', 'name'].forEach((n) => $('#form')[n].addEventListener('change', checkDup));
function findDup(card) {
  const ph = (card.phones || []).map(digits).filter((d) => d.length >= 8).map((d) => d.slice(-9));
  const em = (card.email || '').toLowerCase();
  const nm = (card.name || '').toLowerCase().trim();
  return state.cards.find(
    (c) =>
      c.id !== card.id &&
      c.status !== 'pending' &&
      ((em && (c.email || '').toLowerCase() === em) ||
        (ph.length && (c.phones || []).some((p) => ph.includes(digits(p).slice(-9)))) ||
        (nm.length > 4 && (c.name || '').toLowerCase().trim() === nm))
  );
}
function checkDup() {
  const f = $('#form');
  const d = findDup({ id: state.draft && state.draft.id, name: f.name.value, email: f.email.value, phones: [f.phone.value, f.phone2.value] });
  const w = $('#dupWarn');
  w.classList.toggle('hidden', !d);
  if (d) w.innerHTML = `Forse ce l'hai già: <b>${esc(d.name || d.company)}</b>${d.event ? ' (' + esc(d.event) + ')' : ''}`;
}
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const d = state.draft;
  for (const k of FIELDS) d[k] = f[k].value.trim();
  d.phones = [f.phone.value.trim(), f.phone2.value.trim()].filter(Boolean);
  if (!d.name && !d.company && !d.phones.length && !d.email && !d.image) return toast('Inserisci almeno un dato');
  if (d.event) localStorage.lastEvent = d.event;
  d.status = 'ok';
  delete d.ocrSrc;
  d.updated = Date.now();
  d.created = d.created || Date.now();
  await DB.put(d);
  await refresh();
  toast('Salvato');
  // se ci sono altri da controllare, passa al prossimo
  const next = sortCards(state.cards.filter((c) => c.status === 'review' && c.id !== d.id))[0];
  history.back();
  if (next && state.filter === 'review') setTimeout(() => startEdit(next, 'Controlla i dati'), 80);
};

/* =================== Dettaglio =================== */
async function openDetail(id) {
  const c = await DB.get(id);
  if (!c) return;
  state.current = c;
  renderDetail(c);
  go('detail', c.name || c.company || 'Biglietto');
}
const ICONS = {
  call: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/></svg>',
  wa: '<svg viewBox="0 0 24 24"><path d="M4 20l1.3-4A8 8 0 1112 20a8 8 0 01-4-1z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
};
function waNumber(p) {
  let n = String(p).replace(/[^\d+]/g, '');
  if (n.startsWith('+')) return n.slice(1);
  if (n.startsWith('00')) return n.slice(2);
  return '39' + n; // numero italiano senza prefisso
}
const linkify = (u) => (/^https?:/i.test(u) ? u : 'https://' + u);
function renderDetail(c) {
  $('#detImg').src = c.image || '';
  $('#detImg').classList.toggle('hidden', !c.image);
  $('#detBackImg').src = c.backImage || '';
  $('#detBackImg').classList.toggle('hidden', !c.backImage);
  $('#detAvatar').textContent = initials(c.name || c.company);
  $('#detName').textContent = c.name || c.company || 'Senza nome';
  $('#detSub').textContent = [c.role, c.name ? c.company : ''].filter(Boolean).join(' · ');
  const p = (c.phones || [])[0];
  $('#detActions').innerHTML = [
    p && `<a href="tel:${esc(p.replace(/[^\d+]/g, ''))}">${ICONS.call}<span>Chiama</span></a>`,
    p && `<a href="https://wa.me/${waNumber(p)}" target="_blank" rel="noopener">${ICONS.wa}<span>WhatsApp</span></a>`,
    c.email && `<a href="mailto:${esc(c.email)}">${ICONS.mail}<span>Email</span></a>`,
    c.website && `<a href="${esc(linkify(c.website))}" target="_blank" rel="noopener">${ICONS.web}<span>Sito</span></a>`,
    c.address && `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${ICONS.map}<span>Mappa</span></a>`,
  ].filter(Boolean).join('');
  const rows = [
    ['Telefono', (c.phones || []).map((x) => `<a href="tel:${esc(x.replace(/[^\d+]/g, ''))}">${esc(x)}</a>`).join('<br>')],
    ['Email', c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`],
    ['Sito', c.website && `<a href="${esc(linkify(c.website))}" target="_blank" rel="noopener">${esc(c.website)}</a>`],
    ['Indirizzo', esc(c.address)],
    ['Evento', esc(c.event)],
    ['Note', esc(c.notes).replace(/\n/g, '<br>')],
    ['Aggiunto il', new Date(c.created || Date.now()).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })],
  ].filter((r) => r[1]);
  $('#detFields').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}
$('#detImg').onclick = () => $('#detImg').classList.toggle('zoom');
$('#detBackImg').onclick = () => $('#detBackImg').classList.toggle('zoom');
$('#editBtn').onclick = () => {
  const c = state.current;
  history.back();
  setTimeout(() => startEdit(c, 'Modifica'), 60);
};
$('#deleteBtn').onclick = async () => {
  if (!confirm('Eliminare questo biglietto?')) return;
  await DB.del(state.current.id);
  await refresh();
  toast('Eliminato');
  history.back();
};
$('#toContactsBtn').onclick = () => shareFiles([vcfFile([state.current], (state.current.name || 'contatto') + '.vcf')], 'Aprilo per salvarlo nei Contatti');

/* =================== vCard =================== */
const vEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
function splitName(full) {
  const p = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (p.length < 2) return [p[0] || '', ''];
  return [p.slice(0, -1).join(' '), p[p.length - 1]];
}
function toVCard(c) {
  const [first, last] = splitName(c.name);
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(last)};${vEsc(first)};;;`, `FN:${vEsc(c.name || c.company || 'Contatto')}`];
  if (c.company) L.push(`ORG:${vEsc(c.company)}`);
  if (c.role) L.push(`TITLE:${vEsc(c.role)}`);
  (c.phones || []).forEach((p, i) => L.push(`TEL;TYPE=${i === 0 ? 'CELL' : 'WORK'}:${p.replace(/[^\d+]/g, '')}`));
  if (c.email) L.push(`EMAIL;TYPE=INTERNET:${c.email}`);
  if (c.website) L.push(`URL:${vEsc(c.website)}`);
  if (c.address) L.push(`ADR;TYPE=WORK:;;${vEsc(c.address)};;;;`);
  const note = [c.event && 'Conosciuto a: ' + c.event, c.notes].filter(Boolean).join('\n');
  if (note) L.push(`NOTE:${vEsc(note)}`);
  if (c.image && c.image.startsWith('data:image/jpeg;base64,')) L.push('PHOTO;ENCODING=b;TYPE=JPEG:' + c.image.split(',')[1]);
  L.push('END:VCARD');
  return L.join('\r\n');
}
function vcfFile(cards, name) {
  return new File([cards.map(toVCard).join('\r\n') + '\r\n'], name.replace(/[\\/:*?"<>|]/g, '_'), { type: 'text/vcard' });
}
async function shareFiles(files, hint, text) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  files.forEach((f) => download(f));
  if (hint) toast('File scaricato. ' + hint, 4000);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name || blob.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* =================== Menu =================== */
$('#menuBtn').onclick = (e) => {
  e.stopPropagation();
  $('#menu').classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menu') && !e.target.closest('#menuBtn')) $('#menu').classList.add('hidden');
});
$('#menu').onclick = async (e) => {
  const a = e.target.dataset.action;
  $('#menu').classList.add('hidden');
  const cards = (await DB.all()).filter((c) => c.status !== 'pending');
  const visible = state.filter.startsWith('event:') ? cards.filter((c) => c.event === state.filter.slice(6)) : cards;
  const tag = state.filter.startsWith('event:') ? '-' + state.filter.slice(6).replace(/\W+/g, '_') : '';
  const today = new Date().toISOString().slice(0, 10);
  if (a === 'backup') {
    const blob = new Blob([JSON.stringify({ app: 'biglietti', version: 1, date: new Date().toISOString(), cards: await DB.all(), me: getMe(), meTpl: localStorage.meTpl })], { type: 'application/json' });
    download(blob, `biglietti-backup-${today}.json`);
    toast('Backup salvato nei Download. Conservalo su Drive!', 3500);
  } else if (a === 'restore') {
    $('#restoreInput').click();
  } else if (a === 'exportAll') {
    if (!visible.length) return toast('Nessun biglietto');
    shareFiles([vcfFile(visible, `biglietti${tag}.vcf`)], 'Aprilo per importarli nei Contatti');
  } else if (a === 'exportCsv') {
    if (!visible.length) return toast('Nessun biglietto');
    const cols = [['Nome', 'name'], ['Azienda', 'company'], ['Ruolo', 'role'], ['Telefono', (c) => (c.phones || [])[0]], ['Altro telefono', (c) => (c.phones || [])[1]], ['Email', 'email'], ['Sito', 'website'], ['Indirizzo', 'address'], ['Evento', 'event'], ['Note', 'notes'], ['Data', (c) => new Date(c.created).toLocaleDateString('it-IT')]];
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [cols.map((c) => q(c[0])).join(';'), ...visible.map((c) => cols.map(([, k]) => q(typeof k === 'function' ? k(c) : c[k])).join(';'))];
    shareFiles([new File(['\ufeff' + rows.join('\r\n')], `biglietti${tag}-${today}.csv`, { type: 'text/csv' })], 'Aprilo con Excel o Fogli Google');
  }
};
$('#restoreInput').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const cards = Array.isArray(data) ? data : data.cards;
    if (!Array.isArray(cards)) throw new Error();
    for (const c of cards) if (c && c.id) await DB.put(c);
    if (data.me && !localStorage.me) localStorage.me = JSON.stringify(data.me);
    if (data.meTpl && !localStorage.meTpl) localStorage.meTpl = data.meTpl;
    await refresh();
    toast(`Ripristinati ${cards.length} biglietti`);
  } catch {
    toast('File di backup non valido');
  }
};

/* =================== Il mio biglietto =================== */
const TEMPLATES = {
  navy:    { name: 'Blu notte',   bg: ['#0f1b2d', '#1f3a5f'], text: '#ffffff', sub: '#c9d4e3', accent: '#d4af37' },
  black:   { name: 'Nero e oro',  bg: ['#0b0b0c', '#26231d'], text: '#f5e6c4', sub: '#bfb59e', accent: '#c9a54a' },
  white:   { name: 'Bianco',      bg: ['#ffffff', '#f2f4f7'], text: '#111827', sub: '#4b5563', accent: '#1f6feb' },
  emerald: { name: 'Smeraldo',    bg: ['#063b2f', '#0d6b55'], text: '#ffffff', sub: '#cde7df', accent: '#f2c46d' },
  wine:    { name: 'Bordeaux',    bg: ['#3d0b16', '#6e1a2c'], text: '#ffffff', sub: '#ecd2d8', accent: '#e7c27d' },
  graphite:{ name: 'Grafite',     bg: ['#1c1f24', '#3a3f47'], text: '#ffffff', sub: '#cfd3da', accent: '#4fd1c5' },
};
function getMe() {
  try { return JSON.parse(localStorage.me || 'null'); } catch { return null; }
}
const meFullName = (me) => [me.firstName, me.lastName].filter(Boolean).join(' ');
function meVCard(me) {
  const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(me.lastName)};${vEsc(me.firstName)};;;`, `FN:${vEsc(meFullName(me))}`];
  if (me.company) L.push(`ORG:${vEsc(me.company)}`);
  if (me.role) L.push(`TITLE:${vEsc(me.role)}`);
  if (me.mobile) L.push(`TEL;TYPE=CELL:${me.mobile.replace(/[^\d+]/g, '')}`);
  if (me.phone) L.push(`TEL;TYPE=WORK:${me.phone.replace(/[^\d+]/g, '')}`);
  if (me.email) L.push(`EMAIL;TYPE=INTERNET:${me.email}`);
  if (me.website) L.push(`URL:${linkify(me.website)}`);
  if (me.linkedin) L.push(`URL:${linkify(me.linkedin)}`);
  if (me.other) L.push(`URL:${linkify(me.other)}`);
  if (me.address) L.push(`ADR;TYPE=WORK:;;${vEsc(me.address)};;;;`);
  L.push('END:VCARD');
  return L.join('\r\n');
}
function makeQr(text) {
  for (const ec of ['Q', 'M', 'L']) {
    try {
      const q = qrcode(0, ec);
      q.addData(text);
      q.make();
      return q;
    } catch {}
  }
  throw new Error('Troppi dati per il QR');
}
function drawQr(ctx, qr, x, y, size, dark = '#000') {
  const n = qr.getModuleCount();
  const cell = size / n;
  ctx.fillStyle = dark;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c)) ctx.fillRect(x + c * cell, y + r * cell, Math.ceil(cell), Math.ceil(cell));
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const FONT = '"Inter","Roboto","Segoe UI",system-ui,sans-serif';
function fitText(ctx, text, maxW, size, weight) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 14);
  return s;
}
let logoImgCache = { src: null, img: null };
async function drawCard(canvas, me, tplKey) {
  const t = TEMPLATES[tplKey] || TEMPLATES.navy;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  // sfondo
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, t.bg[0]);
  g.addColorStop(1, t.bg[1]);
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 34);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // decoro discreto
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = t.accent;
  ctx.beginPath();
  ctx.arc(W - 40, -60, 330, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = t.accent;
  ctx.fillRect(0, H - 14, W, 14);

  const P = 70;
  const qrSize = 300, qrPad = 20;
  const qx = W - P - qrSize - qrPad * 2 + 10, qy = (H - qrSize - qrPad * 2) / 2 - 4;
  const textMax = qx - P - 40;

  let y = P;
  // logo
  if (me.logo) {
    if (logoImgCache.src !== me.logo) logoImgCache = { src: me.logo, img: await loadImage(me.logo) };
    const img = logoImgCache.img;
    const lh = 92, lw = Math.min(260, (img.width / img.height) * lh);
    ctx.save();
    roundRect(ctx, P, y, lw, lh, 14);
    ctx.clip();
    ctx.drawImage(img, P, y, lw, lh);
    ctx.restore();
    y += lh + 34;
  } else if (me.company) {
    ctx.fillStyle = t.accent;
    const s = fitText(ctx, me.company.toUpperCase(), textMax, 26, 700);
    ctx.font = `700 ${s}px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText(me.company.toUpperCase(), P, y + 6);
    y += 74;
  } else y += 40;

  ctx.textBaseline = 'alphabetic';
  // nome
  const name = meFullName(me);
  ctx.fillStyle = t.text;
  let s = fitText(ctx, name, textMax, 62, 800);
  ctx.font = `800 ${s}px ${FONT}`;
  y += s;
  ctx.fillText(name, P, y);
  // ruolo
  const roleLine = [me.role, me.logo ? me.company : ''].filter(Boolean).join(' · ');
  if (roleLine) {
    ctx.fillStyle = t.accent;
    s = fitText(ctx, roleLine, textMax, 30, 600);
    ctx.font = `600 ${s}px ${FONT}`;
    y += 48;
    ctx.fillText(roleLine, P, y);
  }
  if (me.tagline) {
    ctx.fillStyle = t.sub;
    s = fitText(ctx, me.tagline, textMax, 24, 400);
    ctx.font = `italic 400 ${s}px ${FONT}`;
    y += 38;
    ctx.fillText(me.tagline, P, y);
  }
  // contatti, allineati in basso
  const contacts = [
    me.mobile && ['T', me.mobile],
    me.phone && ['U', me.phone],
    me.email && ['@', me.email],
    me.website && ['W', me.website.replace(/^https?:\/\//, '')],
    me.linkedin && ['in', me.linkedin.replace(/^https?:\/\/(www\.)?/, '')],
  ].filter(Boolean).slice(0, 4);
  const lineH = 44;
  let cy = H - P - 6 - (contacts.length - 1) * lineH;
  ctx.fillStyle = t.accent;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(P, cy - 50, 64, 4);
  ctx.globalAlpha = 1;
  for (const [ico, val] of contacts) {
    ctx.fillStyle = t.accent;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText(ico, P, cy);
    ctx.fillStyle = t.text;
    const fs = fitText(ctx, val, textMax - 50, 27, 500);
    ctx.font = `500 ${fs}px ${FONT}`;
    ctx.fillText(val, P + 48, cy);
    cy += lineH;
  }
  // QR
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, qx, qy, qrSize + qrPad * 2, qrSize + qrPad * 2, 22);
  ctx.fill();
  drawQr(ctx, makeQr(meVCard(me)), qx + qrPad, qy + qrPad, qrSize, '#0b0b0c');
  ctx.fillStyle = t.sub;
  ctx.font = `500 19px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Inquadra per salvarmi', qx + qrPad + qrSize / 2, qy + qrSize + qrPad * 2 + 34);
  ctx.textAlign = 'left';
  ctx.restore();
}
function renderTemplates() {
  const cur = localStorage.meTpl || 'navy';
  $('#templates').innerHTML = Object.entries(TEMPLATES)
    .map(([k, t]) => `<button class="tpl ${k === cur ? 'on' : ''}" data-k="${k}" style="background:linear-gradient(135deg,${t.bg[0]},${t.bg[1]});color:${t.text}"><i style="background:${t.accent}"></i>${t.name}</button>`)
    .join('');
}
$('#templates').onclick = (e) => {
  const b = e.target.closest('.tpl');
  if (!b) return;
  localStorage.meTpl = b.dataset.k;
  renderMe();
};
function renderMe() {
  const me = getMe();
  $('#meEmpty').classList.toggle('hidden', !!me);
  $('#meShow').classList.toggle('hidden', !me);
  $('#meForm').classList.toggle('hidden', !!me);
  if (!me) fillMeForm({});
  else {
    drawCard($('#cardCanvas'), me, localStorage.meTpl || 'navy');
    renderTemplates();
  }
}
let meLogo = null;
function fillMeForm(me) {
  const f = $('#meForm');
  for (const el of f.elements) if (el.name) el.value = me[el.name] || '';
  meLogo = me.logo || null;
  renderLogoPrev();
}
function renderLogoPrev() {
  $('#meLogoPrev').innerHTML = meLogo ? `<img src="${meLogo}" alt="">` : 'Logo<br>o foto';
  $('#meLogoDel').classList.toggle('hidden', !meLogo);
}
$('#editMeBtn').onclick = () => {
  fillMeForm(getMe() || {});
  $('#meShow').classList.add('hidden');
  $('#meForm').classList.remove('hidden');
  window.scrollTo(0, 0);
};
$('#meCancel').onclick = () => {
  if (getMe()) renderMe();
  else history.back();
};
$('#meLogoBtn').onclick = () => $('#meLogoInput').click();
$('#meLogoDel').onclick = () => { meLogo = null; renderLogoPrev(); };
$('#meLogoInput').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const img = await loadImage(await fileToDataURL(file));
  meLogo = scaledCanvas(img, 500).toDataURL('image/png');
  renderLogoPrev();
};
$('#meForm').onsubmit = (e) => {
  e.preventDefault();
  const me = {};
  for (const el of e.target.elements) if (el.name) me[el.name] = el.value.trim();
  me.logo = meLogo;
  try {
    makeQr(meVCard(me));
  } catch {
    return toast('Troppi dati per il QR: accorcia qualche campo');
  }
  localStorage.me = JSON.stringify(me);
  toast('Il tuo biglietto è pronto');
  renderMe();
};
function cardBlob() {
  return new Promise((res) => $('#cardCanvas').toBlob(res, 'image/png'));
}
$('#downloadCardBtn').onclick = async () => {
  const me = getMe();
  download(await cardBlob(), `biglietto-${meFullName(me).replace(/\s+/g, '-')}.png`);
};
$('#shareCardBtn').onclick = async () => {
  const me = getMe();
  const base = meFullName(me).replace(/\s+/g, '-') || 'biglietto';
  const png = new File([await cardBlob()], `biglietto-${base}.png`, { type: 'image/png' });
  const vcf = new File([meVCard(me) + '\r\n'], `${base}.vcf`, { type: 'text/vcard' });
  const files = navigator.canShare && navigator.canShare({ files: [png, vcf] }) ? [png, vcf] : [png];
  shareFiles(files, '', `${meFullName(me)}${me.role ? ' · ' + me.role : ''}${me.mobile ? '\n' + me.mobile : ''}${me.email ? '\n' + me.email : ''}`);
};

/* ---- QR a tutto schermo ---- */
let wakeLock = null;
async function showMyQr() {
  const me = getMe();
  if (!me) {
    if (state.view !== 'me') $$('#tabbar [data-tab="me"]')[0].click();
    return toast('Prima compila i tuoi dati');
  }
  const qr = makeQr(meVCard(me));
  const size = Math.min(window.innerWidth - 64, window.innerHeight - 260, 520);
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = size + 'px';
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  drawQr(ctx, qr, 0, 0, c.width);
  $('#qrBox').innerHTML = '';
  $('#qrBox').appendChild(c);
  $('#qrName').textContent = meFullName(me);
  $('#qrSub').textContent = [me.role, me.company].filter(Boolean).join(' · ');
  openOverlay('#qrView');
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseWake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
$('#qrQuickBtn').onclick = showMyQr;
$('#showQrBtn').onclick = showMyQr;
$('#qrClose').onclick = () => history.back();

/* =================== Avvio =================== */
(async function init() {
  history.replaceState({ view: 'list' }, '');
  await refresh();
  renderList();
  processQueue(); // riprende letture rimaste a metà
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // scorciatoie dall'icona (tieni premuto sull'icona dell'app)
  const h = location.hash;
  if (h === '#qr') showMyQr();
  else if (h === '#scan') $('#pickScan').click();
  else if (h === '#me') $$('#tabbar [data-tab="me"]')[0].click();
  // prepara il lettore in anticipo, così la prima scansione è veloce
  setTimeout(() => getWorker().catch(() => {}), 2500);
})();
