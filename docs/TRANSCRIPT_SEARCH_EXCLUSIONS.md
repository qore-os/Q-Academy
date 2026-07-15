# Transkript-Suchausschluesse

Die tenantweite Konfiguration liegt ohne eigene Migration in
`platform_settings` unter dem Schluessel `transcripts`:

```json
{ "excludedSearchTerms": ["interne roadmap", "ki"] }
```

Fehlende oder malforme Altdaten werden als leere Liste gelesen. Die Admin-UI
und `GET/PATCH /api/v1/organization/transcript-search` verwenden dieselbe
strikte Validierung. Der allgemeine Organization-PATCH darf diesen reservierten
Schluessel nicht umgehen.

## Suchregel

Eingaben werden mit NFKD normalisiert, Unicode-Kombinationszeichen entfernt,
in `de-DE` kleingeschrieben und auf Unicode-Buchstaben, Ziffern und einzelne
Leerzeichen reduziert. Regulare Ausdruecke werden weder gespeichert noch
ausgewertet. Es gelten maximal 100 Eintraege, 160 Rohzeichen beziehungsweise
120 normalisierte Zeichen und 12 Tokens pro Phrase.

Eine Anfrage wird vollstaendig unterdrueckt, wenn ihre Tokenfolge ein
konfiguriertes Wort oder eine konfigurierte zusammenhaengende Phrase enthaelt.
`ki` sperrt deshalb `KI Grundlagen`, nicht aber `Kinder`. `interne roadmap`
sperrt `unsere interne Roadmap`, nicht aber `interne neue Roadmap`. Eine andere
Anfrage darf weiterhin Treffersegmente anzeigen, die solche Begriffe enthalten;
Transkript und WebVTT-Untertitel werden nie veraendert.

Materielle Aenderungen erzeugen `platform.transcript_search.updated` ohne die
Inhalte der Sperrliste im Audit-Metadatum. API-Mutationen unterstuetzen den
zentralen Idempotency-Key-Vertrag und sind an die Organisation des API-Schluessels
gebunden.
