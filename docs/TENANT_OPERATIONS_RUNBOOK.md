# Tenant Operations Runbook

Stand: 2026-07-14.

Dieses Runbook beschreibt die vorhandenen lokalen Onboarding-, Sperr-,
Offboarding- und Supportpfade. Es ersetzt weder einen Kundenvertrag noch SLA,
On-call-Plan, Rechtsgrundlage oder eine produktive Providerabnahme.

## Voraussetzungen

- freigegebenes Release-Artefakt und aktueller Migrationsstand,
- produktive Secrets aus dem vorgesehenen Secret Manager,
- kanonischer HTTPS-Host, Mailgateway und privater S3-Bucket,
- benannte verantwortliche Person mit Operationszugang und
- dokumentierter Vertrag, Datenschutzfreigabe und Supportkontakt.

Keine Operation wird mit Demo-Daten, `db:push`, direktem SQL oder einem
geteilten Ownerpasswort durchgefuehrt.

Auf dem Node-freien Rootserver werden ausschliesslich die releasegebundenen
One-shot-Container verwendet. Nach `cd /opt/q-academy` und bei laufendem,
gesundem Produktionsstack einmal pro gesicherter Operator-Shell definieren:

```bash
export Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env
qa_admin() {
  docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
    --profile operations run --rm --no-deps tenant-admin-ops "$@"
}
qa_export() {
  docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
    --profile operations run --rm --no-deps tenant-export-ops "$@"
}
qa_erasure() {
  docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
    --profile operations run --rm --no-deps tenant-erasure-ops "$@"
}
qa_verify() {
  docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
    --profile operations run --rm --no-deps artifact-verify-ops "$@"
}
```

Der Dispatcher akzeptiert nur dokumentierte Kommandos. Admin- und
Exportdienste verwenden die App-Datenbankrolle; ausschliesslich der
Loeschdienst erhaelt Owner-DB- und S3-Hard-Delete-Zugang. Der Verifikationsdienst
hat kein Netzwerk. Alle Dienste laufen als UID/GID 1001 mit read-only Rootfs,
ohne Linux-Capabilities und ohne persistentes Containerlogging.

## Onboarding

1. Tenant idempotent provisionieren:

   ```bash
   qa_admin tenant:provision \
     --name "Acme Academy" \
     --slug acme \
     --owner-email owner@acme.example \
     --owner-first-name Erika \
     --owner-last-name Musterfrau \
     --app-url https://academy.example.org
   ```

   Der Einladungslink erscheint genau einmal im angehaengten Operator-Terminal.
   Ihn weder in Shell-Umleitungen noch Terminal-Mitschnitten oder Tickets
   persistieren; die Compose-Dienste schreiben ihn nicht in `docker logs`.

2. Verschluesselte Owner-Einladung in der Mail-Outbox und deren Annahme pruefen.
   Ein initiales Standardpasswort wird nicht vergeben.
3. Vertrag mit exakter Slug-Bestaetigung und Revision setzen; Grenzen niemals
   unter die aktuelle Nutzung reduzieren. Siehe
   [TENANT_CONTRACTS.md](./TENANT_CONTRACTS.md).
4. Nach Owner-Anmeldung Branding, Legal-Links, Standard-Locale, Theme, MFA-
   Policy und Rollen unter `/admin/settings` konfigurieren.
5. Falls vertraglich freigeschaltet, Custom Domain beanspruchen, einmaligen TXT-
   Wert in DNS setzen, verifizieren und erst danach Caddy/TLS sowie den
   kanonischen Host abnehmen. Pending Claims aktivieren kein Branding oder OIDC.
6. OIDC erst nach registrierter exakter Callback-URL und dokumentiertem
   Recovery-Owner aktivieren. SSO-only wird zuletzt eingeschaltet.
7. Testmitglied einladen und Login, Kurszugriff, Mail, Medienupload,
   Lektionsfortschritt, Audit und Abmeldung auf dem kanonischen Host pruefen.
8. Testdaten entfernen und Onboarding mit Release, Tenant-Slug, Verantwortlichem
   und Datum im externen Betriebsprotokoll abzeichnen.

