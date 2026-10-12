/* OCR – tekst iz skena: Tesseract.js (lokalno, lib/tesseract) + hrvatski rječnik (rjecnik.js)
   + slaganje odlomaka + pregled izvornika + izvoz u .docx (JSZip). */
(() => {
  'use strict';
  const { $, $$, esc, obavijest, spremi, kopiraj, dropzona, lokalno, mn, ikona } = AB;

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  // Tesseract radnik se pokreće iz blob: adrese, pa putanje moraju biti apsolutne
  const aps = p => new URL(p, location.href).href;

  const OCR_DPI = 300;          // razlučivost za prepoznavanje
  const MAX_STRANA = 5000;      // najveća dimenzija slike za OCR (memorija)
  const PREGLED_SIRINA = 1400;  // slika za označavanje stupaca
  const IZVORNIK_SIRINA = 2000; // slika za pregled izvornika uz tekst
  const RUB = 12;               // bijeli rub oko izrezanog stupca

  const st = {
    stranice: [],   // { ime, tip: 'pdf'|'slika', pdf, br, datoteka, rot, palac, pregled, regije: [{x0,y0,x1,y1}] u 0..1, imaTekst }
    aktivna: 0,
    odabrana: -1,   // odabrana oznaka stupca na aktivnoj stranici
    radi: false,
    radnici: [],    // [{ w, psm, napredak }]
    jezikRadnika: '',
    izvori: [],     // po odlomku: [{ str, x0, y0, x1, y1 }] u 0..1
    slabe: new Set(),
    rjecnik: null,
  };

  const el = {
    popis: $('#popis'), info: $('#info'), prepoznaj: $('#prepoznaj'), napredak: $('#napredak'), status: $('#status'),
    oznacavanje: $('#oznacavanje'), pregledSlika: $('#pregledSlika'), platno: $('#platno'), brStranice: $('#brStranice'),
    rezultat: $('#rezultat'), tekst: $('#tekst'), pozadina: $('#pozadina'), pouzdanost: $('#pouzdanost'), imeDocx: $('#imeDocx'),
    izvornikPlatno: $('#izvornikPlatno'), izvornikPoruka: $('#izvornikPoruka'), izvornikOpis: $('#izvornikOpis'),
  };

  const raspored = () => $('input[name="raspored"]:checked').value;
  const nacinRedaka = () => $('input[name="retci"]:checked').value;

  // ---------- postavke (pamte se u pregledniku) ----------
  const KVACICE = ['podnaslovi', 'kontrast', 'rjecnik', 'pdfTekst'];
  const spremljeno = lokalno.uzmi('ocr-tekst-postavke', {});
  if (spremljeno.jezik) $('#jezik').value = spremljeno.jezik;
  for (const ime of ['raspored', 'retci']) {
    const r = spremljeno[ime] && $(`input[name="${ime}"][value="${spremljeno[ime]}"]`);
    if (r) r.checked = true;
  }
  KVACICE.forEach(k => { if (typeof spremljeno[k] === 'boolean') $('#' + k).checked = spremljeno[k]; });
  function spremiPostavke() {
    const o = { jezik: $('#jezik').value, raspored: raspored(), retci: nacinRedaka() };
    KVACICE.forEach(k => { o[k] = $('#' + k).checked; });
    lokalno.stavi('ocr-tekst-postavke', o);
  }

  const OPISI = {
    auto: 'Alat sam traži stupce i blokove teksta. Dobro za većinu dokumenata.',
    jedan: 'Cijela stranica je jedan stupac teksta (dopis, ugovor, stranica knjige).',
    rucno: 'Ti označiš stupce redom čitanja (ili ih alat predloži). Najbolje za novine i časopise.',
  };
  function osvjeziRaspored() {
    $('#opisRasporeda').textContent = OPISI[raspored()];
    el.oznacavanje.hidden = raspored() !== 'rucno' || !st.stranice.length;
    if (!el.oznacavanje.hidden) prikaziPregled();
    osvjeziPopis();
  }
  $$('input[name="raspored"]').forEach(r => r.addEventListener('change', () => { spremiPostavke(); osvjeziRaspored(); }));
  $$('input[name="retci"]').forEach(r => r.addEventListener('change', spremiPostavke));
  $('#jezik').addEventListener('change', spremiPostavke);
  KVACICE.forEach(k => $('#' + k).addEventListener('change', spremiPostavke));

  // ---------- rječnik ----------
  let rjecnikObecanje = null;
  function ucitajRjecnik() {
    if (!rjecnikObecanje) {
      rjecnikObecanje = Promise.all(['lib/rjecnik/hr_HR.aff', 'lib/rjecnik/hr_HR.dic'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.text(); })))
        .then(([aff, dic]) => (st.rjecnik = Rjecnik.ucitaj(aff, dic)))
        .catch(e => { console.error(e); rjecnikObecanje = null; return null; });
    }
    return rjecnikObecanje;
  }

  // ---------- učitavanje datoteka ----------
  dropzona($('#drop'), dodajDatoteke, { accept: 'application/pdf,image/*', visestruko: true });

  async function dodajDatoteke(datoteke) {
    for (const f of datoteke) {
      try {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
          for (let i = 1; i <= pdf.numPages; i++) {
            const s = { ime: pdf.numPages > 1 ? `${f.name} – str. ${i}` : f.name, tip: 'pdf', pdf, br: i, rot: 0, regije: [] };
            const str = await pdf.getPage(i);
            const tc = await str.getTextContent();
            s.imaTekst = tc.items.reduce((n, it) => n + (it.str || '').trim().length, 0) >= 40;
            s.palac = await palac(await iscrtaj(s, 260));
            st.stranice.push(s);
            osvjeziPopis();
          }
        } else if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)) {
          const s = { ime: f.name, tip: 'slika', datoteka: f, rot: 0, regije: [] };
          s.palac = await palac(await iscrtaj(s, 260));
          st.stranice.push(s);
        } else {
          obavijest(`${f.name}: to nije PDF ni slika.`);
        }
      } catch (e) {
        console.error(e);
        obavijest(`Ne mogu otvoriti ${f.name}.`);
      }
    }
    if (st.stranice.length && el.imeDocx.value === 'tekst.docx') {
      el.imeDocx.value = st.stranice[0].ime.replace(/ – str\. \d+$/, '').replace(/\.[^.]+$/, '') + '.docx';
    }
    osvjeziPopis();
    osvjeziRaspored();
  }

  // Iscrtava stranicu u canvas (s okretanjem); sirina = ciljna širina ili null za OCR razlučivost
  async function iscrtaj(s, sirina = null) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (s.tip === 'pdf') {
      const str = await s.pdf.getPage(s.br);
      const rotation = (str.rotate + s.rot) % 360;
      const v1 = str.getViewport({ scale: 1, rotation });
      let mj = sirina ? sirina / v1.width : OCR_DPI / 72;
      mj = Math.min(mj, MAX_STRANA / Math.max(v1.width, v1.height));
      const v = str.getViewport({ scale: mj, rotation });
      c.width = Math.round(v.width); c.height = Math.round(v.height);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await str.render({ canvasContext: ctx, viewport: v }).promise;
    } else {
      const bmp = await createImageBitmap(s.datoteka, { imageOrientation: 'from-image' });
      const okrenuto = s.rot === 90 || s.rot === 270;
      const bw = okrenuto ? bmp.height : bmp.width, bh = okrenuto ? bmp.width : bmp.height;
      let mj;
      if (sirina) mj = sirina / bw;
      else {
        const vece = Math.max(bw, bh);
        mj = vece < 1800 ? 2 : 1;                       // male slike povećaj, OCR voli veća slova
        mj = Math.min(mj, MAX_STRANA / vece);
      }
      c.width = Math.round(bw * mj); c.height = Math.round(bh * mj);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(s.rot * Math.PI / 180);
      const dw = bmp.width * mj, dh = bmp.height * mj;
      ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
      bmp.close?.();
    }
    return c;
  }

  const palac = c => new Promise(r => c.toBlob(b => r(URL.createObjectURL(b)), 'image/jpeg', 0.82));

  function osvjeziPopis() {
    const n = st.stranice.length;
    el.prepoznaj.disabled = !n || st.radi;
    const sTekstom = st.stranice.filter(s => s.imaTekst).length;
    el.info.textContent = n ? `${n} ${mn(n, 'stranica', 'stranice', 'stranica')} za prepoznavanje.` + (sTekstom ? ` ${sTekstom} ${mn(sTekstom, 'već sadrži', 'već sadrže', 'već sadrži')} tekst.` : '') : '';
    if (st.aktivna >= n) st.aktivna = Math.max(0, n - 1);
    const rucno = raspored() === 'rucno';
    el.popis.innerHTML = st.stranice.map((s, i) => `<div class="sl" data-i="${i}" ${rucno && i === st.aktivna ? 'aria-current="true"' : ''} title="${esc(s.ime)}">
        <div class="okvir"><img src="${s.palac}" alt=""></div>
        <span class="ime">${esc(s.ime)}</span>
        <span class="oznake">${s.imaTekst ? '<span class="pilula ok">ima tekst</span>' : ''}${rucno && s.regije.length ? `<span class="pilula">${s.regije.length} ${mn(s.regije.length, 'stupac', 'stupca', 'stupaca')}</span>` : ''}</span>
        <span class="alatke">
          <button type="button" data-okreni="${i}" aria-label="Okreni ${esc(s.ime)} za 90°" title="Okreni za 90°">${ikona('rotiraj')}</button>
          <button type="button" data-makni="${i}" aria-label="Makni ${esc(s.ime)}" title="Makni">${ikona('x')}</button>
        </span>
      </div>`).join('');
  }

  el.popis.addEventListener('click', async e => {
    const m = e.target.closest('[data-makni]');
    if (m) {
      if (st.radi) return;
      const i = +m.dataset.makni;
      oslobodi(st.stranice[i]);
      st.stranice.splice(i, 1);
      if (st.aktivna >= i && st.aktivna > 0) st.aktivna--;
      st.odabrana = -1;
      osvjeziPopis(); osvjeziRaspored();
      return;
    }
    const o = e.target.closest('[data-okreni]');
    if (o) {
      if (st.radi) return;
      await okreni(st.stranice[+o.dataset.okreni]);
      return;
    }
    const sl = e.target.closest('.sl');
    if (sl && raspored() === 'rucno') {
      st.aktivna = +sl.dataset.i; st.odabrana = -1;
      osvjeziPopis(); prikaziPregled();
      el.oznacavanje.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  function oslobodi(s) {
    URL.revokeObjectURL(s.palac);
    if (s.pregled) URL.revokeObjectURL(s.pregled);
    izvornikPredmemorija.delete(s);
  }

  // Okretanje za 90° u smjeru kazaljke; oznake stupaca se okreću zajedno sa stranicom
  async function okreni(s) {
    s.rot = (s.rot + 90) % 360;
    s.regije = s.regije.map(r => ({ x0: 1 - r.y1, y0: r.x0, x1: 1 - r.y0, y1: r.x1 }));
    oslobodi(s);
    s.pregled = null;
    s.palac = await palac(await iscrtaj(s, 260));
    if (st.stranice[st.aktivna] === s) { pregledZa = null; st.odabrana = -1; }
    osvjeziPopis();
    if (!el.oznacavanje.hidden) prikaziPregled();
  }

  // ---------- ručno označavanje stupaca ----------
  let pregledZa = null;
  async function prikaziPregled() {
    const s = st.stranice[st.aktivna];
    if (!s) return;
    el.brStranice.textContent = `${st.aktivna + 1} / ${st.stranice.length}`;
    $('#prethodna').disabled = st.aktivna === 0;
    $('#sljedeca').disabled = st.aktivna >= st.stranice.length - 1;
    if (pregledZa !== s) {
      pregledZa = s;
      if (!s.pregled) s.pregled = await palac(await iscrtaj(s, PREGLED_SIRINA));
      if (pregledZa !== s) return;
      el.pregledSlika.src = s.pregled;
      await el.pregledSlika.decode().catch(() => {});
    }
    crtajRegije();
  }

  const DRSKA = 7; // polovica kvadratića za mijenjanje veličine (CSS px)
  function crtajRegije(privremena = null) {
    const s = st.stranice[st.aktivna];
    const c = el.platno, img = el.pregledSlika;
    const dpr = window.devicePixelRatio || 1;
    const w = img.clientWidth, h = img.clientHeight;
    osvjeziOdabrano();
    if (!w || !h) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    (s?.regije || []).forEach((r, i) => {
      const x = r.x0 * w, y = r.y0 * h, rw = (r.x1 - r.x0) * w, rh = (r.y1 - r.y0) * h;
      const odabr = i === st.odabrana;
      ctx.fillStyle = odabr ? 'rgba(22, 48, 92, .14)' : 'rgba(212, 42, 52, .12)'; ctx.fillRect(x, y, rw, rh);
      ctx.strokeStyle = odabr ? '#16305c' : '#d42a34'; ctx.lineWidth = odabr ? 3 : 2; ctx.setLineDash([]); ctx.strokeRect(x, y, rw, rh);
      const rr = 13;
      ctx.fillStyle = odabr ? '#d42a34' : '#16305c'; ctx.beginPath(); ctx.arc(x + rr + 3, y + rr + 3, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 14px "Nunito Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x + rr + 3, y + rr + 4);
      if (odabr) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#16305c'; ctx.lineWidth = 2;
        for (const [kx, ky] of [[x, y], [x + rw, y], [x, y + rh], [x + rw, y + rh]]) {
          ctx.fillRect(kx - DRSKA, ky - DRSKA, DRSKA * 2, DRSKA * 2); ctx.strokeRect(kx - DRSKA, ky - DRSKA, DRSKA * 2, DRSKA * 2);
        }
      }
    });
    if (privremena) {
      const r = normaliziraj(privremena);
      ctx.strokeStyle = '#16305c'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x0 * w, r.y0 * h, (r.x1 - r.x0) * w, (r.y1 - r.y0) * h);
    }
  }

  function osvjeziOdabrano() {
    const s = st.stranice[st.aktivna];
    const n = s?.regije.length || 0;
    if (st.odabrana >= n) st.odabrana = -1;
    $('#odabrano').hidden = st.odabrana < 0;
    if (st.odabrana >= 0) {
      $('#odabranoBr').textContent = `Oznaka ${st.odabrana + 1}`;
      $('#ranije').disabled = st.odabrana === 0;
      $('#kasnije').disabled = st.odabrana >= n - 1;
    }
  }

  const normaliziraj = r => ({ x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) });
  const ogr = v => Math.min(1, Math.max(0, v));

  function tocka(e) {
    const b = el.platno.getBoundingClientRect();
    return { x: ogr((e.clientX - b.left) / b.width), y: ogr((e.clientY - b.top) / b.height), w: b.width, h: b.height };
  }
  // što je ispod pokazivača: kut odabrane oznake, oznaka ili ništa
  function pogodak(p) {
    const s = st.stranice[st.aktivna];
    if (!s) return null;
    const tx = (DRSKA + 3) / p.w, ty = (DRSKA + 3) / p.h;
    if (st.odabrana >= 0) {
      const r = s.regije[st.odabrana];
      const kutovi = { nw: [r.x0, r.y0], ne: [r.x1, r.y0], sw: [r.x0, r.y1], se: [r.x1, r.y1] };
      for (const [k, [x, y]] of Object.entries(kutovi)) if (Math.abs(p.x - x) <= tx && Math.abs(p.y - y) <= ty) return { vrsta: 'kut', kut: k, i: st.odabrana };
    }
    for (let i = s.regije.length - 1; i >= 0; i--) {
      const r = s.regije[i];
      if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) return { vrsta: 'oznaka', i };
    }
    return null;
  }

  let vucem = null; // { nacin: 'novi'|'pomak'|'kut', pocetak, izvorna, kut, i, pomaknuto }
  el.platno.addEventListener('pointerdown', e => {
    const s = st.stranice[st.aktivna];
    if (!s) return;
    el.platno.focus({ preventScroll: true });
    el.platno.setPointerCapture(e.pointerId);
    const p = tocka(e);
    const pg = pogodak(p);
    // pomiče se samo već odabrana oznaka; povlačenje preko neodabrane crta novu (susjedni stupci počinju na rubu prethodnog),
    // a klik bez povlačenja je odabire
    if (pg?.vrsta === 'kut') vucem = { nacin: 'kut', kut: pg.kut, i: pg.i, pocetak: p, izvorna: { ...s.regije[pg.i] } };
    else if (pg?.vrsta === 'oznaka' && pg.i === st.odabrana) vucem = { nacin: 'pomak', i: pg.i, pocetak: p, izvorna: { ...s.regije[pg.i] } };
    else vucem = { nacin: 'novi', kandidat: pg ? pg.i : -1, pocetak: p, r: { x0: p.x, y0: p.y, x1: p.x, y1: p.y } };
  });
  el.platno.addEventListener('pointermove', e => {
    const p = tocka(e);
    if (!vucem) {
      const pg = pogodak(p);
      el.platno.style.cursor = pg?.vrsta === 'kut' ? (pg.kut === 'nw' || pg.kut === 'se' ? 'nwse-resize' : 'nesw-resize') : pg && pg.i === st.odabrana ? 'move' : 'crosshair';
      return;
    }
    const s = st.stranice[st.aktivna];
    const dx = p.x - vucem.pocetak.x, dy = p.y - vucem.pocetak.y;
    if (Math.abs(dx) * p.w > 3 || Math.abs(dy) * p.h > 3) vucem.pomaknuto = true;
    if (vucem.nacin === 'novi') { vucem.r.x1 = p.x; vucem.r.y1 = p.y; crtajRegije(vucem.r); return; }
    const o = vucem.izvorna;
    if (vucem.nacin === 'pomak') {
      const sx = Math.min(Math.max(dx, -o.x0), 1 - o.x1), sy = Math.min(Math.max(dy, -o.y0), 1 - o.y1);
      s.regije[vucem.i] = { x0: o.x0 + sx, y0: o.y0 + sy, x1: o.x1 + sx, y1: o.y1 + sy };
    } else {
      const r = { ...o };
      if (vucem.kut.includes('n')) r.y0 = p.y; else r.y1 = p.y;
      if (vucem.kut.includes('w')) r.x0 = p.x; else r.x1 = p.x;
      s.regije[vucem.i] = r;
    }
    crtajRegije();
  });
  const zavrsiVucenje = () => {
    if (!vucem) return;
    const s = st.stranice[st.aktivna];
    if (vucem.nacin === 'novi') {
      const r = normaliziraj(vucem.r);
      if (vucem.pomaknuto && r.x1 - r.x0 > 0.02 && r.y1 - r.y0 > 0.01) { s.regije.push(r); st.odabrana = -1; osvjeziPopis(); }
      else if (!vucem.pomaknuto) st.odabrana = vucem.kandidat; // klik: odaberi oznaku ili poništi odabir
    } else if (vucem.nacin === 'kut') {
      const r = normaliziraj(s.regije[vucem.i]);
      s.regije[vucem.i] = r.x1 - r.x0 > 0.01 && r.y1 - r.y0 > 0.005 ? r : vucem.izvorna;
    }
    vucem = null;
    crtajRegije();
  };
  el.platno.addEventListener('pointerup', zavrsiVucenje);
  el.platno.addEventListener('pointercancel', () => { if (vucem && vucem.nacin !== 'novi') st.stranice[st.aktivna].regije[vucem.i] = vucem.izvorna; vucem = null; crtajRegije(); });
  el.platno.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.odabrana >= 0) { e.preventDefault(); obrisiOdabranu(); }
    if (e.key === 'Escape') { st.odabrana = -1; crtajRegije(); }
  });
  window.addEventListener('resize', () => { if (!el.oznacavanje.hidden) crtajRegije(); });

  function obrisiOdabranu() {
    const s = st.stranice[st.aktivna];
    if (!s || st.odabrana < 0) return;
    s.regije.splice(st.odabrana, 1);
    st.odabrana = -1;
    osvjeziPopis(); crtajRegije();
  }
  function pomakniOdabranu(smjer) {
    const s = st.stranice[st.aktivna];
    const i = st.odabrana, j = i + smjer;
    if (!s || i < 0 || j < 0 || j >= s.regije.length) return;
    [s.regije[i], s.regije[j]] = [s.regije[j], s.regije[i]];
    st.odabrana = j;
    crtajRegije();
  }
  $('#obrisiOznaku').addEventListener('click', obrisiOdabranu);
  $('#ranije').addEventListener('click', () => pomakniOdabranu(-1));
  $('#kasnije').addEventListener('click', () => pomakniOdabranu(1));
  $('#ponisti').addEventListener('click', () => { st.stranice[st.aktivna]?.regije.pop(); st.odabrana = -1; osvjeziPopis(); crtajRegije(); });
  $('#ocisti').addEventListener('click', () => { const s = st.stranice[st.aktivna]; if (s) s.regije = []; st.odabrana = -1; osvjeziPopis(); crtajRegije(); });
  $('#naSve').addEventListener('click', () => {
    const izvor = st.stranice[st.aktivna];
    if (!izvor?.regije.length) { obavijest('Prvo označi stupce na ovoj stranici.'); return; }
    st.stranice.forEach(s => { if (s !== izvor) s.regije = izvor.regije.map(r => ({ ...r })); });
    osvjeziPopis();
    obavijest('Oznake su kopirane na sve stranice.');
  });
  $('#prethodna').addEventListener('click', () => { if (st.aktivna > 0) { st.aktivna--; st.odabrana = -1; osvjeziPopis(); prikaziPregled(); } });
  $('#sljedeca').addEventListener('click', () => { if (st.aktivna < st.stranice.length - 1) { st.aktivna++; st.odabrana = -1; osvjeziPopis(); prikaziPregled(); } });

  // ---------- automatski prijedlog stupaca (Tesseractova analiza rasporeda) ----------
  $('#predlozi').addEventListener('click', async () => {
    const s = st.stranice[st.aktivna];
    if (!s || st.radi) return;
    st.radi = true;
    const gumb = $('#predlozi');
    gumb.disabled = el.prepoznaj.disabled = true;
    try {
      posao = { gotovo: 0, ukupno: 1, opis: 'Tražim stupce…' };
      postaviNapredak(0, 'Tražim stupce…');
      const [r] = await osigurajRadnike($('#jezik').value, 1);
      const c = await iscrtaj(s, 1700);
      await postaviPsm(r, '3');
      const { data } = await r.w.recognize(c, {}, { blocks: true });
      const regije = predloziIzBlokova(data.blocks || [], c.width, c.height);
      if (!regije.length) { postaviNapredak(1, 'Na ovoj stranici nisam našao stupce teksta.'); return; }
      s.regije = regije;
      st.odabrana = -1;
      osvjeziPopis(); crtajRegije();
      postaviNapredak(1, `Predloženo ${regije.length} ${mn(regije.length, 'stupac', 'stupca', 'stupaca')}. Provjeri redoslijed, a naslove, potpise i citate koje ne želiš obriši.`);
    } catch (e) {
      console.error(e);
      el.status.textContent = 'Prijedlog stupaca nije uspio: ' + (e?.message || e);
    } finally {
      st.radi = false;
      gumb.disabled = false;
      osvjeziPopis();
    }
  });

  function predloziIzBlokova(blokovi, W, H) {
    const preklop = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    let r = blokovi
      .filter(b => (b.text || '').replace(/\s/g, '').length >= 12 && b.confidence >= 35 && (b.bbox.x1 - b.bbox.x0) > W * 0.04)
      .map(b => ({ x0: b.bbox.x0 / W, y0: b.bbox.y0 / H, x1: b.bbox.x1 / W, y1: b.bbox.y1 / H }));
    // spoji blokove koji su jedan ispod drugog u istom stupcu
    let promjena = true;
    while (promjena) {
      promjena = false;
      r.sort((a, b) => a.y0 - b.y0);
      outer: for (let i = 0; i < r.length; i++) {
        for (let j = i + 1; j < r.length; j++) {
          const a = r[i], b = r[j];
          const uza = Math.min(a.x1 - a.x0, b.x1 - b.x0);
          const sire = Math.max(a.x1 - a.x0, b.x1 - b.x0);
          if (preklop(a, b) >= uza * 0.7 && uza >= sire * 0.6 && b.y0 - a.y1 < 0.025 && b.y0 >= a.y0 - 0.005) {
            r[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
            r.splice(j, 1);
            promjena = true;
            break outer;
          }
        }
      }
    }
    // redoslijed čitanja: stupci slijeva nadesno, u stupcu odozgo prema dolje
    r.sort((a, b) => a.x0 - b.x0);
    const stupci = [];
    for (const b of r) {
      const s = stupci.find(k => preklop(k, b) >= Math.min(k.x1 - k.x0, b.x1 - b.x0) * 0.5);
      if (s) { s.clanovi.push(b); s.x0 = Math.min(s.x0, b.x0); s.x1 = Math.max(s.x1, b.x1); }
      else stupci.push({ x0: b.x0, x1: b.x1, clanovi: [b] });
    }
    stupci.sort((a, b) => a.x0 - b.x0);
    const rub = 0.004;
    return stupci.flatMap(s => s.clanovi.sort((a, b) => a.y0 - b.y0))
      .map(b => ({ x0: ogr(b.x0 - rub), y0: ogr(b.y0 - rub), x1: ogr(b.x1 + rub), y1: ogr(b.y1 + rub) }));
  }

  // ---------- OCR radnici (paralelno) ----------
  const STATUSI = {
    'loading tesseract core': 'Učitavam OCR jezgru…',
    'initializing tesseract': 'Pokrećem OCR…',
    'loading language traineddata': 'Učitavam jezik…',
    'initializing api': 'Pripremam prepoznavanje…',
  };
  let posao = { gotovo: 0, ukupno: 1, opis: '' };
  function postaviNapredak(udio, tekst) {
    el.napredak.hidden = false;
    el.napredak.firstElementChild.style.width = Math.round(Math.min(1, Math.max(0, udio)) * 100) + '%';
    if (tekst) el.status.textContent = tekst;
  }
  const osvjeziNapredak = () => postaviNapredak((posao.gotovo + st.radnici.reduce((n, r) => n + (r.napredak || 0), 0)) / posao.ukupno, posao.opis);
  function logger(m, r) {
    if (m.status === 'recognizing text') { r.napredak = m.progress || 0; osvjeziNapredak(); }
    else if (STATUSI[m.status] && posao.gotovo === 0) el.status.textContent = STATUSI[m.status];
  }

  function koliko(poslova) {
    const jezgre = navigator.hardwareConcurrency || 2;
    const mem = navigator.deviceMemory || 8;
    const max = mem <= 4 ? 1 : Math.min(3, Math.max(1, Math.floor(jezgre / 2)));
    return Math.max(1, Math.min(max, poslova));
  }

  async function noviRadnik(jezik) {
    const r = { psm: null, napredak: 0 };
    r.w = await Tesseract.createWorker(jezik, 1, {
      workerPath: aps('lib/tesseract/worker.min.js'),
      corePath: aps('lib/tesseract/'),
      langPath: aps('lib/tesseract/lang'),
      logger: m => logger(m, r),
    });
    return r;
  }
  async function osigurajRadnike(jezik, n) {
    if (st.jezikRadnika !== jezik) {
      await Promise.all(st.radnici.map(r => r.w.terminate().catch(() => {})));
      st.radnici = [];
      st.jezikRadnika = jezik;
    }
    if (!st.radnici.length) st.radnici.push(await noviRadnik(jezik)); // prvi sam učita i spremi jezik u predmemoriju
    if (st.radnici.length < n) st.radnici.push(...await Promise.all(Array.from({ length: n - st.radnici.length }, () => noviRadnik(jezik))));
    return st.radnici.slice(0, n);
  }
  async function postaviPsm(r, psm) {
    if (r.psm === psm) return;
    await r.w.setParameters({ tessedit_pageseg_mode: psm });
    r.psm = psm;
  }
  async function ugasiRadnike() {
    await Promise.all(st.radnici.map(r => r.w.terminate().catch(() => {})));
    st.radnici = [];
    st.jezikRadnika = '';
  }

  // Crno-bijelo s Otsu pragom
  function pojacajKontrast(c) {
    const ctx = c.getContext('2d');
    const id = ctx.getImageData(0, 0, c.width, c.height), p = id.data;
    const siva = new Uint8Array(p.length / 4), hist = new Uint32Array(256);
    for (let i = 0, j = 0; i < p.length; i += 4, j++) {
      const y = (p[i] * 77 + p[i + 1] * 150 + p[i + 2] * 29) >> 8;
      siva[j] = y; hist[y]++;
    }
    const n = siva.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, najbolje = 0, prag = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = n - wB; if (!wF) break;
      sB += i * hist[i];
      const razlika = sB / wB - (sum - sB) / wF;
      const v = wB * wF * razlika * razlika;
      if (v > najbolje) { najbolje = v; prag = i; }
    }
    for (let i = 0, j = 0; i < p.length; i += 4, j++) {
      const v = siva[j] < prag ? 0 : 255;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  // Izreže dio canvasa (r u 0..1) uz bijeli rub; vraća i pomak za preračun koordinata
  function izrezi(c, r) {
    const x0 = Math.floor(r.x0 * c.width), y0 = Math.floor(r.y0 * c.height);
    const w = Math.max(1, Math.ceil((r.x1 - r.x0) * c.width)), h = Math.max(1, Math.ceil((r.y1 - r.y0) * c.height));
    const o = document.createElement('canvas');
    o.width = w + RUB * 2; o.height = h + RUB * 2;
    const ctx = o.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, o.width, o.height);
    ctx.drawImage(c, x0, y0, w, h, RUB, RUB, w, h);
    return { slika: o, dx: x0 - RUB, dy: y0 - RUB };
  }

  // Iz Tesseract rezultata vadi retke; bb = položaj na stranici (0..1) za pregled izvornika
  function retciIzRezultata(data, str, W, H, dx = 0, dy = 0) {
    const izlaz = [];
    for (const b of data.blocks || []) {
      const bw = Math.max(1, b.bbox.x1 - b.bbox.x0);
      let prviUBloku = true;
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) {
          const t = (l.text || '').replace(/\s+/g, ' ').trim();
          if (!t) continue;
          if (/^[|¦!:;.,'"`´\-–—_~]+$/.test(t)) continue;   // okomite crte stupaca i sl.
          if (t.length <= 2 && l.confidence < 45) continue;
          for (const w of l.words || []) {
            if (w.confidence < 55) { const k = (w.text || '').replace(/[^\p{L}\d-]/gu, ''); if (k.length >= 2) st.slabe.add(k.toLowerCase()); }
          }
          izlaz.push({
            t, x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1,
            lijevo: b.bbox.x0, desno: b.bbox.x1, sirina: bw, noviBlok: prviUBloku,
            bb: { str, x0: (l.bbox.x0 + dx) / W, y0: (l.bbox.y0 + dy) / H, x1: (l.bbox.x1 + dx) / W, y1: (l.bbox.y1 + dy) / H },
          });
          prviUBloku = false;
        }
      }
    }
    return izlaz;
  }

  // PDF koji već ima tekst: retci iz tekstnog sloja (bez OCR-a)
  async function retciIzPdfTeksta(s, str) {
    const stranica = await s.pdf.getPage(s.br);
    const v = stranica.getViewport({ scale: 1, rotation: (stranica.rotate + s.rot) % 360 });
    const tc = await stranica.getTextContent();
    const retci = [];
    let cur = null;
    const zatvori = () => { if (cur && cur.t.trim()) retci.push(cur); cur = null; };
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const [a, b, c, d, e, f] = it.transform;
      const vis = Math.hypot(c, d) || Math.hypot(a, b) || 10;
      const [px0, py0] = v.convertToViewportPoint(e, f);
      const [px1, py1] = v.convertToViewportPoint(e + (it.width || 0), f + vis);
      const bx0 = Math.min(px0, px1), bx1 = Math.max(px0, px1), by0 = Math.min(py0, py1), by1 = Math.max(py0, py1);
      const h = Math.max(1, by1 - by0);
      if (it.str) {
        const sredina = (by0 + by1) / 2;
        if (cur && (Math.abs(sredina - (cur.y0 + cur.y1) / 2) > h * 0.6 || bx0 < cur.x1 - h * 2)) zatvori();
        if (!cur) cur = { t: '', x0: bx0, x1: bx1, y0: by0, y1: by1 };
        else if (bx0 - cur.x1 > h * 0.2 && !/\s$/.test(cur.t) && !/^\s/.test(it.str)) cur.t += ' ';
        cur.t += it.str;
        cur.x0 = Math.min(cur.x0, bx0); cur.x1 = Math.max(cur.x1, bx1); cur.y0 = Math.min(cur.y0, by0); cur.y1 = Math.max(cur.y1, by1);
      }
      if (it.hasEOL) zatvori();
    }
    zatvori();
    // blokovi: novi stupac (skok gore) ili veći razmak
    let blok = [];
    const blokovi = [];
    retci.forEach((l, k) => {
      const p = retci[k - 1];
      const vis = Math.max(1, l.y1 - l.y0);
      if (p && (l.y0 < p.y0 - vis || l.y0 - p.y1 > vis * 1.5 || Math.abs(l.x0 - p.x0) > v.width * 0.3)) { blokovi.push(blok); blok = []; }
      blok.push(l);
    });
    if (blok.length) blokovi.push(blok);
    const izlaz = [];
    for (const bl of blokovi) {
      const lijevo = Math.min(...bl.map(l => l.x0)), desno = Math.max(...bl.map(l => l.x1));
      bl.forEach((l, k) => izlaz.push({
        t: l.t.replace(/\s+/g, ' ').trim(), x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1,
        lijevo, desno, sirina: Math.max(1, desno - lijevo), noviBlok: k === 0,
        bb: { str, x0: l.x0 / v.width, y0: l.y0 / v.height, x1: l.x1 / v.width, y1: l.y1 / v.height },
      }));
    }
    return izlaz.filter(l => l.t);
  }

  // ---------- slaganje redaka u odlomke ----------
  const ZAVRSNI = /[.!?:"”“»…)]$/;
  const CRTICA_DIJALOG = /^[–—-]\s/;
  const RASTAVLJENO = /[A-Za-zČĆŽŠĐčćžšđ][-¬­]$/;
  const ocistiRedak = t => t.replace(/^[|¦]\s*/, '').replace(/\s*[|¦]$/, '').replace(/\s+/g, ' ').trim();

  // vraća [{ t, izvori: [bb] }]
  function slozi(retci, nacin, rj) {
    const odlomci = [];
    let cur = '', izvori = [], prev = null;
    const zatvori = () => { if (cur.trim()) odlomci.push({ t: cur.trim(), izvori }); cur = ''; izvori = []; };
    for (const l of retci) {
      let t = ocistiRedak(l.t);
      if (!t) continue;
      const dijalog = CRTICA_DIJALOG.test(t);
      if (dijalog) t = '– ' + t.replace(/^[–—-]\s*/, '');
      const visina = Math.max(1, l.y1 - l.y0);
      const razmak = prev && !l.noviBlok && (l.y0 - prev.y1) > visina * 0.9;

      if (nacin === 'retci') {
        if (prev && (l.noviBlok || razmak)) zatvori();
        cur = cur ? cur + '\n' + t : t;
        izvori.push(l.bb);
        prev = l;
        continue;
      }

      if (cur) {
        const kraj = ZAVRSNI.test(cur);
        const kratak = prev && prev.x1 < prev.desno - prev.sirina * 0.15;
        let novi = false;
        if (dijalog || razmak) novi = true;
        else if (kraj && (kratak || l.noviBlok)) novi = true;
        else if (prev && !kraj && kratak && !RASTAVLJENO.test(cur) && /^[A-ZČĆŽŠĐ0-9„"]/.test(t) && cur.length < 80) novi = true; // kratki naslov bez točke
        if (novi) zatvori();
      }

      if (!cur) cur = t;
      else if (RASTAVLJENO.test(cur)) {
        const baza = cur.slice(0, -1);
        if (/^[a-zčćžšđ]/.test(t)) {
          // "crno-" + "bijeli": ako spojena riječ ne postoji, a oba dijela postoje, zadrži crticu
          const lijevi = (baza.match(/[\p{L}]+$/u) || [''])[0], desni = (t.match(/^[\p{L}]+/u) || [''])[0];
          const zadrziCrticu = rj && lijevi.length > 1 && !rj.poznata(lijevi + desni) && rj.poznata(lijevi) && rj.poznata(desni);
          cur = zadrziCrticu ? baza + '-' + t : baza + t;
        } else cur = baza + '-' + t;
      } else cur += ' ' + t;
      izvori.push(l.bb);
      prev = l;
    }
    zatvori();
    return odlomci;
  }

  // ---------- prepoznavanje ----------
  el.prepoznaj.addEventListener('click', async () => {
    if (st.radi || !st.stranice.length) return;
    st.radi = true;
    el.prepoznaj.disabled = true;
    $('#predlozi').disabled = true;
    const jezik = $('#jezik').value;
    const nacin = raspored();
    const kontrast = $('#kontrast').checked;
    const pdfTekst = $('#pdfTekst').checked;
    const sRjecnikom = $('#rjecnik').checked && jezik.includes('hrv');
    const t0 = performance.now();
    st.slabe = new Set();
    try {
      const rjecnikP = sRjecnikom ? ucitajRjecnik() : Promise.resolve(null);
      // poslovi: jedan po stranici ili po označenom stupcu
      const poslovi = [];
      st.stranice.forEach((s, i) => {
        if (pdfTekst && s.imaTekst) { poslovi.push({ i, pdf: true }); return; }
        const regije = nacin === 'rucno' && s.regije.length ? s.regije : [null];
        regije.forEach(r => poslovi.push({ i, r, psm: r || nacin === 'jedan' ? '4' : '3' }));
      });
      const ocrPoslova = poslovi.filter(p => !p.pdf).length;
      posao = { gotovo: 0, ukupno: poslovi.length, opis: 'Prepoznajem tekst…' };
      postaviNapredak(0, ocrPoslova ? 'Pokrećem OCR…' : 'Čitam tekst iz PDF-a…');
      const radnici = ocrPoslova ? await osigurajRadnike(jezik, koliko(ocrPoslova)) : [];
      if (radnici.length > 1) posao.opis = `Prepoznajem tekst (${radnici.length} ${mn(radnici.length, 'radnik', 'radnika', 'radnika')} paralelno)…`;

      // iscrtane stranice dijele svi stupci te stranice; oslobađaju se kad su svi gotovi
      const platna = new Map();
      const preostalo = new Map();
      poslovi.forEach(p => { if (!p.pdf) preostalo.set(p.i, (preostalo.get(p.i) || 0) + 1); });
      const platnoStranice = i => { if (!platna.has(i)) platna.set(i, iscrtaj(st.stranice[i])); return platna.get(i); };
      const otpusti = async i => {
        const n = preostalo.get(i) - 1;
        preostalo.set(i, n);
        if (n === 0) { const c = await platna.get(i); c.width = c.height = 0; platna.delete(i); }
      };

      const rezultati = new Array(poslovi.length);
      const pouzdanosti = [];
      const izvrsi = async (p, r) => {
        if (p.pdf) return retciIzPdfTeksta(st.stranice[p.i], p.i);
        const c = await platnoStranice(p.i);
        const W = c.width, H = c.height;
        let slika = c, dx = 0, dy = 0;
        if (p.r) ({ slika, dx, dy } = izrezi(c, p.r));
        else if (kontrast) slika = (() => { const k = document.createElement('canvas'); k.width = W; k.height = H; k.getContext('2d').drawImage(c, 0, 0); return k; })();
        if (kontrast) pojacajKontrast(slika);
        await postaviPsm(r, p.psm);
        const { data } = await r.w.recognize(slika, { rotateAuto: true }, { text: true, blocks: true });
        if (slika !== c) slika.width = slika.height = 0;
        await otpusti(p.i);
        const retci = retciIzRezultata(data, p.i, W, H, dx, dy);
        if (retci.length) retci[0].noviBlok = true;
        // označeni stupac je jedan stupac: sve retke računaj prema širini stupca
        if (p.r && retci.length) {
          const lijevo = Math.min(...retci.map(x => x.x0)), desno = Math.max(...retci.map(x => x.x1));
          retci.forEach((x, k) => { x.lijevo = lijevo; x.desno = desno; x.sirina = Math.max(1, desno - lijevo); if (k) x.noviBlok = false; });
        }
        if (data.confidence) pouzdanosti.push(data.confidence);
        return retci;
      };

      let sljedeci = 0;
      const pdfPoslovi = poslovi.map((p, k) => p.pdf ? k : -1).filter(k => k >= 0);
      for (const k of pdfPoslovi) { rezultati[k] = await izvrsi(poslovi[k]); posao.gotovo++; osvjeziNapredak(); }
      const ocrIndeksi = poslovi.map((p, k) => p.pdf ? -1 : k).filter(k => k >= 0);
      await Promise.all(radnici.map(async r => {
        while (sljedeci < ocrIndeksi.length) {
          const k = ocrIndeksi[sljedeci++];
          rezultati[k] = await izvrsi(poslovi[k], r);
          r.napredak = 0;
          posao.gotovo++;
          osvjeziNapredak();
        }
      }));

      postaviNapredak(1, 'Slažem tekst…');
      const rj = await rjecnikP;
      const odlomci = slozi(rezultati.flat(), nacinRedaka(), rj);
      let promjene = [];
      if (rj) odlomci.forEach(o => { const r = rj.ispravi(o.t); o.t = r.tekst; promjene = promjene.concat(r.promjene); });
      el.tekst.value = odlomci.map(o => o.t).join('\n\n');
      st.izvori = odlomci.map(o => o.izvori);
      prikaziPromjene(promjene);
      osvjeziOznake();

      const pros = pouzdanosti.length ? Math.round(pouzdanosti.reduce((a, b) => a + b, 0) / pouzdanosti.length) : 0;
      el.pouzdanost.hidden = !pouzdanosti.length;
      el.pouzdanost.textContent = `Pouzdanost OCR-a ≈ ${pros} %`;
      el.pouzdanost.className = 'pilula' + (pros >= 85 ? ' ok' : pros < 65 ? ' greska' : '');
      el.rezultat.hidden = false;
      el.izvornikPlatno.hidden = true;
      el.izvornikPoruka.hidden = false;
      el.izvornikOpis.textContent = '';
      sinkronizirajStil();
      const sek = Math.round((performance.now() - t0) / 1000);
      postaviNapredak(1, odlomci.length
        ? `Gotovo za ${sek} s: ${odlomci.length} ${mn(odlomci.length, 'odlomak', 'odlomka', 'odlomaka')}` + (promjene.length ? `, rječnik je ispravio ${promjene.length} ${mn(promjene.length, 'riječ', 'riječi', 'riječi')}.` : '.')
        : 'Na skenu nije pronađen tekst.');
      el.rezultat.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      el.status.textContent = 'Prepoznavanje nije uspjelo: ' + (e?.message || e);
      await ugasiRadnike();
    } finally {
      st.radi = false;
      $('#predlozi').disabled = false;
      osvjeziPopis();
    }
  });

  // ---------- urednik: označavanje riječi u tekstu ----------
  const RIJEC = /[\p{L}\d]+(?:[-'’][\p{L}\d]+)*/gu;
  const jeSlijepljena = w => w.replace(/[^\p{L}]/gu, '').length >= 16;

  function vrstaRijeci(w) {
    if (jeSlijepljena(w)) return 'slijepljena';
    if (st.rjecnik && $('#rjecnik').checked && $('#jezik').value.includes('hrv') && st.rjecnik.nepoznata(w)) return 'nepoznata';
    if (st.slabe.has(w.toLowerCase())) return 'slaba';
    return '';
  }

  function osvjeziOznake() {
    const v = el.tekst.value;
    let html = '', zadnji = 0;
    const zaProvjeru = new Map();
    for (const m of v.matchAll(RIJEC)) {
      const vrsta = vrstaRijeci(m[0]);
      if (!vrsta) continue;
      html += esc(v.slice(zadnji, m.index)) + `<mark class="${vrsta}">${esc(m[0])}</mark>`;
      zadnji = m.index + m[0].length;
      if (vrsta !== 'slaba' && !zaProvjeru.has(m[0])) zaProvjeru.set(m[0], vrsta);
    }
    el.pozadina.innerHTML = html + esc(v.slice(zadnji)) + '\n ';
    el.pozadina.scrollTop = el.tekst.scrollTop;
    const popis = [...zaProvjeru].sort((a, b) => (a[1] === 'slijepljena' ? 0 : 1) - (b[1] === 'slijepljena' ? 0 : 1));
    $('#provjera').hidden = !popis.length;
    $('#provjeraPopis').innerHTML = popis.slice(0, 80).map(([w, vrsta]) => `<button type="button" class="${vrsta}" data-rijec="${esc(w)}">${esc(w)}</button>`).join('')
      + (popis.length > 80 ? `<small>… i još ${popis.length - 80}</small>` : '');
  }

  function prikaziPromjene(promjene) {
    $('#promjene').hidden = !promjene.length;
    $('#promjeneNaslov').textContent = `Rječnik je ispravio ${promjene.length} ${mn(promjene.length, 'riječ', 'riječi', 'riječi')}`;
    $('#promjenePopis').innerHTML = promjene.slice(0, 300).map(p => `<li><s>${esc(p.od)}</s> → ${esc(p.do)}</li>`).join('');
  }

  // pozadina s oznakama mora imati isti font, razmake i obrube kao textarea
  function sinkronizirajStil() {
    const cs = getComputedStyle(el.tekst);
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'borderRadius']) {
      el.pozadina.style[p] = cs[p];
    }
    el.pozadina.style.borderStyle = 'solid';
    el.pozadina.style.borderColor = 'transparent';
  }
  el.tekst.addEventListener('scroll', () => { el.pozadina.scrollTop = el.tekst.scrollTop; });
  new ResizeObserver(() => { el.pozadina.style.height = el.tekst.offsetHeight + 'px'; el.pozadina.scrollTop = el.tekst.scrollTop; }).observe(el.tekst);
  let tajmerOznaka;
  el.tekst.addEventListener('input', () => { clearTimeout(tajmerOznaka); tajmerOznaka = setTimeout(osvjeziOznake, 300); });

  $('#provjeraPopis').addEventListener('click', e => {
    const b = e.target.closest('[data-rijec]');
    if (!b) return;
    const w = b.dataset.rijec;
    const re = new RegExp(`(^|[^\\p{L}\\d])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'u');
    const m = el.tekst.value.match(re);
    if (!m) { osvjeziOznake(); return; }
    const i = m.index + m[1].length;
    el.tekst.focus();
    el.tekst.setSelectionRange(i, i + w.length);
    const prije = el.tekst.value.slice(0, i).split('\n').length, ukupno = el.tekst.value.split('\n').length;
    el.tekst.scrollTop = Math.max(0, el.tekst.scrollHeight * (prije / ukupno) - el.tekst.clientHeight / 3);
    prikaziIzvornik();
  });

  // ---------- izvornik: dio skena za odlomak u kojem je pokazivač ----------
  const izvornikPredmemorija = new Map(); // stranica -> Promise<canvas>, najviše 2
  function slikaZaIzvornik(s) {
    if (!izvornikPredmemorija.has(s)) {
      if (izvornikPredmemorija.size >= 2) {
        const [prvi] = izvornikPredmemorija.keys();
        izvornikPredmemorija.get(prvi).then(c => { c.width = c.height = 0; });
        izvornikPredmemorija.delete(prvi);
      }
      izvornikPredmemorija.set(s, iscrtaj(s, IZVORNIK_SIRINA));
    }
    return izvornikPredmemorija.get(s);
  }

  let zadnjiOdlomak = -1, tajmerIzvornika;
  async function prikaziIzvornik() {
    const pos = el.tekst.selectionStart;
    const idx = (el.tekst.value.slice(0, pos).match(/\n[ \t]*\n/g) || []).length;
    if (idx === zadnjiOdlomak && !el.izvornikPlatno.hidden) return;
    zadnjiOdlomak = idx;
    const izv = (st.izvori[idx] || []).filter(Boolean);
    if (!izv.length) {
      el.izvornikPlatno.hidden = true; el.izvornikPoruka.hidden = false;
      el.izvornikPoruka.textContent = st.izvori.length ? 'Za ovaj odlomak nema izvornika (dodan je ili premješten nakon prepoznavanja).' : 'Klikni u tekst i ovdje će se prikazati taj dio skena.';
      el.izvornikOpis.textContent = '';
      return;
    }
    const str = izv[0].str;
    const s = st.stranice[str];
    if (!s) return;
    const naStranici = izv.filter(b => b.str === str);
    const rub = 0.012;
    const u = naStranici.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }), { x0: 1, y0: 1, x1: 0, y1: 0 });
    const r = { x0: ogr(u.x0 - rub), y0: ogr(u.y0 - rub), x1: ogr(u.x1 + rub), y1: ogr(u.y1 + rub) };
    const izvor = await slikaZaIzvornik(s);
    if (zadnjiOdlomak !== idx) return;
    const sx = r.x0 * izvor.width, sy = r.y0 * izvor.height, sw = Math.max(1, (r.x1 - r.x0) * izvor.width), sh = Math.max(1, (r.y1 - r.y0) * izvor.height);
    const maxV = 900;
    const mj = Math.min(1, maxV / sh, 1100 / sw);
    const c = el.izvornikPlatno;
    c.width = Math.round(sw * mj); c.height = Math.round(sh * mj);
    const ctx = c.getContext('2d');
    ctx.drawImage(izvor, sx, sy, sw, sh, 0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(255, 214, 0, .22)';
    for (const b of naStranici) ctx.fillRect((b.x0 * izvor.width - sx) * mj, (b.y0 * izvor.height - sy) * mj, (b.x1 - b.x0) * izvor.width * mj, (b.y1 - b.y0) * izvor.height * mj);
    c.hidden = false; el.izvornikPoruka.hidden = true;
    el.izvornikOpis.textContent = `odlomak ${idx + 1} · ${st.stranice.length > 1 ? s.ime : 'stranica'}`;
  }
  const zakaziIzvornik = () => { clearTimeout(tajmerIzvornika); tajmerIzvornika = setTimeout(prikaziIzvornik, 120); };
  ['click', 'keyup', 'select', 'focus'].forEach(t => el.tekst.addEventListener(t, zakaziIzvornik));

  // ---------- izvoz u Word (.docx) ----------
  const xml = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function jePodnaslov(o) {
    if (o.includes('\n') || o.length > 70 || o.length < 3) return false;
    if (/^[–—-]\s/.test(o)) return false;
    if (/(\.\.\.|…)$/.test(o)) return o.length <= 50;
    return !/[.,;:!?"”]$/.test(o) && /[A-Za-zČĆŽŠĐčćžšđ]/.test(o);
  }

  async function napraviDocx(tekst, podnaslovi, naslov) {
    const odlomci = tekst.replace(/\r/g, '').split(/\n\s*\n/).map(o => o.trim()).filter(Boolean);
    const zadrzaniRetci = nacinRedaka() === 'retci';
    const tijelo = odlomci.map(o => {
      const naslovni = podnaslovi && jePodnaslov(o);
      const retci = o.split('\n').map(r => `<w:t xml:space="preserve">${xml(r)}</w:t>`).join('<w:br/>');
      const pPr = naslovni ? '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>' : (zadrzaniRetci ? '' : '<w:pPr><w:jc w:val="both"/></w:pPr>');
      return `<w:p>${pPr}<w:r>${retci}</w:r></w:p>`;
    }).join('');

    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const dokument = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${tijelo || '<w:p/>'}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1247" w:bottom="1134" w:left="1247" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const stilovi = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="hr-HR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="16305C"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
</w:styles>`;
    const sada = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.file('word/document.xml', dokument);
    zip.file('word/styles.xml', stilovi);
    zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(naslov)}</dc:title><dc:language>hr-HR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${sada}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${sada}</dcterms:modified></cp:coreProperties>`);
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  $('#preuzmi').addEventListener('click', async () => {
    const tekst = el.tekst.value.trim();
    if (!tekst) { obavijest('Nema teksta za spremanje.'); return; }
    let ime = (el.imeDocx.value.trim() || 'tekst').replace(/[\\/:*?"<>|]+/g, '-');
    if (!/\.docx$/i.test(ime)) ime += '.docx';
    const blob = await napraviDocx(tekst, $('#podnaslovi').checked, ime.replace(/\.docx$/i, ''));
    spremi(blob, ime);
    obavijest('Word datoteka je spremljena.');
  });
  $('#kopiraj').addEventListener('click', () => {
    const tekst = el.tekst.value.trim();
    if (tekst) kopiraj(tekst, 'Tekst je kopiran.');
  });

  osvjeziRaspored();
})();
