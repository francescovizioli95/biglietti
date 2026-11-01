# Biglietti — PWA per biglietti da visita

App web installabile (Android/Chrome), tutto in locale, zero costi.

- Rubrica: foto del biglietto → lettura automatica (Tesseract.js sul telefono, ita+eng) → nome, azienda, ruolo, telefoni, email, sito, indirizzo, con la foto accanto.
- Scansione rapida: fotocamera dentro l'app, un tocco per biglietto, lettura in coda in background, tag evento.
- Correzione: tocca una riga letta per assegnarla a un campo. Avviso duplicati.
- Esporta: vCard (rubrica telefono), CSV (Excel), backup JSON.
- Il mio biglietto: generatore con 6 stili, QR vCard, schermata QR a tutto schermo, condivisione PNG + vcf.
- Offline: service worker con cache di app e OCR.

Pubblicazione: qualsiasi hosting statico HTTPS (es. GitHub Pages). Nessun build.
Test locale: `python3 -m http.server` e apri http://localhost:8000