## Owner-Uebergabe

1. Zielkonto muss ein aktiver Admin desselben Tenants sein.
2. Aktueller Owner oeffnet das Mitglied unter `/admin/members/<id>` und startet
   die Uebergabe mit frischem Passwort- oder OIDC-Step-up.
3. Die Transaktion befoerdert das Ziel, stuft den bisherigen Owner zum Admin
   zurueck, entfernt eine kollidierende Custom-Rollenzuweisung und schreibt das
   Audit. Beide Sessionbestaende werden widerrufen.
4. Neuer Owner meldet sich neu an und prueft MFA, Recovery und Einstellungen.
   Der bisherige Owner kann erst danach nach normalem Rollenprozess entfernt
   werden.

## Sperrung und Reaktivierung

Bei Vertrags-, Sicherheits- oder Betriebsgrund den Tenant sperren:

```bash
qa_admin tenant:status --slug acme --status suspended --confirm acme
```

Die Sperrung widerruft Sessions und API-Keys. Vor Reaktivierung Ursache,
Vertrag, Secrets und gegebenenfalls kompromittierte Konten klaeren:

```bash
qa_admin tenant:status --slug acme --status active --confirm acme
```

Reaktivierung stellt alte Sessions oder API-Keys nicht wieder her. Erforderliche
Credentials werden neu ausgegeben und anschliessend praktisch getestet.

## Offboarding

1. Rechtsgrundlage, Fristen, Legal Holds, Exportumfang und verantwortliche
   Freigaben ausserhalb der Anwendung dokumentieren.
2. Tenant in den nicht aktiven Offboarding-Zustand versetzen:

   ```bash
   qa_admin tenant:status --slug acme --status offboarding --confirm acme
   ```

3. Erforderliche Betroffenenexporte ueber `/admin/privacy` beziehungsweise
   `qa_export user-data:export ...` und den Tenant-Auditzeitraum ueber
   `qa_export audit:export ...` erzeugen, mit `qa_verify` verifizieren und nur in
   freigegebenen, verschluesselten Zielen ablegen.
4. Providerzugriffe, OIDC-Client, Custom Domain, Webhooks, Commerce,
   Automationen, Push und Supportintegration kontrolliert widerrufen.
5. Das exakte Policy-Manifest aus
   [`tenant-erasure-policy.example.json`](./tenant-erasure-policy.example.json)
   mit Auftrag, Freigabe, Rechtsgrundlage, Export-SHA-256, Wartefrist,
   Backup-Auslauf und Entscheidungen zu Audit, Abrechnung, Zertifikaten und
   Lernnachweisen erstellen. `TENANT_ERASURE_MIN_WAIT_DAYS` ist technisch auf
   mindestens einen Tag begrenzt und steht standardmaessig auf 30 Tage.
   `AUDIT_EXPORT_HMAC_KEY`, dessen ID und die Daten-Keyring-Secrets werden nur
   den jeweiligen Operator-Containern injiziert und niemals an App oder
   Medienrunner weitergereicht. Nur `tenant-erasure-ops` konstruiert intern die
   getrennte Owner-Datenbank-URL; dem Runtime-App-User fehlen absichtlich
   DELETE-Rechte auf Organisationen und alle Rechte auf Loeschbelege.

   Policy-Manifest und bestaetigter Kundenexport muessen vor dem Plan als
   root-eigene, gruppenlesbare Dateien im geschuetzten Input-Mount liegen:

   ```bash
   sudo install -o root -g 1001 -m 0440 /secure/acme-erasure-policy.json \
     /var/lib/q-academy/operations-input/acme-erasure-policy.json
   sudo install -o root -g 1001 -m 0440 /secure/acme-customer-export.zip \
     /var/lib/q-academy/operations-input/acme-customer-export.zip
   ```
