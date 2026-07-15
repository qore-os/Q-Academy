# Q-Academy Mail-Gateway-Vertrag

Q-Academy sendet Transaktionsmails nicht direkt per SMTP. Der persistente Worker
ruft ein separates HTTPS-Gateway auf, das Provider und Versanddomain kapselt.
Tenantvorlagen werden spaetestens vor dem ersten Gateway-Aufruf in Q-Academy
gerendert und als unveraenderlicher, verschluesselter Delivery-Snapshot
gespeichert.

Outbox, Worker, Inbound-Signaturpruefung und Sperrlogik sind Bestandteil der
Anwendung. Auswahl und Einrichtung des realen Mailproviders, Versanddomain,
DNS-Authentifizierung und externe Zustell-/Lastabnahme bleiben Betriebs-Gates.

## Request

- Methode: `POST`
- URL: `EMAIL_DELIVERY_WEBHOOK_URL`
- Authentifizierung: `Authorization: Bearer <EMAIL_DELIVERY_WEBHOOK_SECRET>`
- Idempotenz: `Idempotency-Key: <email-delivery-uuid>`
- Timeout der Q-Academy-Seite: 10 Sekunden
- Content-Type: `application/json`

```json
{
  "event": "invitation.created",
  "email": "recipient@example.com",
  "subject": "Deine Einladung zu Example Academy",
  "message": "Hallo Mara, ...",
  "html": "<p>Hallo Mara, ...</p>",
  "link": "https://academy.example.com/invitations/invite_SECRET",
  "tenantBranding": {
    "organizationId": "00000000-0000-0000-0000-000000000000",
    "name": "Example GmbH",
    "platformName": "Example Academy",
    "primaryColor": "#17324d",
    "accentColor": "#2bb7a9",
    "logoUrl": "https://cdn.example.com/logo.png",
    "locale": "de"
  }
}
```

Feedback-Antworten verwenden denselben authentifizierten Endpunkt. Sie
enthalten bewusst keinen frei uebergebenen Empfaenger, sondern die in der
tenantgebundenen Outbox gespeicherte E-Mail des aktiven Mitglieds:

```json
{
  "event": "feedback.reply",
  "email": "mitglied@example.com",
  "subject": "Rueckmeldung zu deinem Feedback",
  "message": "Danke fuer deinen Hinweis.",
  "html": "<p>Danke fuer deinen Hinweis.</p>",
  "tenantBranding": {
    "organizationId": "...",
    "name": "Beispiel Academy",
    "platformName": "Beispiel Academy",
    "primaryColor": "#17324d",
    "accentColor": "#2bb7a9",
    "logoUrl": null,
    "locale": "de"
  }
}
```

Modulfreigaben senden ebenfalls nur die gerenderten Zustellfelder an das
Gateway. Die intern validierten Kurs-, Versions- und Modul-IDs sind nicht Teil
des Requests:

```json
{
  "event": "course.modules.released",
  "email": "mitglied@example.com",
  "subject": "Neue Module in Sicher lernen",
  "message": "Hallo Mara, ...",
  "html": "<p>Hallo Mara, ...</p>",
  "link": "https://academy.example.com/academy/courses/sicher-lernen",
  "tenantBranding": {
    "organizationId": "...",
    "name": "Beispiel Academy",
    "platformName": "Beispiel Academy",
    "primaryColor": "#17324d",
    "accentColor": "#2bb7a9",
    "logoUrl": null,
    "locale": "de"
  }
}
```

Unterstuetzte Events:

- `invitation.created`: tenantweite Plaintext-Vorlage mit sieben Tagen
  Linkgueltigkeit
- `password.reset`: tenantweite Plaintext-Vorlage mit 30 Minuten
  Linkgueltigkeit
- `feedback.reply`: direkte Antwort eines Teammitglieds auf Kursfeedback
- `lesson.available`: einmalige Freigabeinformation fuer eine abonnierte Lektion mit `subject`, `message` und absolutem `link`
- `course.modules.released`: einmalige Freigabeinformation fuer neue Kursmodule mit gerendertem Inhalt und absolutem Kurslink
- `event.rescheduled`: einmalige Information ueber ein neu geplantes Event
- `event.cancelled`: einmalige Information ueber ein abgesagtes Event
- `email.template.test`: sichere Testsendung einer gespeicherten Vorlage an den
  aktiven Owner/Admin, der sie ausgeloest hat

Fuer sechs der sieben produktiven Events sowie `email.template.test` ist `html`
optional; bei `course.modules.released` gehoert es zum unveraenderlichen
Snapshot. Falls es vorhanden ist, muss es exakt aus `message` erzeugt sein:
Text wird HTML-escaped, Leerzeilen werden zu Absaetzen und einfache Zeilenumbrueche
zu `<br>`. Frei eingegebenes Admin-HTML wird weder gespeichert noch versendet.

