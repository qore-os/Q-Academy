# Web-Wissensquellen fuer KI-Agenten

## Lebenszyklus

Eine `web_url`-Quelle wird ausschliesslich beim Speichern eines bearbeitbaren
Agentenentwurfs abgerufen. Gespeichert werden die kanonische Quell-URL, ein
lesbarer Text-Snapshot, der abgeleitete Titel, der SHA-256-Digest des Textes und
der Abrufzeitpunkt. Eine Veroeffentlichung kopiert exakt diesen vorhandenen
Snapshot in die publizierte Version und den neuen Folgeentwurf.

Der Datenbank-Schutz fuer Agentenversionen blockiert anschliessend Update,
Delete und Truncate der publizierten Quelle. Rollback zeigt deshalb wieder den
historischen Snapshot. Vorschau und Chat lesen nur `ai_agent_version_sources`;
es gibt dort keinen HTTP-Aufruf und keine automatische Aktualisierung.

## Netzwerkgrenzen

- nur `https:` auf Port 443, hoechstens 2048 URL-Zeichen
- keine URL-Zugangsdaten und keine Weiterleitungen
- DNS-Aufloesung maximal 2 Sekunden; jede Antwort muss Public Unicast sein
- eine gepruefte Adresse wird per `lookup` an eine neue TLS-Verbindung gepinnt
- kein Cookie-, Authorization- oder sonstiger Credential-Header
- absoluter Abruf-Timeout von 7 Sekunden
- nur `text/html` oder `text/plain` in UTF-8
- nur unkomprimierte Antworten bis 512 KiB
- hoechstens 200.000 lesbare Zeichen und zehn Webquellen je Agent

HTML wird mit `parse5` strukturell verarbeitet. Script, Style, Template,
Embedded Content, Navigation, Footer, Formulare, Inputs und versteckte Bereiche
werden verworfen. Attribute und Links werden nicht in den Snapshot uebernommen.

## Audit und Betrieb

`agent.draft.updated` und `agent.version.published` enthalten die Anzahl der
Webquellen und die sortierten Snapshot-Digests, aber weder Quelltext noch URL.
Fehler beim DNS-, TLS-, Typ-, Encoding-, Groessen- oder Inhaltscheck lassen den
Save mit `422 validation_error` geschlossen scheitern.

Vor Kundenbetrieb sind DNS- und TLS-Verhalten aus dem Rootserver-Netz, Egress-
Firewall, Proxyfreiheit und Alarmierung fuer wiederholt fehlschlagende Quellen
abzunehmen. Eine Aktualisierung erfolgt bewusst nur durch erneutes Speichern des
Entwurfs.
