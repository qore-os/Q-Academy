# KI-Agentenaktionen

## Sicherheitsmodell

Q-Academy behandelt eine Agentenantwort niemals als Berechtigung, Daten zu
veraendern. Eine Aktion besteht aus einer versionierten, von einem Owner oder
Admin veroeffentlichten Konfiguration und einer separaten Mitgliederanfrage.
Freigegeben sind `course_enrollment` zum Erteilen von Kurszugriff und
`course_unenrollment` zum Entfernen direkter Kursfreigaben. Zusaetzlich stehen
`group_membership_add`, `group_membership_remove`, `bundle_assignment_add` und
`bundle_assignment_remove` als jeweils eigene, typisierte Aktionen bereit.

Der Ablauf ist fest:

1. Ein Admin konfiguriert typisiertes Kurs-, Gruppen- oder Bundle-Ziel,
   Beschriftung und Beschreibung im Entwurf.
2. Publish versiegelt die Aktion zusammen mit der Agentenversion.
3. Ein berechtigtes Mitglied erzeugt hoechstens eine offene Anfrage je Aktion.
4. Ein Owner oder Admin genehmigt oder lehnt mit erwarteter Revision ab.
5. Nur eine Genehmigung schreibt die typisierte Zugriffsveraenderung, Status,
   Audit-Ereignis und Webhook-Outbox atomar in derselben Transaktion.

`course_unenrollment` entfernt nur direkte Grants (`direct:*` und
`ai_action:*`). Gruppen- und Bundle-Grants bleiben erhalten; der effektive
Enrollment-Status wird in derselben Transaktion aus allen verbleibenden Grants
neu berechnet.

Gruppen- und Bundle-Zuweisungen erzeugen nur dann eine Provenance-Zeile, wenn
die zugrunde liegende Mitgliedschaft in derselben Genehmigung neu angelegt
wurde. Eine bereits vorhandene manuelle oder externe Zuweisung wird weder
uebernommen noch als KI-Herkunft markiert. Eine Remove-Aktion sperrt
Mitgliedschaft und Provenance und darf nur entfernen, wenn Tenant, Mitglied,
Ziel und Agent exakt mit einer aktiven KI-Herkunft uebereinstimmen. Eine
spaetere manuelle Zuweisung uebernimmt die bestehende Mitgliedschaft und
beendet die KI-Provenance als `manual_takeover`; danach kann der Agent sie
nicht mehr entfernen. Commerce- und sonstige Zuweisungen besitzen keine
KI-Provenance und sind daher ebenfalls nicht entziehbar.

Es gibt keinen allgemeinen Tool-Call, keine Auswertung freien Modelltexts und
keine automatische Genehmigung. Weitere Aktionstypen benoetigen jeweils ein
eigenes Schema, eine eigene serverseitige Ausfuehrung und separate Tests.

## Integritaet und Parallelitaet

- Request-Payloads tragen einen SHA-256-Digest ueber Tenant, Agent, Version,
  Konfiguration, Mitglied, Aktionstyp, Zieltyp, exakte Ziel-ID und Label.
- Vorhandene Kursanfragen mit Payload-Schema 1 bleiben verifizierbar; neue
  Anfragen verwenden Schema 2 mit typisiertem Ziel.
- Ein Datenbank-Trigger macht diese Felder nach dem Insert unveraenderlich.
- Jede Transition erhoeht `revision` exakt um eins.
- Ein partieller Unique-Index erlaubt nur eine offene Anfrage pro Mitglied und
  Konfiguration.
- Advisory Lock und bedingtes Update serialisieren parallele Requests.
- Ereignisse sind per Trigger append-only; Update, Delete und Truncate werden
  abgewiesen.
- Ablaufende Anfragen werden vom Scheduler auf `expired` gesetzt.

## Schnittstellen

Browser-Sitzungen verwenden die same-origin-geschuetzten Endpunkte unter
`/api/ai/actions`. Die versionierte REST-API stellt bereit:

- `GET /api/v1/agent-actions`
- `POST /api/v1/agent-actions`
- `POST /api/v1/agent-actions/{id}/decision`
- `GET /api/v1/agent-actions/{id}/events`

REST-Mutationen benoetigen den Agent-Schreibscope, einen Idempotency-Key und
einen API-Key, der einem aktiven Owner oder Admin gehoert. Die Ereignisantwort
enthaelt keine Actor-Pseudonyme, Payload-Digests oder freie Audit-Metadaten.
Listen-, Request- und Webhook-Projektionen liefern das Ziel als
`{ type: "course" | "group" | "bundle", id }`; die Admin-Liste ergaenzt den
tenantgebunden aufgeloesten Zielnamen.

## Webhook-Ereignisse

- `agent.action.requested`
- `agent.action.approved`
- `agent.action.rejected`
- `agent.action.cancelled`
- `agent.action.expired`

Payloads enthalten die sichere Request-Projektion, aber keine Prompts,
Nachrichteninhalte, E-Mail-Adressen oder internen Audit-Digests.

## Betrieb

Der normale Scheduler-Dispatch verarbeitet auch abgelaufene Aktionsanfragen.
Alarme fuer einen ausgefallenen Scheduler werden ueber die Worker-Heartbeat-
Metriken ausgeloest. Vor einer Kundenfreigabe muessen REST-Idempotenz,
Webhook-Zustellung, Scheduler-Expiry und Adminentscheidungen unter realer
Mehrreplika-Last abgenommen werden.
