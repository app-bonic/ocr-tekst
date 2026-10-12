# OCR – tekst iz skena

Prepoznaj tekst sa skena, PDF-a ili fotografije (hrvatski i engleski), označi stupce novina i preuzmi kao Word .docx.

**Stranica:** https://app-bonic.github.io/ocr-tekst/

## Kako radi
- Ubaci PDF (i s više stranica) ili slike (JPG, PNG, WEBP). Stranicu snimljenu postrance okreneš gumbom za 90°.
- PDF koji već sadrži tekst (nije sken) čita se izravno, bez OCR-a, pa je 100 % točan.
- Raspored: **Automatski**, **Jedan stupac** ili **Ručno označi stupce**. Za novine klikni **Predloži stupce**, pa oznake popravi: pomakni ih, promijeni im veličinu, redoslijed ili ih obriši.
- Više stranica i stupaca prepoznaje se paralelno (do 3 radnika, ovisno o računalu).
- **Hrvatski rječnik** (hunspell hr_HR) ispravlja kvačice (c/č/ć, s/š, z/ž, d/đ) i razdvaja slijepljene riječi. Nepoznate riječi, moguće slijepljene riječi i riječi za koje OCR nije siguran obojane su u tekstu.
- Klik u tekst prikaže pripadni dio skena, pa ispravljaš gledajući original.
- **Preuzmi .docx** napravi Word dokument (A4, Calibri, podnaslovi kao „Naslov 2”).

## Privatnost
Alat radi u potpunosti u pregledniku. Ništa od onoga što upišeš ili učitaš ne šalje se na poslužitelj, nema kolačića ni analitike — pogodno za rad s osobnim podacima (GDPR). Sve biblioteke su u mapi `lib/`, uključujući OCR jezgru i jezične podatke, pa stranica ne kontaktira ni vanjske CDN-ove.

## Biblioteke
- [Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 i tesseract.js-core 7.0.0 (Apache 2.0), jezični podaci `hrv` i `eng` (4.0.0_best_int)
- Hrvatski rječnik hr_HR (OpenOffice/LibreOffice, LGPL/SISSL) u `lib/rjecnik/`, provjera riječi vlastitim kodom (`rjecnik.js`)
- pdf.js (Apache 2.0), JSZip (MIT)

Dio zbirke [app-bonic alati](https://app-bonic.github.io/alati/).
