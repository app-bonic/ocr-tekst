/* Hrvatski rječnik (hunspell hr_HR, LGPL/SISSL) — mala provjera riječi bez vanjskih biblioteka.
   Rječnik hr_HR ima samo sufikse (bez prefiksa i višerazinskih pravila), pa je provjera:
   odreži mogući nastavak, vrati "strip" i pogledaj ima li osnova tu zastavicu.
   Radi i u pregledniku (window.Rjecnik) i u Nodeu (module.exports) radi testiranja. */
(function (izvoz) {
  'use strict';

  function ucitaj(affTekst, dicTekst) {
    const aliasi = [];          // AF n -> popis zastavica
    const pravila = new Map();  // nastavak (add) -> [{ zast, strip, uvjet }]
    let dugeZastavice = false, maxNastavak = 0;
    let potrebanNastavak = null, zabranjena = null;

    const retci = affTekst.split(/\r?\n/);
    for (let i = 0; i < retci.length; i++) {
      const r = retci[i].replace(/\s+#.*$/, '').trim();
      if (!r || r[0] === '#') continue;
      const d = r.split(/\s+/);
      if (d[0] === 'FLAG' && d[1] === 'long') dugeZastavice = true;
      else if (d[0] === 'NEEDAFFIX') potrebanNastavak = d[1];
      else if (d[0] === 'FORBIDDENWORD') zabranjena = d[1];
      else if (d[0] === 'AF' && d.length === 2 && /^\d+$/.test(d[1]) && !aliasi.length) aliasi.push(null); // zaglavlje: broj aliasa
      else if (d[0] === 'AF' && aliasi.length) aliasi.push(d[1]);
      else if (d[0] === 'SFX' && d.length >= 5 && !/^[YN]$/.test(d[2])) {
        const [, zast, strip, addPun, uvjet = '.'] = d;
        const add = addPun.split('/')[0];
        const nastavak = add === '0' ? '' : add.toLowerCase();
        const s = strip === '0' ? '' : strip.toLowerCase();
        const re = uvjet === '.' ? null : new RegExp('(?:' + uvjet.toLowerCase() + ')$', 'u');
        if (!pravila.has(nastavak)) pravila.set(nastavak, []);
        pravila.get(nastavak).push({ zast, strip: s, uvjet: re });
        maxNastavak = Math.max(maxNastavak, nastavak.length);
      }
    }

    const razbij = z => {
      if (/^\d+$/.test(z) && aliasi.length) z = aliasi[+z] || '';
      if (!dugeZastavice) return z.split('');
      const o = [];
      for (let i = 0; i < z.length; i += 2) o.push(z.slice(i, i + 2));
      return o;
    };

    const osnove = new Map(); // osnova (mala slova) -> Set zastavica ('' = sama riječ dopuštena)
    const dic = dicTekst.split(/\r?\n/);
    for (let i = 1; i < dic.length; i++) {
      const red = dic[i].trim();
      if (!red) continue;
      const kosa = red.indexOf('/');
      const rijec = (kosa < 0 ? red : red.slice(0, kosa)).toLowerCase();
      const zast = kosa < 0 ? [] : razbij(red.slice(kosa + 1).split(/\s/)[0]);
      if (zabranjena && zast.includes(zabranjena)) continue;
      let skup = osnove.get(rijec);
      if (!skup) osnove.set(rijec, skup = new Set());
      zast.forEach(z => skup.add(z));
      if (!potrebanNastavak || !zast.includes(potrebanNastavak)) skup.add('');
    }

    const predmemorija = new Map();
    function poznata(rijecUlaz) {
      const w = rijecUlaz.toLowerCase();
      if (!w) return false;
      const p = predmemorija.get(w);
      if (p !== undefined) return p;
      let ok = false;
      const s0 = osnove.get(w);
      if (s0 && s0.has('')) ok = true;
      for (let k = Math.min(maxNastavak, w.length); !ok && k >= 0; k--) {
        const lista = pravila.get(w.slice(w.length - k));
        if (!lista) continue;
        const korijen = w.slice(0, w.length - k);
        for (const pr of lista) {
          const osn = korijen + pr.strip;
          const sk = osnove.get(osn);
          if (sk && sk.has(pr.zast) && (!pr.uvjet || pr.uvjet.test(osn))) { ok = true; break; }
        }
      }
      if (predmemorija.size > 50000) predmemorija.clear();
      predmemorija.set(w, ok);
      return ok;
    }

    return Object.assign(ispravljac(poznata), { poznata, brojOsnova: osnove.size, brojPravila: [...pravila.values()].reduce((n, l) => n + l.length, 0) });
  }

  // ---------- ispravci tipičnih OCR grešaka ----------
  const ZAMJENE = { c: ['č', 'ć'], č: ['ć', 'c'], ć: ['č', 'c'], s: ['š'], š: ['s'], z: ['ž'], ž: ['z'], d: ['đ'], đ: ['d'] };
  const SAMOSTALNA_SLOVA = new Set(['a', 'i', 'u', 'o', 's', 'k', 'v', 'z']);
  // pri razdvajanju slijepljenih riječi dijelovi od 2–3 slova smiju biti samo ove česte riječi
  // (inače se nepoznate stručne riječi raspadnu na komadiće: "rea ni mato logi je")
  const KRATKE = new Set(('je se su da na za od do po ne ni li bi te ti mi vi on ona ono oni one što kao ali već još pa tu taj ' +
    'ta to iz uz pri niz sve svi bez ima bio sam smo ste će ću oko kod nad pod put dan rad dio sat tko kad sad ako jer ili čak baš ' +
    'tek ga mu ih im me ju joj nas vas ja sa ka koj nam vam njoj tom toj tim kojoj ovo ova ovaj ovi taj tih sto dva tri pet šest ' +
    'god dok čim pak niti nju njih').split(' '));
  const PREFIKSI = new Set('pod nad naj pred pre pro raz bez iz od do na za po pri su uz ne ni sa protu među izvan'.split(' '));
  const ZNAKOVI_RUBA = /^([„"“”'‘’(«»\[–—…*]*)(.*?)([„"“”'‘’)»\]…,.;:!?*]*)$/su;
  const VELIKO = /^\p{Lu}/u;

  function ispravljac(poznata) {
    const poznataDio = d => {
      const m = d.toLowerCase();
      if (m.length === 1) return SAMOSTALNA_SLOVA.has(m);
      if (m.length <= 3) return KRATKE.has(m);
      return poznata(m);
    };

    // c/č/ć, s/š, z/ž, d/đ: najviše 3 zamjene; prihvati samo jedinstvenog najboljeg kandidata
    function kvacice(w) {
      const mala = w.toLowerCase();
      const poz = [];
      for (let i = 0; i < mala.length; i++) if (ZAMJENE[mala[i]]) poz.push(i);
      if (!poz.length || poz.length > 9) return null;
      for (let broj = 1; broj <= Math.min(3, poz.length); broj++) {
        const nadjeni = new Set();
        const podskup = (od, izabrani) => {
          if (izabrani.length === broj) {
            const kombinacije = izabrani.reduce((acc, p) => acc.flatMap(niz => ZAMJENE[mala[p]].map(z => { const n = niz.slice(); n[p] = z; return n; })), [mala.split('')]);
            kombinacije.forEach(k => { const s = k.join(''); if (poznata(s)) nadjeni.add(s); });
            return;
          }
          for (let i = od; i < poz.length; i++) podskup(i + 1, [...izabrani, poz[i]]);
        };
        podskup(0, []);
        if (nadjeni.size === 1) {
          const [s] = nadjeni;
          return [...s].map((ch, i) => w[i] !== w[i].toLowerCase() ? ch.toUpperCase() : ch).join('');
        }
        if (nadjeni.size > 1) return null; // dvosmisleno — ne diraj
      }
      return null;
    }

    // slijepljene riječi: najmanji broj poznatih dijelova; na početku smije biti nepoznato ime (veliko slovo)
    function razdvoji(w) {
      const n = w.length;
      if (n < 4 || n > 45 || /\p{Lu}/u.test(w.slice(1))) return null;
      const najbolje = new Array(n + 1).fill(Infinity), dalje = new Array(n + 1).fill(-1);
      najbolje[n] = 0;
      for (let i = n - 1; i >= 0; i--) {
        for (let j = Math.min(n, i + 25); j > i; j--) {
          if (najbolje[j] === Infinity) continue;
          const d = w.slice(i, j);
          if (!poznataDio(d)) continue;
          const c = 1 + najbolje[j] + (d.length === 1 ? 0.6 : 0);
          if (c < najbolje[i]) { najbolje[i] = c; dalje[i] = j; }
        }
      }
      const slozi = pocetak => { const dijelovi = []; for (let i = pocetak; i < n; i = dalje[i]) dijelovi.push(w.slice(i, dalje[i])); return dijelovi; };
      let dijelovi = null;
      if (najbolje[0] !== Infinity && dalje[0] !== n) dijelovi = slozi(0);
      else if (VELIKO.test(w)) {
        // npr. "Bujevićnijeizravno" -> "Bujević" + "nije izravno"
        // ime ne smije završavati poznatom riječi ("Bujevićnije" + "izravno" je krivo)
        const zavrsavaRijecju = ime => { for (let k = 3; k <= ime.length - 2; k++) if (poznataDio(ime.slice(-k))) return true; return false; };
        // najkraće ime iza kojeg ostatak čine poznate riječi
        let izbor = null;
        for (let j = 3; j <= n - 2 && !izbor; j++) {
          if (najbolje[j] === Infinity || zavrsavaRijecju(w.slice(0, j))) continue;
          izbor = { j };
        }
        if (izbor) dijelovi = [w.slice(0, izbor.j), ...slozi(izbor.j)];
      }
      if (!dijelovi || dijelovi.length < 2 || dijelovi.length > 5) return null;
      if (dijelovi.filter(d => d.length === 1).length > 2) return null;
      // imena: "Dar k o", "Sala pića" — prvi dio imena mora biti dulji
      if (VELIKO.test(w) && dijelovi[0].length < 5) return null;
      // jednoslovni dijelovi: ne na kraju, ne dva zaredom, na početku samo a/i/u/o ("s lizati" je krivo)
      for (let k = 0; k < dijelovi.length; k++) {
        if (dijelovi[k].length !== 1) continue;
        if (k === dijelovi.length - 1 || dijelovi[k + 1]?.length === 1) return null;
        if (k === 0 && !'aiuo'.includes(dijelovi[0].toLowerCase())) return null;
      }
      // složenice s prefiksom kojih nema u rječniku: "pod zakonskom", "naj bolji"
      if (dijelovi.length === 2 && PREFIKSI.has(dijelovi[0].toLowerCase()) && dijelovi[1].length >= 4) return null;
      return dijelovi.join(' ');
    }

    function ispraviDio(dio) {
      if (dio.length < 2 || !/\p{L}/u.test(dio) || /\d/.test(dio) || poznata(dio)) return dio;
      if (/^\p{Lu}+$/u.test(dio) && dio.length <= 6) return dio; // kratice
      return kvacice(dio) || razdvoji(dio) || dio;
    }

    function ispraviJezgru(j) {
      if (!j || poznata(j)) return j;
      // razmak nakon interpunkcije unutar slijepljene riječi: "godine,aveć7.svibnja"
      let r = j
        .replace(/(\p{L})([,;!?])(?=[\p{L}„"])/gu, '$1$2 ')
        .replace(/(\p{Ll})\.(?=\p{Lu})/gu, '$1. ')
        .replace(/(\d)\.(?=\p{L}{2,})/gu, '$1. ')
        .replace(/(\p{Ll}{3,})(\d)/gu, '$1 $2');
      if (r !== j) return r.split(' ').map(t => ispraviRijec(t)).join(' ');
      return j.split('-').map(ispraviDio).join('-');
    }

    function ispraviRijec(t) {
      const m = t.match(ZNAKOVI_RUBA);
      if (!m) return t;
      return m[1] + ispraviJezgru(m[2]) + m[3];
    }

    // vraća { tekst, promjene: [{ od, do }] }
    function ispravi(tekst) {
      const promjene = [];
      const novi = tekst.replace(/\S+/g, t => {
        const r = ispraviRijec(t);
        if (r !== t) promjene.push({ od: t, do: r });
        return r;
      });
      return { tekst: novi, promjene };
    }

    // riječi malim slovom kojih nema u rječniku (imena s velikim slovom se preskaču)
    function nepoznata(rijec) {
      if (rijec.length < 3 || VELIKO.test(rijec) || /\d/.test(rijec)) return false;
      return rijec.split('-').some(d => d.length >= 2 && !poznata(d));
    }

    return { ispravi, nepoznata, kvacice, razdvoji };
  }

  izvoz.Rjecnik = { ucitaj };
})(typeof module !== 'undefined' ? module.exports : window);
