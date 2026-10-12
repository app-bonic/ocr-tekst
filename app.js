/* OCR – tekst iz skena: Tesseract.js (lokalno, lib/tesseract) + slaganje odlomaka + izvoz u .docx (JSZip). */
(() => {
  'use strict';
  const { $, $$, esc, obavijest, spremi, kopiraj, dropzona, lokalno, mn } = AB;

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  // Tesseract radnik se pokreće iz blob: adrese, pa putanje moraju biti apsolutne
  const aps = p => new URL(p, location.href).href;

  const OCR_DPI = 300;          // razlučivost za prepoznavanje
  const MAX_STRANA = 5000;      // najveća dimenzija slike za OCR (memorija)
  const PREGLED_SIRINA = 1400;  // slika za označavanje stupaca

  const st = {
    stranice: [],   // { ime, tip: 'pdf'|'slika', pdf, br, datoteka, palac, regije: [{x0,y0,x1,y1}] u 0..1 }
    aktivna: 0,
    radi: false,
    radnik: null,
    jezikRadnika: '',
  };

  const el = {
    popis: $('#popis'), info: $('#info'), prepoznaj: $('#prepoznaj'), napredak: $('#napredak'), status: $('#status'),
    oznacavanje: $('#oznacavanje'), pregledSlika: $('#pregledSlika'), platno: $('#platno'), brStranice: $('#brStranice'),
    rezultat: $('#rezultat'), tekst: $('#tekst'), pouzdanost: $('#pouzdanost'), imeDocx: $('#imeDocx'),
  };

  const raspored = () => $('input[name="raspored"]:checked').value;
  const nacinRedaka = () => $('input[name="retci"]:checked').value;

  // ---------- postavke (pamte se u pregledniku) ----------
  const spremljeno = lokalno.uzmi('ocr-tekst-postavke', {});
  if (spremljeno.jezik) $('#jezik').value = spremljeno.jezik;
  if (spremljeno.raspored) { const r = $(`input[name="raspored"][value="${spremljeno.raspored}"]`); if (r) r.checked = true; }
  if (spremljeno.retci) { const r = $(`input[name="retci"][value="${spremljeno.retci}"]`); if (r) r.checked = true; }
  if (typeof spremljeno.podnaslovi === 'boolean') $('#podnaslovi').checked = spremljeno.podnaslovi;
  function spremiPostavke() {
    lokalno.stavi('ocr-tekst-postavke', { jezik: $('#jezik').value, raspored: raspored(), retci: nacinRedaka(), podnaslovi: $('#podnaslovi').checked });
  }

  const OPISI = {
    auto: 'Alat sam traži stupce i blokove teksta. Dobro za većinu dokumenata.',
    jedan: 'Cijela stranica je jedan stupac teksta (dopis, ugovor, stranica knjige).',
    rucno: 'Ti označiš stupce redom čitanja. Najbolje za novine i časopise.',
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
  $('#podnaslovi').addEventListener('change', spremiPostavke);

  // ---------- učitavanje datoteka ----------
  dropzona($('#drop'), dodajDatoteke, { accept: 'application/pdf,image/*', visestruko: true });

  async function dodajDatoteke(datoteke) {
    for (const f of datoteke) {
      try {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
          for (let i = 1; i <= pdf.numPages; i++) {
            const s = { ime: pdf.numPages > 1 ? `${f.name} – str. ${i}` : f.name, tip: 'pdf', pdf, br: i, regije: [] };
            s.palac = await palac(await iscrtaj(s, 260));
            st.stranice.push(s);
            osvjeziPopis();
          }
        } else if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)) {
          const s = { ime: f.name, tip: 'slika', datoteka: f, regije: [] };
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

  // Iscrtava stranicu u canvas; sirina = ciljna širina (pregled) ili null za OCR razlučivost
  async function iscrtaj(s, sirina = null) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', { willReadFrequently: false });
    if (s.tip === 'pdf') {
      const str = await s.pdf.getPage(s.br);
      const v1 = str.getViewport({ scale: 1 });
      let mj = sirina ? sirina / v1.width : OCR_DPI / 72;
      mj = Math.min(mj, MAX_STRANA / Math.max(v1.width, v1.height));
      const v = str.getViewport({ scale: mj });
      c.width = Math.round(v.width); c.height = Math.round(v.height);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await str.render({ canvasContext: ctx, viewport: v }).promise;
    } else {
      const bmp = await createImageBitmap(s.datoteka, { imageOrientation: 'from-image' });
      let mj;
      if (sirina) mj = sirina / bmp.width;
      else {
        const vece = Math.max(bmp.width, bmp.height);
        mj = vece < 1800 ? 2 : 1;                       // male slike povećaj, OCR voli veća slova
        mj = Math.min(mj, MAX_STRANA / vece);
      }
      c.width = Math.round(bmp.width * mj); c.height = Math.round(bmp.height * mj);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
    }
    return c;
  }

  const palac = c => new Promise(r => c.toBlob(b => r(URL.createObjectURL(b)), 'image/jpeg', 0.8));

  function osvjeziPopis() {
    const n = st.stranice.length;
    el.prepoznaj.disabled = !n || st.radi;
    el.info.textContent = n ? `${n} ${mn(n, 'stranica', 'stranice', 'stranica')} za prepoznavanje.` : '';
    if (st.aktivna >= n) st.aktivna = Math.max(0, n - 1);
    const rucno = raspored() === 'rucno';
    el.popis.innerHTML = st.stranice.map((s, i) => `<div class="sl" data-i="${i}" ${rucno && i === st.aktivna ? 'aria-current="true"' : ''} title="${esc(s.ime)}">
        <div class="okvir"><img src="${s.palac}" alt=""></div>
        <span class="ime">${esc(s.ime)}</span>
        ${rucno && s.regije.length ? `<span class="pilula br-regija">${s.regije.length}</span>` : ''}
        <button type="button" class="makni" data-makni="${i}" aria-label="Makni ${esc(s.ime)}">${AB.ikona('x')}</button>
      </div>`).join('');
  }

  el.popis.addEventListener('click', e => {
    const m = e.target.closest('[data-makni]');
    if (m) {
      if (st.radi) return;
      const i = +m.dataset.makni;
      URL.revokeObjectURL(st.stranice[i].palac);
      st.stranice.splice(i, 1);
      osvjeziPopis(); osvjeziRaspored();
      return;
    }
    const sl = e.target.closest('.sl');
    if (sl && raspored() === 'rucno') { st.aktivna = +sl.dataset.i; osvjeziPopis(); prikaziPregled(); el.oznacavanje.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

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

  function crtajRegije(privremena = null) {
    const s = st.stranice[st.aktivna];
    const c = el.platno, img = el.pregledSlika;
    const dpr = window.devicePixelRatio || 1;
    const w = img.clientWidth, h = img.clientHeight;
    if (!w || !h) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const svi = [...(s?.regije || [])];
    svi.forEach((r, i) => {
      const x = r.x0 * w, y = r.y0 * h, rw = (r.x1 - r.x0) * w, rh = (r.y1 - r.y0) * h;
      ctx.fillStyle = 'rgba(212, 42, 52, .12)'; ctx.fillRect(x, y, rw, rh);
      ctx.strokeStyle = '#d42a34'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.strokeRect(x, y, rw, rh);
      const rr = 13;
      ctx.fillStyle = '#16305c'; ctx.beginPath(); ctx.arc(x + rr + 3, y + rr + 3, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 14px "Nunito Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x + rr + 3, y + rr + 4);
    });
    if (privremena) {
      const r = normaliziraj(privremena);
      ctx.strokeStyle = '#16305c'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x0 * w, r.y0 * h, (r.x1 - r.x0) * w, (r.y1 - r.y0) * h);
    }
  }

  const normaliziraj = r => ({ x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) });
  const ogr = v => Math.min(1, Math.max(0, v));

  let vucem = null;
  function tocka(e) {
    const b = el.platno.getBoundingClientRect();
    return { x: ogr((e.clientX - b.left) / b.width), y: ogr((e.clientY - b.top) / b.height) };
  }
  el.platno.addEventListener('pointerdown', e => {
    if (!st.stranice[st.aktivna]) return;
    el.platno.setPointerCapture(e.pointerId);
    const p = tocka(e);
    vucem = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  });
  el.platno.addEventListener('pointermove', e => {
    if (!vucem) return;
    const p = tocka(e);
    vucem.x1 = p.x; vucem.y1 = p.y;
    crtajRegije(vucem);
  });
  const zavrsiVucenje = () => {
    if (!vucem) return;
    const r = normaliziraj(vucem);
    vucem = null;
    if (r.x1 - r.x0 > 0.02 && r.y1 - r.y0 > 0.01) {
      st.stranice[st.aktivna].regije.push(r);
      osvjeziPopis();
    }
    crtajRegije();
  };
  el.platno.addEventListener('pointerup', zavrsiVucenje);
  el.platno.addEventListener('pointercancel', () => { vucem = null; crtajRegije(); });
  window.addEventListener('resize', () => { if (!el.oznacavanje.hidden) crtajRegije(); });

  $('#ponisti').addEventListener('click', () => { st.stranice[st.aktivna]?.regije.pop(); osvjeziPopis(); crtajRegije(); });
  $('#ocisti').addEventListener('click', () => { const s = st.stranice[st.aktivna]; if (s) s.regije = []; osvjeziPopis(); crtajRegije(); });
  $('#naSve').addEventListener('click', () => {
    const izvor = st.stranice[st.aktivna];
    if (!izvor?.regije.length) { obavijest('Prvo označi stupce na ovoj stranici.'); return; }
    st.stranice.forEach(s => { if (s !== izvor) s.regije = izvor.regije.map(r => ({ ...r })); });
    osvjeziPopis();
    obavijest('Oznake su kopirane na sve stranice.');
  });
  $('#prethodna').addEventListener('click', () => { if (st.aktivna > 0) { st.aktivna--; osvjeziPopis(); prikaziPregled(); } });
  $('#sljedeca').addEventListener('click', () => { if (st.aktivna < st.stranice.length - 1) { st.aktivna++; osvjeziPopis(); prikaziPregled(); } });

  // ---------- OCR ----------
  const STATUSI = {
    'loading tesseract core': 'Učitavam OCR jezgru…',
    'initializing tesseract': 'Pokrećem OCR…',
    'initialized tesseract': 'OCR je spreman.',
    'loading language traineddata': 'Učitavam jezik…',
    'loaded language traineddata': 'Jezik je učitan.',
    'initializing api': 'Pripremam prepoznavanje…',
    'initialized api': 'Pripremam prepoznavanje…',
    'recognizing text': 'Prepoznajem tekst…',
  };
  let posao = { gotovo: 0, ukupno: 1, opis: '' };
  function postaviNapredak(udio, tekst) {
    el.napredak.hidden = false;
    el.napredak.firstElementChild.style.width = Math.round(Math.min(1, Math.max(0, udio)) * 100) + '%';
    if (tekst) el.status.textContent = tekst;
  }
  function logger(m) {
    if (m.status === 'recognizing text') postaviNapredak((posao.gotovo + (m.progress || 0)) / posao.ukupno, posao.opis);
    else if (STATUSI[m.status]) el.status.textContent = STATUSI[m.status];
  }

  async function radnik(jezik) {
    if (st.radnik && st.jezikRadnika === jezik) return st.radnik;
    if (st.radnik) { await st.radnik.terminate(); st.radnik = null; }
    st.radnik = await Tesseract.createWorker(jezik, 1, {
      workerPath: aps('lib/tesseract/worker.min.js'),
      corePath: aps('lib/tesseract/'),
      langPath: aps('lib/tesseract/lang'),
      logger,
    });
    st.jezikRadnika = jezik;
    return st.radnik;
  }

  // Izreže dio canvasa (r u 0..1) uz mali rub
  function izrezi(c, r) {
    const x0 = Math.floor(r.x0 * c.width), y0 = Math.floor(r.y0 * c.height);
    const w = Math.max(1, Math.ceil((r.x1 - r.x0) * c.width)), h = Math.max(1, Math.ceil((r.y1 - r.y0) * c.height));
    const rub = 12;
    const o = document.createElement('canvas');
    o.width = w + rub * 2; o.height = h + rub * 2;
    const ctx = o.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, o.width, o.height);
    ctx.drawImage(c, x0, y0, w, h, rub, rub, w, h);
    return o;
  }

  // Iz Tesseract rezultata vadi retke s položajem unutar bloka
  function retciIzRezultata(data) {
    const izlaz = [];
    for (const b of data.blocks || []) {
      const bw = Math.max(1, b.bbox.x1 - b.bbox.x0);
      let prviUBloku = true;
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) {
          const t = (l.text || '').replace(/\s+/g, ' ').trim();
          if (!t) continue;
          // šum: okomite crte stupaca, pojedinačni znakovi niske pouzdanosti
          if (/^[|¦!:;.,'"`´\-–—_~]+$/.test(t)) continue;
          if (t.length <= 2 && l.confidence < 45) continue;
          izlaz.push({
            t, x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1,
            lijevo: b.bbox.x0, desno: b.bbox.x1, sirina: bw, noviBlok: prviUBloku,
          });
          prviUBloku = false;
        }
      }
    }
    return izlaz;
  }

  const ZAVRSNI = /[.!?:"”“»…)]$/;
  const CRTICA_DIJALOG = /^[–—-]\s/;
  const RASTAVLJENO = /[A-Za-zČĆŽŠĐčćžšđ][-¬­]$/;

  function ocistiRedak(t) {
    return t.replace(/^[|¦]\s*/, '').replace(/\s*[|¦]$/, '').replace(/\s+/g, ' ').trim();
  }

  // Slaže retke u odlomke (prazan redak između) ili zadržava retke
  function slozi(retci, nacin) {
    const odlomci = [];
    let cur = '', prev = null;
    const zatvori = () => { if (cur.trim()) odlomci.push(cur.trim()); cur = ''; };
    for (const l of retci) {
      let t = ocistiRedak(l.t);
      if (!t) continue;
      const dijalog = CRTICA_DIJALOG.test(t);
      if (dijalog) t = '– ' + t.replace(/^[–—-]\s*/, '');
      const visina = Math.max(8, l.y1 - l.y0);
      const razmak = prev && !l.noviBlok && (l.y0 - prev.y1) > visina * 0.9;

      if (nacin === 'retci') {
        if (prev && (l.noviBlok || razmak)) zatvori();
        cur = cur ? cur + '\n' + t : t;
        prev = l;
        continue;
      }

      if (cur) {
        const prevT = cur;
        const kraj = ZAVRSNI.test(prevT);
        const kratak = prev && prev.x1 < prev.desno - prev.sirina * 0.15;
        let novi = false;
        if (dijalog || razmak) novi = true;
        else if (kraj && (kratak || l.noviBlok)) novi = true;
        else if (prev && !kraj && kratak && !RASTAVLJENO.test(prevT) && /^[A-ZČĆŽŠĐ0-9„"]/.test(t) && prevT.length < 80) novi = true; // kratki naslov bez točke
        if (novi) zatvori();
      }

      if (!cur) cur = t;
      else if (RASTAVLJENO.test(cur)) {
        const baza = cur.slice(0, -1);
        cur = /^[a-zčćžšđ]/.test(t) ? baza + t : baza + '-' + t;
      } else cur += ' ' + t;
      prev = l;
    }
    zatvori();
    return odlomci;
  }

  el.prepoznaj.addEventListener('click', async () => {
    if (st.radi || !st.stranice.length) return;
    st.radi = true;
    el.prepoznaj.disabled = true;
    $$('.makni').forEach(b => { b.disabled = true; });
    const jezik = $('#jezik').value;
    const nacin = raspored();
    const t0 = performance.now();
    try {
      postaviNapredak(0, 'Pokrećem OCR…');
      const w = await radnik(jezik);
      // broj poslova (regija) radi trake napretka
      posao.ukupno = st.stranice.reduce((n, s) => n + (nacin === 'rucno' && s.regije.length ? s.regije.length : 1), 0);
      posao.gotovo = 0;
      const sviRetci = [];
      const pouzdanosti = [];
      for (let i = 0; i < st.stranice.length; i++) {
        const s = st.stranice[i];
        const opisStr = st.stranice.length > 1 ? `Stranica ${i + 1} od ${st.stranice.length}` : 'Prepoznajem tekst';
        posao.opis = opisStr + '…';
        postaviNapredak(posao.gotovo / posao.ukupno, 'Pripremam ' + (st.stranice.length > 1 ? `stranicu ${i + 1}…` : 'stranicu…'));
        const c = await iscrtaj(s);
        const regije = nacin === 'rucno' && s.regije.length ? s.regije : [null];
        for (let j = 0; j < regije.length; j++) {
          const r = regije[j];
          if (regije.length > 1) posao.opis = `${opisStr}, stupac ${j + 1} od ${regije.length}…`;
          const slika = r ? izrezi(c, r) : c;
          const psm = r || nacin === 'jedan' ? '4' : '3';
          await w.setParameters({ tessedit_pageseg_mode: psm });
          const { data } = await w.recognize(slika, { rotateAuto: true }, { text: true, blocks: true });
          const retci = retciIzRezultata(data);
          if (retci.length) retci[0].noviBlok = true;
          // u ručnom načinu cijela regija je jedan stupac: sve retke računaj prema širini regije
          if (r) {
            const lijevo = Math.min(...retci.map(x => x.x0)), desno = Math.max(...retci.map(x => x.x1));
            retci.forEach((x, k) => { x.lijevo = lijevo; x.desno = desno; x.sirina = Math.max(1, desno - lijevo); if (k) x.noviBlok = false; });
          }
          sviRetci.push(...retci);
          if (data.confidence) pouzdanosti.push(data.confidence);
          posao.gotovo++;
        }
        c.width = c.height = 0; // oslobodi memoriju
      }
      const odlomci = slozi(sviRetci, nacinRedaka());
      el.tekst.value = odlomci.join('\n\n');
      const pros = pouzdanosti.length ? Math.round(pouzdanosti.reduce((a, b) => a + b, 0) / pouzdanosti.length) : 0;
      el.pouzdanost.textContent = `Pouzdanost OCR-a ≈ ${pros} %`;
      el.pouzdanost.className = 'pilula' + (pros >= 85 ? ' ok' : pros < 65 ? ' greska' : '');
      el.rezultat.hidden = false;
      const sek = Math.round((performance.now() - t0) / 1000);
      postaviNapredak(1, odlomci.length
        ? `Gotovo za ${sek} s: ${odlomci.length} ${mn(odlomci.length, 'odlomak', 'odlomka', 'odlomaka')}.`
        : 'Na skenu nije pronađen tekst.');
      el.rezultat.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      el.status.textContent = 'Prepoznavanje nije uspjelo: ' + (e?.message || e);
      if (st.radnik) { try { await st.radnik.terminate(); } catch { /* već ugašen */ } st.radnik = null; }
    } finally {
      st.radi = false;
      osvjeziPopis();
    }
  });

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
