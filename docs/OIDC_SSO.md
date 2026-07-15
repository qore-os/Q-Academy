# Q-Academy OpenID Connect

Stand: 2026-07-14. Der tenantgebundene OIDC-Core ist lokal implementiert und
automatisiert getestet. Dieses Dokument ist kein Nachweis fuer die noch offene
Registrierung oder Betriebsabnahme eines realen Identity Providers.

## Funktionsumfang

- OIDC Discovery und Authorization Code Flow mit PKCE S256, State und Nonce
- pro Tenant versionierte Konfiguration mit verschluesseltem Client-Secret
- exakte Bindung an kanonischen Tenant-Host, Issuer und Callback-URL
- verifizierte E-Mail-Claims, persistente `(Tenant, Issuer, Subject)`-Identitaet
  und atomare Kontoverknuepfung
- Aktivierung eingeladener Member per SSO sowie optionale, domainbegrenzte
  automatische Member-Provisionierung
- optionaler SSO-only-Betrieb ohne Passwort-Login
- explizite Verknuepfung privilegierter Konten sowie frischer Owner-Step-up und
  bei aktiver persoenlicher MFA ein zusaetzlicher TOTP- oder Recovery-Nachweis
  vor interaktiven Konfigurationsaenderungen
- OIDC-Provenienz, kuerzere Laufzeit und laufende Providerpruefung fuer Sessions
- ownergebundene REST-Scopes `authentication:read` und
  `authentication:write`

Ein Google-spezifischer Ein-Klick-Adapter, SAML, RP-initiated beziehungsweise
Backchannel Logout und SCIM sind nicht separat implementiert. Ein kompatibler
Google-OIDC-Client kann den generischen Flow verwenden; diese Providerkopplung
ist vor Kundenbetrieb trotzdem praktisch abzunehmen.

## Providervertrag

Der Provider muss folgende Metadaten und Eigenschaften anbieten:

- oeffentlich erreichbaren HTTPS-Issuer mit OIDC Discovery
- `authorization_endpoint`, `token_endpoint` und `jwks_uri` als sichere
  oeffentliche HTTPS-Ziele
- `response_type=code` und Authorization-Code-Grant
- PKCE mit `S256`
- Token-Endpunkt-Authentifizierung mit `client_secret_post`
- die Scopes `openid` und `email`; `profile` ist optional
- asymmetrisch signierte ID-Tokens mit RS-, PS-, ES- oder EdDSA-Algorithmus
- nicht leeren `sub`, gueltige `email` und `email_verified=true`
- bei frischer Ownerbestaetigung Unterstuetzung fuer `prompt=login`, `max_age=0`
  und einen verwertbaren `auth_time`-Claim

Provider, die nur `client_secret_basic`, symmetrische ID-Token-Signaturen oder
einen impliziten Flow anbieten, sind mit dem aktuellen Core nicht kompatibel.
Lokale HTTP-Issuer sind ausschliesslich ausserhalb der Produktion fuer Tests
erlaubt.

## Kanonische Callback-URL

In Produktion waehlt Q-Academy den Ursprung in fester Reihenfolge:

1. den aktiven, DNS-verifizierten Custom-Domain-Claim des Tenants,
2. `https://<tenant-slug>.<TENANT_BASE_DOMAIN>`,
3. die `NEXT_PUBLIC_APP_URL` als Fallback.

Der Hostname von `NEXT_PUBLIC_APP_URL` muss in Produktion exakt mit
`APP_DOMAIN` uebereinstimmen. Dieser kanonische Plattformhost wird bei der
oeffentlichen Tenant-Aufloesung ausschliesslich an
`DEFAULT_ORGANIZATION_SLUG` gebunden; unbekannte Request-Hosts bleiben
tenantlos. Eine Abweichung laesst die Readiness-Pruefung scheitern.

Der Owner beansprucht eine eigene Login-Domain unter `/admin/settings` oder
ueber `/api/v1/organization/domains`. Create und Rotate geben einen einmaligen,
24 Stunden gueltigen TXT-Wert fuer `_q-academy-verification.<hostname>` aus.
Verify autorisiert den Host nach erfolgreicher DNS-Pruefung fuer Caddys
On-Demand TLS. A/AAAA oder CNAME muessen danach auf den Rootserver zeigen; das
Zertifikat wird beim ersten HTTPS-Aufruf angefordert. Revoke entfernt den Host
unmittelbar aus Login- und Callback-Aufloesung und verweigert weitere
TLS-Autorisierungen. Ein `loginHostname` darf
nicht direkt provisioniert oder allein ueber Branding-Daten freigeschaltet
werden. `<tenant-slug>.localhost` und die kontrollierte
`TENANT_BASE_DOMAIN` bleiben claimfreie Plattformhosts.