Mitglieder steuern im eigenen Profil E-Mail-Zustellung fuer Lernen, Events,
Feedback, Community und Ankuendigungen. Fehlende Praeferenzzeilen sind
abwaertskompatibel aktiv. Die Outbox speichert die klassifizierte Kategorie;
der Worker prueft die tenantgebundene Praeferenz nach dem Claim und vor
Payload-Entschluesselung oder Netzwerkzugriff erneut. Unterdrueckte Eintraege
bleiben mit generischem Grund als fehlgeschlagene Zustellhistorie sichtbar.
Einladungs-, Passwort-Recovery- und Testmails sind Systemvorgaenge und werden
nicht durch diese Kategorien abgeschaltet.

Einladungs- und Recovery-Erzeuger legen weiterhin ausschliesslich den
verschluesselten Einmal-Link in die Outbox. Vor dem ersten Gateway-Aufruf
materialisiert der Worker Betreff, Plaintext und abgeleitetes HTML genau einmal
als verschluesselten Snapshot in derselben Delivery. Ein Prozessabbruch oder
automatischer Retry verwendet deshalb bei unveraenderter Delivery-ID exakt
denselben Inhalt. Bereits vorgemerkte Link-only-Deliveries bleiben kompatibel.

## E-Mail-Center

Owner und Admins verwalten unter `/admin/email` die tenantisolierte,
seitenweise Versandhistorie und unter `/admin/email/templates` die vier
Plaintext-Vorlagen `feedback.reply`, `lesson.available`, `invitation.created`
und `password.reset`. Erlaubte Variablen werden pro Ereignis begrenzt; fuer
Einladungen sind dies `firstName`, `platformName`, `invitationUrl` und
`expiresIn`, fuer Recovery `firstName`, `platformName`, `resetUrl` und
`expiresIn`. Listen maskieren
Name und E-Mail-Adresse. Details entschluesseln nur die streng erwarteten
Felder und blenden Links und Tokens aus. Inhalte von `invitation.created` und
`password.reset` werden nie fuer die Detailansicht entschluesselt.

Manuelle Wiederholung ist ausschliesslich fuer fehlgeschlagene
`feedback.reply`, `lesson.available`, `event.rescheduled`, `event.cancelled`
und `email.template.test` erlaubt. Sie verwendet dieselbe Delivery-ID und
denselben Snapshot; dadurch bleibt auch der Gateway-Idempotency-Key
unveraendert. Auth-Link-Mails werden nie manuell wiederholt. Die REST-
Schnittstellen verwenden `email:read` beziehungsweise `email:write`;
schreibende Aktionen verlangen zusaetzlich einen API-Key, der einem weiterhin
aktiven Owner oder Admin des Tenants gehoert.

Unter `/admin/email/suppressions` sehen Benutzer mit `settings.manage` die
maskierte, tenantisolierte Sperrliste. Filter sind fuer Status, Grund sowie
Name/E-Mail vorhanden. Eine aktive Sperre kann nur mit einem geschlossenen
Pruefgrund entsperrt werden; jede tatsaechliche Freigabe erzeugt
`email.suppression.released` im Activity-Audit. Weder Audit noch REST-Antwort
enthalten Empfaenger-Hash, interne Delivery-ID oder Provider-Rohdaten. Fuer
Automatisierung stehen `GET /api/v1/email-suppressions` (`email:read`) und
`POST /api/v1/email-suppressions/{id}/release` (`email:write`,
`Idempotency-Key`) zur Verfuegung.

## Antwort und Idempotenz

Jeder `2xx`-Status bedeutet nur, dass das Gateway die Delivery dauerhaft
angenommen hat. Die Admin-Oberflaeche bezeichnet diesen Zustand deshalb als
`Vom Gateway angenommen`, nicht als nachweislich beim Empfaenger angekommen.
Andere Statuscodes, Verbindungsfehler und Timeouts werden mit exponentiellem
Backoff erneut versucht; nach acht Versuchen wechselt die Delivery auf `failed`.

Das Gateway muss den `Idempotency-Key` persistent speichern und fuer denselben
Key auch nach einem Worker-Abbruch keine zweite Mail erzeugen. Die Aufbewahrung
der Idempotenzdaten muss mindestens die maximale Q-Academy-Retry-Dauer abdecken.
Gateway-Antwortkoerper werden nicht gespeichert oder in Admin/API ausgegeben;
persistiert werden nur ein generischer Fehlertext und gegebenenfalls der
HTTP-Status.

## Bounce- und Complaint-Rueckkanal

Das Gateway meldet dauerhafte und temporaere Bounces sowie Beschwerden an:

- Methode: `POST`
- URL: `/api/integrations/mail-gateway/events`
- Content-Type: `application/json`
- Timestamp: `X-QA-Mail-Timestamp: <Unix-Sekunden>`
- Signatur: `X-QA-Mail-Signature: v1=<hex-hmac-sha256>`
- Secret: `EMAIL_DELIVERY_INBOUND_SECRET`

