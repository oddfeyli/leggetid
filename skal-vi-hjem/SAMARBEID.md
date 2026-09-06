# Skal vi hjem? – felles kvelder

## Status 6. september 2026

Supabase-prosjektet `skal-vi-hjem` (`gmuupsahnfoooiinpwfs`) kjører i Stockholm (`eu-north-1`) på eksisterende gratisplan. Database, RLS og Realtime er installert. Anonymous Sign-Ins er aktivert og bekreftet gjennom faktisk innlogging med separate identiteter. Klientkonfigurasjonen inneholder bare prosjekt-URL og offentlig publishable key.

Kjørte migreringer: `svh_collaboration_initial` og `svh_strict_payloads`. `collaboration.sql` er det samlede oppsettet for en ny database; ikke kjør det om igjen i det eksisterende prosjektet.

Live-testene fant at Realtime kunne koble til før brukerens JWT var satt. `connect()` venter nå på `db.realtime.setAuth(session.access_token)` før kanalen opprettes. Kontrollert feilsøking viste at dette rettet manglende PostgreSQL-varsler uten å gi den utloggede rollen lesetilgang.

Alle 16 live-testpunkter bestod 6. september 2026. Samarbeidsmodus er publisert på GitHub Pages via sammenslått PR #3. Pages-bygget fullførte uten feil. Lokalmodus og beregningsfilene `app-1.js`, `app-2.js` og `app-3.js` er bevart. En tydelig lenke fra lokalappen åpner `sammen.html`, som gjenbruker den opprinnelige modellen uten å kjøre lokal-lagringskoden.

## Implementert i kode

- Verten oppretter en kveld og deler en invitasjonslenke med 192-bits tilfeldig hemmelighet i URL-fragmentet. Databasen lagrer bare SHA-256-hashen. Lenken er en adgangsbillett; alle som får den kan bli med.
- Anonym Supabase Auth-identitet per nettleser. Ett deltakerkort per identitet per kveld. Gjentatt innmelding gir ikke et nytt kort. Ny enhet eller slettede nettleserdata gir ny identitet; det er ikke laget kontogjenoppretting.
- Deltakeren endrer eget navn, alder, trøtthet, dansevilje og pensjoniststatus. Bare verten kan endre fellesinnstillinger, skifte invitasjonslenke og slette hele kvelden.
- «Jeg har gått hjem» tar deltakeren ut av gruppedommen; «Jeg er tilbake» tar vedkommende inn igjen. Mobilens skjermlås eller frakobling teller ikke som avreise.
- Feltvise endringer og serielle skriv per kveld i databasen. Supabase Realtime varsler om romrevisjoner, deretter henter klienten et konsistent øyeblikksbilde. Reservemodus kontrollerer hvert 15. sekund. Feilede nettverksskriv ligger i fanens minne, merkes som usynkroniserte og forsøkes på nytt. De må ikke omtales som lagret før serveren bekrefter.
- Felles serverklokke i Europe/Oslo eller vertens simulerte klokke. Formelen, pensjonistparagrafen og humormerkingen er videreført.

## Aktivering etter tilkobling

1. Velg/opprett et separat Supabase-prosjekt uten å endre abonnement eller pådra nye kostnader uten godkjenning. Kontroller at prosjektet er aktivt.
2. Kjør `collaboration.sql` én gang som databaseeier. Migreringen oppretter egne tabeller, funksjoner og tilgangsregler; den endrer ikke globale standardrettigheter. `pgcrypto` forventes i `extensions`-skjemaet, slik et vanlig Supabase-prosjekt bruker. Bekreft at bare `svh_rooms` er lagt til Realtime-publikasjonen for denne appen. Ikke eksponer `svh_private` i Data API.
3. Aktiver Anonymous Sign-Ins. Vurder tjenestens rate limits og beskyttelse mot automatisert misbruk. Denne klienten sender foreløpig ikke CAPTCHA-token; CAPTCHA krever egen frontend-integrasjon før innstillingen aktiveres. Grensen på tre aktive kvelder per identitet erstatter ikke anti-bot-beskyttelse.
4. Sett prosjekt-URL og **publishable key** i `collaboration-config.js`. Aldri legg service-role-nøkkel, secret key, databasepassord eller personlige tokens i HTML/JS/repoet. `enabled` skal forbli `false` frem til testene nedenfor er bestått.
5. Test med faktiske separate Auth-brukere: opprett/join, samtidige endringer, gjeninnmelding, mobil i bakgrunnen, nettverksbrudd, innstillingsdeling, klokke og fysisk sletting av rommets data.
6. Kjør negative tilgangstester mot Data API: utlogget bruker kan ikke lese/skrive; fremmed autentisert bruker kan ikke lese et rom; deltaker kan ikke endre andres kort, host_id eller innstillinger; direkte tabellskriv avvises; feil/rotert invitasjon avvises; rommene er isolert; utløpte rom avvises; ugyldige tall, datoer, datatyper og ekstra felt avvises. Test også Realtime-filtreringen med en ikke-deltaker.
7. Bekreft CDN-pakken og lastingen i Edge og iOS Safari, eventuelt legg klientbiblioteket lokalt med bevart lisens og kontrollsum. Koden bruker en fast Supabase JS-versjon, ikke flytende `@2`.
8. Sett `enabled: true`, slå sammen grenen og legg en inngang til `sammen.html` fra originalappen. Kontroller den publiserte GitHub Pages-siden i to reelle nettlesere før funksjonen omtales som aktiv.

