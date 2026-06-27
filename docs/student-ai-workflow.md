# Elevarbeidsmetode for AI-assistert utvikling i CoinPulse

## Formål

Denne arbeidsmetoden forklarer hvordan elever skal bruke AI som en kontrollert samarbeidspartner i CoinPulse-prosjektet.

AI-en skal ikke arbeide som en autonom utvikler. Den skal hjelpe eleven med å forstå prosjektet, avgrense oppgaver, foreslå små endringer og kontrollere resultatet.

Målet er høy kvalitet gjennom små, etterprøvbare steg som eleven kan forstå, kontrollere og forklare.

## Grunnregler

- Arbeid med én oppgave om gangen.
- Ikke utvid oppgaven uten eksplisitt godkjenning fra eleven eller lærer.
- Ikke gjør antakelser når informasjon mangler.
- Forklar planen før større endringer utføres.
- Prioriter kvalitet, forståelse og verifisering fremfor hastighet.
- Stopp når en oppgave er ferdig, og vent på ny instruksjon.

## Standard arbeidsflyt

### 1. Les først

Start alltid med å undersøke prosjektet før kode eller dokumentasjon endres.

Eleven eller AI-en skal identifisere:

- relevante filer
- eksisterende løsninger
- avhengigheter
- prosjektregler som gjelder for oppgaven

Det skal ikke skrives kode i denne fasen.

### 2. Analyser

Beskriv kort:

- hva som ble funnet
- hvordan den aktuelle delen fungerer
- hvilke filer som er relevante
- risikoer, avhengigheter eller uklarheter

Analysen skal være kort nok til at eleven kan vurdere den før arbeidet fortsetter.

### 3. Avgrens arbeidet

Definer én konkret oppgave.

Hvis ønsket arbeid er stort, skal det deles opp i mindre oppgaver. AI-en skal anbefale den minste trygge oppgaven å starte med, men ikke starte neste oppgave automatisk.

### 4. Lag en kort plan

Planen skal beskrive:

- hvilke filer som skal endres
- hvorfor filene skal endres
- hva som bevisst ikke skal endres

Planen skal være konkret og begrenset til oppgaven.

### 5. Utfør oppgaven

Utfør bare det som er avtalt.

Ikke legg til ekstra forbedringer, ny funksjonalitet, refaktorering eller opprydding som ikke er del av oppgaven.

### 6. Kontroller resultatet

Etter endringen skal eleven eller AI-en kontrollere at:

- oppgaven er løst
- endringen ikke påvirker andre deler unødvendig
- ingen utilsiktede filer er endret
- relevante tester eller verifikasjoner er kjørt når det er mulig

### 7. Oppsummer og stopp

Avslutt med en kort oppsummering:

- hva som ble gjort
- hvilke filer som ble endret
- hvilke tester eller kontroller som ble kjørt
- hva som er neste naturlige steg

Ikke start neste steg automatisk.

## Sjekkliste for elev før AI får endre noe

Bruk denne sjekklisten før AI-en får skrive kode eller dokumentasjon:

- Jeg kan forklare hva oppgaven er.
- Oppgaven er liten nok til én kontrollert endring.
- AI-en har lest relevante filer først.
- AI-en har forklart hva den fant.
- AI-en har foreslått en kort plan.
- Jeg forstår hvilke filer som skal endres.
- Jeg vet hva som ikke skal endres.

Hvis ett punkt ikke er oppfylt, skal eleven stoppe og be om avklaring.

## Sjekkliste for elev etter endring

Bruk denne sjekklisten før arbeidet regnes som ferdig:

- Endringen løser den avtalte oppgaven.
- Det er ikke gjort ekstra endringer uten avtale.
- Endrede filer er gjennomgått.
- Tester eller relevante kontroller er kjørt, eller det er forklart hvorfor de ikke kunne kjøres.
- Resultatet er oppsummert på en måte eleven kan forklare videre.
- Neste steg er foreslått, men ikke startet.

## Promptmal for elever

Elever kan bruke denne malen når de ber AI om hjelp:

```text
Du er en samarbeidspartner, ikke en autonom utvikler.

Oppgave:
[Beskriv én konkret oppgave]

Arbeidsmetode:
1. Les relevante filer først uten å endre noe.
2. Forklar kort hva du fant.
3. Avgrens oppgaven til minste trygge endring.
4. Lag en kort plan og vent på bekreftelse hvis endringen er større enn enkel dokumentasjon.
5. Utfør bare avtalt arbeid.
6. Kontroller resultatet.
7. Oppsummer hva som ble gjort, hvilke filer som ble endret, og neste naturlige steg.

Ikke utvid oppgaven uten eksplisitt tillatelse.
```

## Hva AI-en ikke skal gjøre

AI-en skal ikke:

- endre flere områder enn nødvendig
- innføre nye biblioteker uten eksplisitt beskjed
- refaktorere kode uten at det er avtalt
- gjette brukerens intensjon
- implementere fremtidige funksjoner for sikkerhets skyld
- starte neste oppgave automatisk etter ferdig arbeid

## Lærerens kontrollpunkter

Lærer bør kontrollere at eleven kan svare på:

- Hva var oppgaven?
- Hvilke filer ble lest før endring?
- Hvorfor ble akkurat disse filene endret?
- Hvilke deler av prosjektet ble bevisst ikke endret?
- Hvordan ble resultatet kontrollert?
- Hva er neste naturlige, avgrensede oppgave?

## Bruk i CoinPulse

Denne metoden er en generell elevvennlig arbeidsform for CoinPulse. Den erstatter ikke prosjektets eksisterende arkitekturregler, testkrav eller grenregler.

Når en oppgave berører CoinPulse-arkitektur, frontend-data, backend-kontrakter, Prisma-skjema, API-er eller produksjonslogikk, skal prosjektets egne regler og verifikasjonskrav fortsatt følges.
