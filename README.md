# OCR – tekst iz skena

Prepoznaj tekst sa skena, PDF-a ili fotografije (hrvatski i engleski), označi stupce novina i preuzmi kao Word .docx.

**Stranica:** https://app-bonic.github.io/ocr-tekst/

## Kako radi
- Ubaci PDF (i s više stranica) ili slike (JPG, PNG, WEBP).
- Raspored: **Automatski**, **Jedan stupac** ili **Ručno označi stupce**. U ručnom načinu povlačiš pravokutnike preko stupaca redom čitanja, što je najbolje za novine.
- Tekst se složi u odlomke, a riječi rastavljene na kraju retka se spoje. Prije preuzimanja ga možeš ispraviti.
- **Preuzmi .docx** napravi Word dokument (A4, Calibri, podnaslovi kao „Naslov 2”).

## Privatnost
Alat radi u potpunosti u pregledniku. Ništa od onoga što upišeš ili učitaš ne šalje se na poslužitelj, nema kolačića ni analitike — pogodno za rad s osobnim podacima (GDPR). Sve biblioteke su u mapi `lib/`, uključujući OCR jezgru i jezične podatke, pa stranica ne kontaktira ni vanjske CDN-ove.

## Biblioteke
- [Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 i tesseract.js-core 7.0.0 (Apache 2.0), jezični podaci `hrv` i `eng` (4.0.0_best_int)
- pdf.js (Apache 2.0), JSZip (MIT)

Dio zbirke [app-bonic alati](https://app-bonic.github.io/alati/).
