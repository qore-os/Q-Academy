# Q-Academy Cookie- und Tracking-Inventar

Stand: 2026-07-14. Die maschinenlesbare Quelle ist
[`cookie-tracking-inventory.json`](./cookie-tracking-inventory.json). Dieses
Dokument beschreibt den technischen Ist-Stand. Es ist weder eine rechtliche
Einwilligungsentscheidung noch eine Freigabe der Datenschutztexte.

## First-Party-Cookies

| Name | Quelle | Zweck | Lebensdauer | SameSite | Secure | HttpOnly | Notwendigkeit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `__Host-q_academy_session` in Produktion, sonst `q_academy_session` | `src/lib/auth.ts` | Signierte Browser-Sitzung mit serverseitigem Widerruf | Passwort 7 Tage, OIDC 12 Stunden; OIDC zusaetzlich nach 1 Stunde Inaktivitaet ungueltig | `Lax` | nur Produktion | ja | technisch notwendig fuer angemeldete Nutzung |
| `__Host-q_academy_mfa_challenge` in Produktion, sonst `q_academy_mfa_challenge` | `src/lib/mfa/login-challenge.ts` | Kurzlebige MFA-Login-/Enrollment-Challenge | 10 Minuten oder bis Verbrauch/Abbruch | `Lax` | nur Produktion | ja | technisch notwendig, wenn MFA verwendet wird |
| `__Host-q_academy_oidc_transaction` in Produktion, sonst `q_academy_oidc_transaction` | OIDC-Start, Callback und `src/lib/oidc-cookie-policy.ts` | State, Nonce, PKCE und Callback-Kontext des gestarteten OIDC-Flows | 10 Minuten; Callback loescht mit `Max-Age=0` | `Lax` | nur Produktion | ja | technisch notwendig, wenn OIDC verwendet wird |
| `__Host-q_academy_oidc_client` in Produktion, sonst `q_academy_oidc_client` | OIDC-Start und `src/lib/oidc-cookie-policy.ts` | Signierte stabile Client-Kennung fuer das OIDC-Start-Ratenlimit | 15 Minuten | `Lax` | nur Produktion | ja | technisch notwendige Missbrauchsabwehr fuer OIDC |

Alle vier Cookies sind host-only (`Domain` fehlt), verwenden `Path=/` und
`Priority=High`. Im produktiven Betrieb erfuellen sie damit die `__Host-`
Invarianten. Im lokalen HTTP-Betrieb fehlt `Secure` absichtlich; diese Namen
duerfen nicht als produktiver Cookie-Vertrag dokumentiert werden.

## Drittanbieter im Browser

| Integration | Ziel | Ladezeitpunkt | Technische Behandlung | Rechtlicher Status |
| --- | --- | --- | --- | --- |
| Intercom | `widget.intercom.io`, `api-iam.intercom.io` | automatisch, sobald der Tenant Intercom mit entschluesselbarem Identity-Secret aktiviert hat | Browser-SDK erhaelt App-ID, Nutzer-ID, E-Mail, Name und den verpflichtenden nutzergebundenen HMAC; ohne gueltigen HMAC werden weder Launcher noch SDK geladen; Provider-Cookies und -Speicher sind nicht durch Q-Academy steuerbar | offen |
| YouTube | `www.youtube-nocookie.com` | Click-to-load | Iframe entsteht erst nach explizitem Klick | offen |
| Vimeo | `player.vimeo.com` | Click-to-load | Iframe entsteht erst nach explizitem Klick | offen |
| Loom | `www.loom.com` | Click-to-load | Iframe entsteht erst nach explizitem Klick | offen |
| Microsoft Forms | `forms.office.com` | Click-to-load | Iframe entsteht erst nach explizitem Klick | offen |
| Google Forms | `docs.google.com` | Click-to-load | Iframe entsteht erst nach explizitem Klick | offen |

Der statische Stand enthaelt kein generisches Analytics-, Advertising- oder
Session-Replay-SDK als direkte Abhaengigkeit. Intercom ist der einzige bekannte
Browser-SDK-Loader. Die fuenf Kursanbieter sind keine stillen Page-Load-
Verbindungen: `CourseIntegrationEmbed` zeigt zuerst einen lokalisierten Hinweis
und erzeugt den Iframe erst nach einer Nutzeraktion. Ab diesem Zeitpunkt gelten
die Cookie-, Speicher- und Empfaengerregeln des jeweiligen Providers.

