# Lokalisierung

Stand: 2026-07-14.

## Unterstuetzte Sprachen

Der Locale-Core unterstuetzt `de`, `en`, `it`, `es` und `fr`. Deutsch ist der
Fail-safe-Fallback fuer ungueltige oder historische Werte.

- `organizations.default_locale` ist der verpflichtende Tenant-Standard.
- `users.preferred_locale` ist nullable. `null` bedeutet, dass der aktuelle
  Tenant-Standard geerbt wird.
- Die Nutzerpraeferenz gewinnt immer vor dem Tenant-Standard.

Neue Einladungs- und OIDC-JIT-Konten erben den Tenant-Standard, solange keine
explizite Praeferenz ueber die Mitglieder-API gesetzt wurde. Die Auswahl in den
Admin-Einstellungen und im eigenen Profil validiert ausschliesslich die fuenf
unterstuetzten Werte, prueft Rolle, Status und Tenant erneut in der
Schreibtransaktion und erzeugt ein `activity_events`-Audit.

## Serverseitige Aufloesung

`src/lib/i18n/server.ts` ist die einzige Datenzugriffsschicht fuer Locale-
Aufloesung. Empfaengerabfragen binden immer `user_id` und `organization_id` und
brechen bei einer tenantfremden oder fehlenden Identitaet ab. Browser-Header
ueberschreiben weder persistierte Nutzerwerte noch Tenant-Konfiguration.

Das Root-Layout setzt `html[lang]` und die OpenGraph-Locale auf den oeffentlich
gueltigen Tenant-Standard. Admin- und Mitgliederlayouts markieren den
authentifizierten Anwendungsbaum mit der wirksamen Nutzer-Locale und geben sie
explizit an die Client-Navigation weiter. Kernnavigation, globale Suche sowie
Login-, Passwort-, Einladungs- und Login-MFA-Flows verwenden typisierte
Dictionaries. Eine deklarierte Flaeche aus 18 zentralen Admin-/Academy-Routen
loest primaere Header-, Leer-, Formular- und Commandtexte ebenfalls zentral auf.
Dazu gehoeren insbesondere Analytics samt Mitgliedertabelle und Reset-Dialog,
Mitglieder- und Datenprofildetails, Community-Profile und Rich-Text-Eingaben,
Kursdetail und Lektionsleser sowie die zentralen Bereiche des Kurseditors.

Zusaetzliche typisierte Kataloge decken Community-Mitglieder- und Admin-
Oberflaechen, stabile Community-/Kurseditor-/Hub-Action-Codes, Sektion-/
Lektionskopien, Plattform-Custom-Code, Ankuendigungen und weitere Fachdialoge
ab. Die Vertraege vergleichen fuer `de`, `en`, `it`, `es` und `fr` identische
Keys, Interpolationsplatzhalter und nichtleere Werte; das E-Mail-Center behaelt
genau 54 gemessene Copy-Werte je Locale. Datums-, Zeit-, Dauer- und
Zahlenformatierer erhalten die wirksame Locale explizit, damit kein deutscher
Utility-Default in anderssprachige Oberflaechen durchsickert.

## Systemmails

Einladung und Passwort-Reset haben sichere Plaintext-Standardvorlagen in allen
fuenf Sprachen. HTML wird weiterhin ausschliesslich aus escaped Plaintext
erzeugt. Beim Einreihen eines Auth-Links wird die wirksame Locale zusammen mit
dem Link verschluesselt gespeichert. Das verhindert, dass Profil- oder Tenant-
Aenderungen einen bereits erzeugten Versand oder Retry nachtraeglich in eine
andere Sprache verschieben.

Lektionsfreigaben, Event-Absagen/-Neuplanungen und Feedbackantworten verwenden
die Empfaenger-Locale; der fachliche Feedbacktext und ein vom Admin verfasster
Event-Grund bleiben absichtlich unveraenderter Inhalt. Historische Outbox-
Payloads ohne Locale fallen auf Deutsch zurueck.

Das E-Mail-Center verwaltet die fuenf sicheren Vorlagen `feedback.reply`,
`lesson.available`, `course.modules.released`, `invitation.created` und
`password.reset` parallel fuer jede der fuenf Locales. Vorschau und Testversand
verwenden die explizit ausgewaehlte Sprache. Beim Speichern werden nur die fuer
das Ereignis erlaubten Variablen akzeptiert; fehlende oder historische
Locale-Einstellungen werden aus stabilen Locale-Keys beziehungsweise den
sicheren Standardvorlagen materialisiert. Dadurch aendert ein Wechsel der
Tenant-Standardsprache weder einen vorhandenen Locale-Satz noch einen bereits
eingereihten Delivery-Snapshot.

## Community-Benachrichtigungen

Mention- und Moderationsereignisse loesen die wirksame Locale fuer jeden
Empfaenger innerhalb desselben aktiven Tenants auf. Persistierte Titel und
Systemtexte werden dadurch in `de`, `en`, `it`, `es` oder `fr` materialisiert,
statt die Sprache des ausloesenden Administrators oder einen festen deutschen
Text zu uebernehmen. Fehlende oder tenantfremde Empfaenger werden nicht mit
einem unsicheren Fallback benachrichtigt. Namen sowie von Nutzern verfasste
Post-, Kommentar-, Einspruchs- oder Moderationstexte bleiben unveraenderter
Fachinhalt und werden nicht maschinell uebersetzt.

## Marktfreigabe

Die deklarierten Produktflaechen einschliesslich tiefer Kurs- und
Pruefungs-Autorenformulare, Lektions-/Pruefungsinteraktionen, Admin-Detailrouten
und Fachaktionsfehler besitzen typisierte Copy-Vertraege fuer alle fuenf
Sprachen. Von Nutzern verfasste Kurs-, Profil- und Community-Inhalte werden
absichtlich nicht automatisch uebersetzt. Vor einer kommerziellen
Volluebersetzungszusage bleiben eine muttersprachliche Fach-, Rechts- und
UX-Pruefung sowie die formale Accessibility-Abnahme erforderlich; das sind
Abnahme-Gates und keine fehlenden lokalen Produktpfade.