Die Signatur wird ueber den exakten String
`<timestamp>.<unveraenderter HTTP-Body>` gebildet. Q-Academy akzeptiert nur
zehnstellige Timestamps innerhalb von 300 Sekunden und vergleicht den Digest
in konstanter Zeit. Das Inbound-Secret muss mindestens 32 Zeichen lang und von
Outbound-, Session-, Worker-, Verschluesselungs- und Privacy-Secrets getrennt
sein. Der Body ist auf 64 KiB begrenzt.

```json
{
  "eventId": "provider-event-01J2ABCDEF",
  "organizationId": "00000000-0000-4000-8000-000000000001",
  "deliveryId": "00000000-0000-4000-8000-000000000002",
  "type": "bounce",
  "bounceKind": "hard",
  "reasonCode": "mailbox_not_found",
  "occurredAt": "2026-07-13T12:00:00.000Z"
}
```

`type` ist `bounce` oder `complaint`. Bounces verlangen `bounceKind` mit
`hard` oder `soft`; Complaints duerfen dieses Feld nicht enthalten.
`reasonCode` ist ein auf ASCII-Buchstaben, Ziffern, Punkt, Unterstrich,
Doppelpunkt und Bindestrich begrenzter, maximal 120 Zeichen langer technischer
Code. E-Mail-Adressen, Nachrichteninhalt, SMTP-Dialog, Header und
Provider-Rohpayload sind verboten und werden vom strikten Schema abgewiesen.
`occurredAt` darf hoechstens fuenf Minuten in der Zukunft und maximal ein Jahr
in der Vergangenheit liegen.

`eventId` ist tenantweit dauerhaft idempotent. Derselbe Event mit identischem
Payload-Hash antwortet als Replay; dieselbe ID mit anderem Body wird mit `409`
abgewiesen. Die angegebene Delivery muss exakt zum Tenant gehoeren. Antworten
geben nicht preis, ob eine Delivery oder ein Empfaenger in einem anderen
Tenant existiert.

Hard-Bounces und Complaints sperren den aus der Delivery ermittelten Empfaenger
ohne Ablauf. Soft-Bounces sperren 24 Stunden; weitere Events verlaengern oder
verschaerfen die aktive Sperre, sie stufen sie nie herab. Der Versandworker
prueft die tenantgebundene HMAC-Referenz vor Payload-Entschluesselung und vor
jedem Netzwerkzugriff. Bei einem Datenbankfehler bleibt die Delivery geclaimed
und wird nicht versendet. Entsperrte oder seit mindestens der konfigurierten
E-Mail-Retention abgelaufene Sperren werden nur ohne aktiven
`communications`-/`all`-Legal-Hold bereinigt. Feedback-Events folgen ueber die
Delivery deren Retention.

## Sicherheitsanforderungen

- Nur TLS mit gueltigem Zertifikat; keine Redirects auf unsichere Ziele.
- Bearer-Secret getrennt von allen anderen Anwendungssecrets erzeugen.
- `link` enthaelt bei `invitation.created` und `password.reset` ein einmaliges
  Geheimnis und darf fuer diese Events weder in Logs, Traces, Analytics,
  Fehlermeldungen noch Provider-Metadaten erscheinen. Der interne Link von
  `lesson.available` darf keine personenbezogenen Query-Parameter enthalten
  und soll ebenfalls nicht unnoetig protokolliert werden.
- Template-Ausgabe muss HTML escapen und externe Bilder datenschutzkonform
  behandeln.
- Versanddomain vor Pilotstart mit SPF, DKIM und DMARC abnehmen.
- Bounce-/Complaint-Callbacks duerfen Body, Signatur und Adressdaten weder in
  Logs noch in Traces oder Fehlermeldungen aufnehmen.

## Locale-Vertrag

`locale` ist eine der Sprachen `de`, `en`, `it`, `es` oder `fr`. Die wirksame
Sprache wird serverseitig aus Nutzerpraeferenz und Tenant-Standard bestimmt.
Bei Einladungs- und Passwort-Links wird sie bereits innerhalb der erzeugenden
Transaktion zusammen mit dem Link verschluesselt gespeichert. Der Worker darf
sie nicht aus Request-Headern neu ableiten; dadurch bleiben Retry und spaetere
Zustellung in derselben Sprache. Bestehende Datensaetze ohne Locale verwenden
aus Rueckwaertskompatibilitaet `de`.

Die sicheren Standardvorlagen und tenantindividuellen Vorlagen existieren fuer
alle fuenf Sprachen. Der Admin-Editor speichert jede Locale separat; fehlende
lokalisierte Einstellungen fallen kontrolliert auf Legacy- beziehungsweise
Standardwerte zurueck.

## Produktive Abnahme

Vor dem ersten Kundenversand muessen Gateway-Idempotenz ueber Prozessneustarts,
TLS, SPF, DKIM, DMARC, Versandlimits, Bounce-/Complaint-Signaturen, Secret-
Rotation, Alarmierung und der Sperr-/Freigabeprozess mit dem konkret gewaehlten
Provider praktisch getestet werden. Der lokal implementierte Vertrag allein
ist kein Zustellnachweis.