Beim Provider muss genau diese Redirect-URI registriert werden:

```text
https://<kanonischer-tenant-host>/api/v1/auth/oidc/callback
```

DNS, Caddy, TLS, Tenant-Hostname und Providerregistrierung muessen identisch
sein. Der Start-Endpunkt leitet produktive GET-Anmeldungen auf den kanonischen
Host um; eine Kontoverknuepfung per POST sowie der Callback schlagen bei einem
abweichenden Ursprung geschlossen fehl. Beliebige `Host`- oder Forwarding-
Header duerfen die Callback-URL nicht bestimmen. `TRUST_PROXY_HEADERS=true` ist
nur hinter dem dokumentierten Caddy-Setup zulaessig.

## Einrichtung

1. Den Tenant provisionieren, den Custom-Domain-Claim verifizieren, Ziel-DNS
   setzen und den ersten HTTPS-Aufruf samt Zertifikatskette abnehmen.
2. Beim Identity Provider einen vertraulichen Web-Client mit der exakten
   Callback-URL registrieren.
3. Als aktiver Owner unter `/admin/settings` Issuer, Client-ID, Client-Secret,
   Anzeigename und gegebenenfalls erlaubte E-Mail-Domains eintragen. Jede
   Speicherung verlangt vorher einen frischen Owner-Step-up ueber aktuelles
   Passwort oder Provider. Bei aktiver persoenlicher MFA ist zusaetzlich ein
   TOTP- oder unbenutzter Recovery-Code erforderlich. Erst danach werden
   Discovery und Providerfaehigkeiten validiert.
4. Den Passwort-Login zunaechst aktiviert lassen. Der Owner verknuepft sein
   aktuelles Konto ueber den same-origin POST-Flow und absolviert eine frische
   Provideranmeldung.
5. Abmelden und die normale SSO-Anmeldung auf dem kanonischen Tenant-Host
   pruefen.
6. Nur fuer einen beabsichtigten SSO-only-Tenant den Passwort-Login danach in
   einem separaten Speichervorgang abschalten.
7. Einladung, Domain-Allowlist, Member-Provisionierung, Owner-Step-up,
   Providerausfall und IdP-Recovery im Staging praktisch testen.

Die Konfiguration unterstuetzt fuer das Client-Secret die Zustaende beibehalten,
ersetzen und loeschen. Ein nicht mehr entschluesselbares altes Secret kann durch
einen Owner ersetzt oder bei deaktiviertem OIDC entfernt werden; ein implizites
Beibehalten schlaegt geschlossen fehl. Kritische Provideraenderungen und das
Abschalten des Passwort-Logins sind absichtlich getrennte Schritte.

## Konten und Einladungen

- Eine bereits verknuepfte Identitaet wird nur ueber Tenant, Issuer und `sub`
  aufgeloest; der aktuelle Account muss aktiv sein.
- Ein bestehendes aktives oder eingeladenes Member kann ueber dieselbe
  verifizierte E-Mail atomar verknuepft werden. Bei einer offenen Einladung wird
  das Member aktiviert und die Einladung als angenommen markiert.
- Owner, Admins und Trainer werden nie allein aufgrund einer gleichen E-Mail
  automatisch verknuepft. Dafuer ist der explizite Link-Flow aus der aktuellen
  Sitzung erforderlich.
- JIT-Provisionierung erstellt ausschliesslich aktive Member und ist nur mit
  mindestens einer expliziten erlaubten E-Mail-Domain aktivierbar. Der
  Domainvergleich ist exakt; Suffix- oder Teilstringtreffer werden nicht
  akzeptiert.
- Bei deaktiviertem Passwort-Login zeigt eine passende Einladungsseite keinen
  Passwortdialog, sondern startet die SSO-Aktivierung.

## Sitzungen und Step-up

