# TOTP-MFA fuer privilegierte Konten

## Schutzmodell

- MFA gilt fuer `owner`, `admin` und `trainer`. Eine aktive persoenliche
  Konfiguration wird bei jedem Passwort- und OIDC-Login verlangt. Der Owner kann
  MFA tenantweit fuer alle drei privilegierten Rollen erzwingen.
- Nach dem Primaerfaktor entsteht nur eine zehn Minuten gueltige, HttpOnly,
  `SameSite=Lax` und in Produktion `Secure`/`__Host-` gebundene Challenge. Eine
  Anwendungssitzung entsteht erst nach erfolgreichem zweiten Faktor.
- Der Challenge-JTI liegt nur als SHA-256-Hash vor. Das TOTP-Secret liegt mit
  AES-256-GCM, Key-ID und tenant-/nutzergebundenen Associated Data vor.
- TOTP folgt RFC 6238 (`SHA1`, 30 Sekunden, sechs Stellen, Fenster +/- 1). Der
  zuletzt verbrauchte Counter wird atomar gespeichert; derselbe oder ein
  aelterer Code ist auch in einer neuen Challenge nicht wiederverwendbar.
- Zehn Recovery-Codes mit je 80 Bit Zufall werden nur bei Aktivierung oder
  Regeneration einmal angezeigt. Gespeichert werden HMAC-SHA-256-Envelopes
  `v1.<pepper-kid>.<digest>`. Ein erfolgreicher Code wird atomar entfernt.

## Step-up und Verwaltung

- Enrollment beginnt nach aktuellem Passwort. In SSO-only-Tenants ersetzt eine
  explizite, mit `prompt=login` und `max_age=0` angeforderte OIDC-Anmeldung der
  letzten fuenf Minuten das Passwort.
- Aktivierung erfordert den Primaerfaktor und den ersten TOTP-Code.
- Deaktivierung, Recovery-Regeneration und Policy-Aenderung erfordern frischen
  Primaerfaktor plus TOTP oder noch unbenutzten Recovery-Code.
- Jede interaktive OIDC-Konfigurationsaenderung in der Owner-Oberflaeche
  erfordert ebenfalls einen frischen Primaerfaktor und, falls die persoenliche
  MFA des Owners aktiv ist, einen TOTP- oder unbenutzten Recovery-Code. Beide
  Nachweise werden vor Discovery oder anderem Providerzugriff geprueft.
- Enrollment beendet alle anderen Sitzungen. Eine verpflichtende Policy
  widerruft privilegierte Sitzungen ohne MFA-Nachweis; `getSession` prueft die
  Policy bei jeder Nutzung erneut.
- Policy-Aenderungen verwenden eine Revision, tenantgebundene Sperren, eine
  erneute Owner-Rollenpruefung in der Transaktion und Audit-Events ohne Secrets.

## Limits und Aufbewahrung

- Der MFA-Versuchsbucket ist tenant- und nutzergebunden, nicht
  challengegebunden. Ein neuer Passwort-Login setzt ihn nicht zurueck. Der
  normale Login-Bucket wird erst nach vollstaendig erfolgreicher MFA geloescht.
- Verbrauchte oder seit mindestens 24 Stunden abgelaufene Challenges und seit
  24 Stunden verlassene Pending-Enrollments werden im begrenzten Operational-
  Cleanup entfernt. Aktive Konfigurationen sind ausgeschlossen.
- DSAR-Exporte enthalten nur MFA-Status, Zeitstempel, Methode und Anzahl
  verbleibender Recovery-Codes. Secret, JTI-Hash, Recovery-Hashes und
  Replay-Counter sind explizit ausgeschlossen.

## Schluesselrotation

- `DATA_ENCRYPTION_KEY` verschluesselt auch TOTP-Secrets. Vor dem Entfernen
  eines alten Leseschluessels muss `npm run -- encryption:rotate -- --execute`
  laufen; der Check muss danach `mfaTotpSecrets: 0` melden.
- Recovery-Hashes verwenden `MFA_RECOVERY_PEPPER_ID`,
  `MFA_RECOVERY_PEPPER` und `MFA_RECOVERY_PREVIOUS_PEPPERS`. Ein Hash kann ohne
  Klartext nicht umgeschluesselt werden. Ein alter Pepper bleibt deshalb
  lesbar, bis alle betroffenen Konten neue Recovery-Codes erzeugt haben. Erst
  wenn keine Envelope mehr diese Key-ID referenziert, darf er entfernt werden.
- Rotation und Pepper-Abloesung duerfen keine Secrets, TOTP-Werte oder
  Recovery-Codes in Logs schreiben.
