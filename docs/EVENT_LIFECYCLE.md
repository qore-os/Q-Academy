# Event-Lifecycle

## Zustaende und Transitionen

- Neue Events starten als `scheduled` mit Lifecycle-Revision `0`.
- Eine Absage wechselt `scheduled -> cancelled` und ist ohne Neuplanung nicht
  wiederholbar.
- Eine Neuplanung aendert den Zeitraum und setzt auch ein abgesagtes Event
  wieder auf `scheduled`.
- Jede Transition erfordert einen Grund, erhoeht die Revision genau einmal und
  speichert vorherigen sowie neuen Zeitraum unveraenderlich in
  `event_lifecycle_history`.

## Nebenwirkungen

Die Event-Zeile, Historie, Activity-Audit, In-App-Benachrichtigungen,
verschluesselte E-Mail-Outbox und Webhook-Outbox werden in derselben
PostgreSQL-Transaktion geschrieben. Empfaenger sind ausschliesslich aktive
Mitglieder des Mandanten, die zum Transitionszeitpunkt ueber die Event-Zielgruppe
berechtigt sind.

Abgesagte Events sperren RSVP-Aenderungen und Meeting-Einstieg. Der ICS-Export
bleibt zum Aktualisieren externer Kalender verfuegbar und liefert
`METHOD:CANCEL`, `STATUS:CANCELLED` sowie die aktuelle `SEQUENCE`.

## Schnittstellen

- Admin-UI: `/admin/events`, Bereich `Status & Planung`
- Mitglieder-UI: `/academy/events`
- REST: `GET|PATCH /api/v1/events/{id}/lifecycle`