6. Den fail-closed Plan ohne Mutation pruefen:

   ```bash
   qa_erasure tenant:erase \
     --slug acme \
     --manifest /operations/input/acme-erasure-policy.json \
     --json
   ```

   `status=offboarding`, null aktive Legal Holds, abgelaufene Wartefrist sowie
   plausible Nutzer-, Medien-, Storage- und Evidenzzaehler muessen bestaetigt
   sein.
7. Nach Vier-Augen-Freigabe den irreversiblen Lauf starten. Das Archivziel muss
   neu sein und auf einem verschluesselten, gesicherten Datentraeger liegen:

   ```bash
   qa_erasure tenant:erase \
     --slug acme \
     --manifest /operations/input/acme-erasure-policy.json \
     --customer-export /operations/input/acme-customer-export.zip \
     --archive /operations/output/acme-erasure-evidence.jsonl.enc \
     --confirm acme \
     --execute \
     --json
   ```

   Der Lauf archiviert geschuetzte Auditketten zeilenweise mit AES-256-GCM und
   tenant-/tabellen-/sequenzgebundener AAD, signiert Manifest und HMAC-Kette,
   loescht und verifiziert alle Media-Objekte samt S3-Versionen/Delete-Markern,
   pseudonymisiert verwaiste Orbit-Konten und autorisiert erst danach den
   relationalen Cascade. Der globale Receipt und seine Ereignisse bleiben
   unveraenderlich erhalten.
8. Das Archiv unabhaengig mit allen fuer die Rotation erforderlichen Keys
   pruefen; der Befehl gibt keine entschluesselten Inhalte aus:

   ```bash
   qa_verify tenant:erase:verify \
     --archive /operations/input/acme-erasure-evidence.jsonl.enc \
     --json
   ```

9. Solange `backupExpiresAt` noch nicht erreicht ist, bleibt der Receipt auf
   `backup_retention_pending`. Nach dokumentiertem Backup-Purge und dessen
   SHA-256-Nachweis abschliessen:

   ```bash
   qa_erasure tenant:erase \
     --finalize-receipt 00000000-0000-4000-8000-000000000000 \
     --confirm 00000000-0000-4000-8000-000000000000 \
     --backup-evidence-sha256 <64-zeichen-sha256> \
     --json
   ```

Der `offboarding`-Status allein bleibt eine Zugriffssperre und kein
Loeschnachweis. Eine vollstaendige Loeschung ist erst mit verifiziertem
Kundenexport, Policy-Manifest, `tenant:erase`-Receipt, geprueftem
Evidenzarchiv, externem Providerwiderruf und abgeschlossenem Backup-Auslauf
belegt. Ad-hoc-SQL ist kein zulaessiger Ersatz.

## Support-Triage

1. Ticket nur mit Tenant-Slug, UTC-Zeitfenster, Route, Browser/App-Version,
   Request-ID und reproduzierbaren Schritten annehmen. Keine Passwoerter,
   Tokens, Recovery-Codes, Mailinhalte oder kompletten Prompts anfordern.
2. Tenantstatus und Readiness pruefen; danach den kleinsten betroffenen Bereich
   bestimmen: Auth, Mail, Webhook, Medien, KI, Commerce oder Datenzugriff.
3. Maskierte Adminhistorie, redigierte Logs, Metriken und Activity-Audit nutzen.
   Verschluesselte Payloads werden nicht zur allgemeinen Fehlersuche
   entschluesselt.
4. Retry oder Sperrfreigabe nur ueber die vorgesehenen, auditierbaren UI-/API-
   Aktionen ausfuehren. Auth-Link-Mails werden neu erzeugt, nie manuell
   wiederholt.
5. Bei Verdacht auf Cross-Tenant-Zugriff, Secret-Leak, unberechtigte
   Owner-Aenderung oder Datenverlust keine Reparaturmutation ausfuehren: Tenant
   falls erforderlich sperren, Beweise erhalten und den Security-/Incident-
   Prozess eskalieren.

Reaktionszeiten, Kommunikationskanal, Rufbereitschaft, Eskalationskette und
SLA/SLO muessen der Betreiber und der jeweilige Kundenvertrag festlegen. Dieses
Repository liefert dafuer keine organisatorische Zusage.
