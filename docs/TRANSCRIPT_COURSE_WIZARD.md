# Transkript-Kurs-Wizard

## Vertrag

Der Wizard arbeitet ausschliesslich auf einem bereits validierten,
versionierten Video-Transkript des aktuellen Kursblocks. Er erzeugt direkt
hinter diesem Block einen oder mehrere redaktionell pruefbare Entwurfsbloecke.
Mandant, Kurs, Shared-Module-Recht, Quellblock und Sortierreihenfolge werden in
derselben Datenbanktransaktion erneut geprueft und gesperrt.

Unterstuetzte Operationen:

- Zusammenfassung
- Einfachauswahl
- Wahr/Falsch
- Mehrfachauswahl
- Lueckentext
- chronologische Sortierung
- gemischter Durchgang mit allen sechs Ergebnistypen

## Grounding

Zusammenfassung und Lueckentext verwenden ausschliesslich gespeicherte
Transkriptpassagen. Die drei Fragetypen pruefen die direkte Reihenfolge
eindeutiger Transkriptsegmente; Antwortoptionen und Feedback werden aus diesen
Segmenten abgeleitet. Die Sortieraufgabe verwendet die gespeicherten
Zeitmarken. Der deterministische lokale Pfad sendet keine Transkriptdaten an
einen externen KI-Provider und erfindet keine freien Loesungsschluessel.

Der allgemeine KI-Kursgenerator bleibt ein getrennter Workflow. Ist ein
OpenAI-kompatibler Provider konfiguriert, unterliegt er weiterhin dessen
Provider-, Datenschutz- und Betriebsabnahme; ohne Provider verwendet er den
lokalisierten deterministischen Kursentwurf.

Vor einem produktiven Rollout prueft
`npm run ai:course-provider:preflight` mit einem kompakten, nicht
persistierten Testentwurf den konfigurierten OpenAI-kompatiblen Endpoint, das
Modell und den strikten Kursentwurf-Responsevertrag. Ein lokaler Fallback gilt
in diesem Befehl als Fehler. Agentenantworten und Kursentwuerfe teilen denselben
persistenten Circuit-Breaker, damit wiederholte Providerausfaelle den externen
Dienst nicht weiter belasten.
