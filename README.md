# Min filmsamling – iPhone-version

Version 1.2 er optimeret til iPhone og kan installeres som en app fra Safari.

## Funktioner

- Lokal filmsamling på iPhone
- Automatisk gemning af film og kladder
- Live-scanning med iPhones bagkamera
- Foto-scanning som reserve, hvis livekameraet ikke starter
- Manuel stregkode og manuel filmregistrering
- Egne coverfotos
- TMDB-opslag efter titel
- Backup, import, CSV og udskrift/PDF
- Kan bruges offline efter første indlæsning

## Sådan får du den på iPhone

Appen skal ligge på en HTTPS-adresse. Den nemmeste metode er Netlify Drop:

1. Byg appen med `npm run build`, eller brug ZIP-filen mærket "klar til iPhone-hosting".
2. Pak ZIP-filen ud på en Mac eller pc.
3. Åbn Netlify Drop i browseren.
4. Træk hele den udpakkede mappe ind på siden.
5. Netlify viser en HTTPS-adresse.
6. Åbn adressen i Safari på iPhone.
7. Tryk Del → Føj til hjemmeskærm → Tilføj.

## Kamera på iPhone

Livekamera kræver HTTPS og kameratilladelse. Hvis livekameraet ikke starter fra hjemmeskærmsversionen, vælg "Tag foto af stregkoden" i scanneren.

## Udvikling

```bash
npm install
npm run dev
```

Produktionsbygning:

```bash
npm run build
```