OIDC-Sessions speichern Auth-Methode, Identity-ID, verwendete
Konfigurationsversion, `authenticated_at` und den Provider-`auth_time`. Sie
laufen spaetestens nach 12 Stunden und bei einer Stunde Inaktivitaet ab. Bei
jeder Verwendung werden aktive Organisation, aktiver Benutzer, Identitaet,
aktivierte OIDC-Konfiguration und gleicher Issuer erneut geprueft. Eine neue
Sitzung ersetzt die aktuelle Browsersitzung; sicherheitsrelevante Aenderungen an
Aktivierung, Issuer, Client-ID, Client-Secret oder Domain-Allowlist widerrufen
alle aktiven OIDC-Sessions des Tenants.

Der explizite Link-Flow und der SSO-only-Owner-Step-up fordern
`prompt=login&max_age=0`. Fuer ownerkritische Aktionen wird nur eine hoechstens
fuenf Minuten alte OIDC-Sitzung akzeptiert, deren `auth_time` ebenfalls in
diesem Fenster liegt. Bei aktiviertem Passwort-Login bleibt das aktuelle
Owner-Passwort der Step-up-Nachweis.

Interaktive Mutationen der OIDC-Konfiguration verlangen diesen frischen
Primaerfaktor bei jedem Speichervorgang. Ist die persoenliche MFA des Owners
aktiv, wird danach ein TOTP- oder unbenutzter Recovery-Code atomar und
replaysicher verbraucht. Primaer- und MFA-Nachweis muessen abgeschlossen sein,
bevor die Anwendung den konfigurierten Provider kontaktiert. Der getrennte
`PATCH`-API-Vertrag bleibt an einen `authentication:write`-Schluessel eines
weiterhin aktiven Owners gebunden; die Erstausgabe dieses Schluessels verlangt
den unten beschriebenen interaktiven Owner-Step-up.

## API und Schluessel

`GET /api/v1/organization/oidc` verlangt `authentication:read`;
`PATCH /api/v1/organization/oidc` verlangt `authentication:write`, eine
erwartete Konfigurationsversion und fuer Mutationen einen Idempotency-Key. Beide
Scopes sind an einen weiterhin aktiven Owner als Schluesselersteller gebunden.
Sie werden weder von `*` impliziert noch durch einen API-Key weiterdelegiert.
Auch Erstellen, Rotieren, Anzeigen und Widerrufen solcher Schluessel schuetzt
die Ownerbindung; ihre Erstausgabe verlangt einen interaktiven Owner-Step-up.

## Externe Go-live-Gates

Vor realen Kundendaten bleiben mindestens offen:

- reale IdP-Clientregistrierung je Tenant und exakte Callback-Abnahme
- produktives DNS/TLS und verifizierte Custom-Domain-Prozesse
- dokumentierter IdP-Administratorzugang, Account-Recovery und Ausfallprozess
- produktives Enrollment und Recovery fuer die lokale MFA der Owner, Admins und
  Trainer sowie praktische Abnahme der tenantweiten Pflicht-Policy
- Staging- und Penetrationstest gegen den tatsaechlichen Provider
- Monitoring und Alarmierung fuer OIDC-Fehler und Anmeldeausfaelle
- vertragliche und datenschutzrechtliche Freigabe des Identity Providers
- je nach Kundenvertrag RP-initiated/Backchannel Logout, SCIM oder SAML

Der lokale OIDC-Core hebt diese externen Release-Gates nicht auf. Die gesamte
Pilotfreigabe bleibt zusaetzlich von Mail, privatem Storage/ClamAV,
Backup/Restore, Monitoring, Legal und externem Security-Test abhaengig.

## Automatisierte Nachweise

Die fokussierten Tests liegen insbesondere in:

- `tests/oidc-sso.spec.ts`
- `tests/oidc-configuration-recovery.spec.ts`
- `tests/oidc-model.unit.ts`
- `tests/oidc-transaction.unit.ts`
- `tests/oidc-host-policy.unit.ts`
- `tests/oidc-cookie-policy.unit.ts`
- `tests/oidc-openapi.unit.ts`
- `tests/oidc-settings-step-up.unit.ts`

Sie pruefen positiven Login, expliziten Owner-Link, SSO-only-Step-up,
Primaerfaktor und optionalen MFA-Nachweis vor interaktiven
Konfigurationsaenderungen sowie API-Schluessel, Einladungsaktivierung,
JIT-Provisionierung, Domainablehnung, Replay-/Host-/Cookie-Guards,
Session-Provenienz, Konfigurations-Recovery und responsive Desktop-/
Mobiloberflaechen gegen einen kontrollierten Test-Provider.