## Konfigurierbarer Drittanbieter-Code

Owner koennen optional Plattform-Header/-Footer-Code samt hoechstens acht
expliziten HTTPS-Origins aktivieren. Der Default ist aus. Der Code laeuft eager
in einem Opaque-Origin-Iframe mit `sandbox="allow-scripts"`, ohne
`allow-same-origin`, Referrer, Formularnavigation oder Zugriff auf Cookies und
Storage der Q-Academy-Origin. Externe Requests aus diesem Iframe bleiben
trotzdem eine Drittanbieteruebermittlung und muessen pro Tenant, Origin und
eingefuegtem Code rechtlich sowie technisch geprueft werden. Die in der
Adminoberflaeche angezeigten Google-Tag-Manager-/Analytics-Origins sind nur
Platzhalter und keine standardmaessig aktive Integration.

Hub-Custom-Code ist davon getrennt: Seine Sandbox-CSP setzt Netzwerkzugriffe auf
`none` und gibt ebenfalls keinen Same-Origin-Zugriff frei.

## Weiterer Browser-Speicher

| Technik/Key | Inhalt und Zweck | Lebensdauer | Notwendigkeit |
| --- | --- | --- | --- |
| `localStorage`, `q-academy:remembered-accounts:<tenant>` | Bis zu fuenf E-Mail-Adressen fuer den Kontowechsel | bis Ueberschreiben oder Loeschen der Website-Daten | funktional, nicht strikt notwendig |
| `localStorage`, `q-academy:video-volume:v1` | Lautstaerke-/Stummschaltungs-Praeferenz | bis Ueberschreiben oder Loeschen der Website-Daten | funktional, nicht strikt notwendig |
| `sessionStorage`, `q-academy:video-playback-rate:v1` | Wiedergabegeschwindigkeit | aktuelle Tab-Sitzung | funktional, nicht strikt notwendig |
| `sessionStorage`, `q-academy:native-start:<tenant>` | bereits aufgeloeste initiale Native-Navigation | aktuelle WebView-/Tab-Sitzung | fuer den nativen Ablauf technisch notwendig |
| `CacheStorage`, `q-academy-public-v1` | neutrale Offline-Seite, versionierte Icons und immutable Next.js-Assets | bis Service-Worker-Versionierung oder Loeschen der Website-Daten | optionale Offline-Funktion |

Der Service Worker fordert Cache-Inhalte mit `credentials: "omit"` an und
speichert weder Navigationen, API-Antworten, Tenant-Bilder noch Cookies oder
andere Anmeldedaten.

## Regression und offene Abnahme

`tests/cookie-tracking-inventory.unit.ts` vergleicht alle Cookie-Schreibstellen
im Produktionsquelltext exakt mit dem JSON-Inventar. Der Test schlaegt bei
neuen `cookies().set/delete`, `response.cookies.set/delete`, `Set-Cookie`-
Headern oder `document.cookie`-Zuweisungen fehl. Er sperrt ausserdem neue
bekannte Tracker-/Telemetry-Abhaengigkeiten, Marker und Browser-Scriptloader,
bis sie explizit inventarisiert und bewertet wurden. Providerkatalog und
Click-to-load-Vertrag werden ebenfalls abgeglichen.

Vor Pilotbetrieb bleiben mindestens diese Entscheidungen offen:

- reale Browseraufnahme je produktiver Tenant-Konfiguration und Provider,
  einschliesslich Cookie-Namen, Speicher, Lebensdauer, Empfaenger und Regionen
- Rechtsgrundlage und Consentbedarf fuer Intercom, Kurs-Iframes, funktionalen
  Browser-Speicher und jeden erlaubten Plattform-Custom-Code-Origin
- Entscheidung, ob Intercom vor Aktivierung ein Consent-/Click-to-load-Gate
  oder ein Consent-Management-System benoetigt
- Freigabe von Datenschutzhinweisen, AVV/TOMs und Unterauftragnehmerliste durch
  Legal und Datenschutzverantwortliche