## Lagring og sletting

Rom utløper etter 48 timer. Dette sperrer tilgang, men **sletter ikke fysisk data**. Verten kan slette rommet og alle deltakerkortene via en eksplisitt, bekreftet handling. Databaseeier kan dessuten sette opp en separat planlagt opprydding med `delete from public.svh_rooms where expires_at < now();`. Ingen slik jobb er opprettet nå. Anonyme Auth-brukere har separat levetid og må håndteres separat. Ikke lov automatisk fysisk sletting før oppryddingen faktisk er konfigurert og testet.

Supabase lagrer samarbeidsdata; jsDelivr leverer klientbiblioteket ved tilkobling. Original lokalmodus kontakter ingen av disse. `sammen.html` med deaktivert konfigurasjon sender heller ingen forespørsler til Supabase eller CDN.

## Teststatus

**Live-resultat 6. september 2026: 16 bestått, 0 feilet.** Testen brukte tre ulike ekte anonyme Auth-identiteter og faktiske WebSocket-kanaler. Samtidige feltendringer ble bevart, begge deltakere mottok revisjoner, og en utenforstående mottok ingen beskyttede romdata. Både direkte skriving, fremmede rom, ugyldige verdier, ekstra felt og gamle invitasjoner ble avvist. Vertsstyrte innstillinger, gjeninnmelding, avreise/retur, gjenoppkobling og sletting bestod.

JavaScript-syntakskontroll er bestått. Sju frontend-sjekker er kjørt i headless Chromium med to separate nettleserkontekster og en kontrollert **simulert** database/sanntidskanal: deaktivert konfigurasjon, delt manntall og UI-rettigheter, samtidige endringer og lik gruppedom, avreise/retur, ny sending etter feil, gjeninntreden med samme testidentitet samt mobilbredde uten JavaScript-feil.

**Kontrollert i Supabase:** begge migreringene kjørte uten feil; alle tre tabeller har RLS; rom og medlemmer har medlemsavgrensede SELECT-policyer; bare `public.svh_rooms` ligger i Realtime-publikasjonen. Den private invitasjonstabellen har ingen klienttilgang. Security Advisor viser forventede merknader om medlemsavgrensede policyer som tillater anonyme Auth-brukere, samt RLS uten direkte lesepolicy på `svh_private.invites`. Passordlekkasjebeskyttelse er ikke aktivert; appen bruker ikke passordinnlogging. Den oppdaterte RPC-funksjonen er lest tilbake og samsvarer med lokal SQL. Alle 13 direkte PostgreSQL-tester av deltakerverdier bestod.

**Ekte tjenestetest:** `../tests/skal-vi-hjem-live.mjs` bruker tre separate anonyme Auth-identiteter og bare den offentlige klientnøkkelen. Den kontrollerer samtidige feltendringer, vertstilgang, direkte skrivesperrer, romisolasjon, ugyldige verdier/ekstra felt, invitasjonsrotering, faktisk Realtime over WebSocket, gjenoppkobling og romsletting. Testen sletter sine egne testrom og logger ut testidentitetene. En valgfri rapport (`SVH_REPORT_PATH=/tmp/svh-live-report.json`) gir rom- og bruker-ID-er for databaseeierens etterkontroll; tokens og invitasjoner logges ikke. Anonyme Auth-kontoer må ryddes separat av eieren.

**Bestått utløpstest i PostgreSQL:** `../tests/skal-vi-hjem-expiry.sql` oppretter midlertidige vert-/gjest-fixtures i én transaksjon. Begge har tilgang før utløp; deretter skjuler RLS rom og medlemmer for begge, og alle seks `state`/`me`/`join`-forsøk avvises med `P0002`. Testen bruker database-rollen `authenticated` med syntetiske JWT-claims, ikke ekte Auth-pålogging. Alt ble rullet tilbake; null fixture-brukere og null fixture-rom gjenstod.

**Nettleseromfang:** den automatiserte live-testen bruker separate Supabase JS-klienter i Node med ekte Auth og WebSocket, ikke separate nettleserprosesser. Den publiserte brukerflyten er kontrollert i Chrome med en annen samtidig testklient: invitasjon, innmelding, eget redigerbart kort, låst vertskort, sanntidsvarsler, avreise/retur og gjeninntreden uten duplikat bestod. Nettleserens gruppeindeks 65,0 samsvarte med en separat kjøring av den uendrede modellen. Ingen JavaScript-feil fra appen ble registrert. Invitasjoner åpnet i en allerede åpen fane håndteres også ved fragmentendring. Edge og fysisk iOS Safari er ikke tilgjengelige i testmiljøet. Den eldre `../tests/skal-vi-hjem-browser.py` bruker separate Chromium-kontekster med simulert backend; den er ikke bevis på databasesikkerhet.

## Referanser for oppsettet

- https://supabase.com/docs/guides/auth/auth-anonymous
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/realtime/postgres-changes
- https://supabase.com/docs/guides/database/secure-data
