# Rollenhandbuch

Stand: 2026-07-13.

Dieses Dokument ist der lokale Einstieg fuer Owner, Trainer und Mitglieder.
Welche Menuepunkte sichtbar und welche Aktionen erlaubt sind, bestimmt immer
die serverseitige Rolle beziehungsweise eine zugewiesene Custom-Rolle.

## Owner

Owner verwalten die Academy im Bereich `/admin`.

- **Mitglieder:** Unter `/admin/members` einladen, importieren, aktivieren,
  Gruppen/Bundles zuweisen, Profile pflegen und bei einem geeigneten aktiven
  Admin die Owner-Uebergabe starten. Die Uebergabe verlangt ein frisches
  Passwort- oder OIDC-Step-up und meldet beide beteiligten Konten ab.
- **Kurse:** Unter `/admin/courses` Kurse erstellen; Module, Sektionen,
  Lektionen, Seiten und typisierte Bloecke bearbeiten; Vorschau pruefen und eine
  versionierte Veroeffentlichung ausloesen. Kategorien mit Farbe, Beschreibung
  und Reihenfolge werden in derselben Kursverwaltung gepflegt. Die Kursoption
  fuer Modulfreigabe-Mails benachrichtigt berechtigte aktive Enrollments nur
  bei einer neuen Publikation mit neu zugaenglichen Modulen; ein ablaufendes
  Datumsfenster allein loest keine Mail aus. Medien werden erst nach Upload und
  Scan als `ready` gebunden.
- **Zugriff:** Kurs-, Gruppen- und Bundle-Zuweisungen sowie Drip-/
  Sichtbarkeitsregeln konfigurieren. Custom-Rollen liegen unter
  `/admin/settings/roles`; Ownerrechte selbst sind nicht delegierbar.
- **Plattform:** Branding, Theme, Locale, MFA-/SSO-Policy, verifizierte Custom
  Domain und Vertragsauslastung unter `/admin/settings` verwalten oder pruefen.
  Dort werden auch geordnete Mitglieder-Sidebarlinks mit internem Pfad oder
  HTTPS-Ziel sowie Dashboard oder Community als native App-Startansicht gesetzt.
- **Community:** Unter `/admin/community` geordnete Areas und darin liegende
  Feed-, Diskussions- oder Ankuendigungsforen pflegen, Foren zwischen Areas
  verschieben und Rich-Text-Beitraege moderieren. Die oeffentlichen Profilfelder
  werden explizit aus sicheren Standard- und freigegebenen Custom-Feldern
  zusammengestellt; als Pflicht markierte Felder koennen das Erstellen neuer
  Posts und Kommentare bis zur Profilvervollstaendigung sperren.
- **Kommunikation:** Vorlagen und Versandhistorie unter `/admin/email`, aktive
  Bounce-/Complaint-Sperren unter `/admin/email/suppressions`, Events unter
  `/admin/events` und Ankuendigungen unter `/admin/announcements` verwalten.
- **Datenschutz und Audit:** DSAR-Faelle unter `/admin/privacy` bearbeiten.
  Tenant-Audit-Exporte sind ein Operatorvorgang und in
  [AUDIT_EXPORT.md](./AUDIT_EXPORT.md) beschrieben.

Owner sollten mindestens einen Wiederherstellungsweg fuer MFA und SSO getrennt
vom Alltagsgeraet aufbewahren. Tokens, Recovery-Codes und Einmallinks gehoeren
nie in Supporttickets.

## Trainer und Admins mit Custom-Rolle

Trainer sehen nur die durch Basis- und Custom-Rolle sowie Kurs-Teamzuweisung
freigegebenen Adminbereiche.

- Zugewiesene Kurse bearbeiten, Vorschau und Publish-Diff pruefen.
- Abgaben mit Score, Rich-Text-Kommentar sowie Text- oder Medienzeitmarken
  bewerten.
- Mitglieder-, Community-, Event-, Analytics- oder KI-Bereiche nur verwenden,
  wenn das entsprechende sichtbare Recht erteilt wurde.
- Keine Owner-Uebergabe, Vertragsaenderung oder nicht delegierte
  Sicherheitseinstellung vornehmen.

Eine ausgeblendete Aktion darf nicht durch eine direkte URL oder API umgangen
werden; die Serverpolicy prueft Rolle, Status und Tenant erneut. Unerwartete
`403`-Antworten werden deshalb ueber den Owner geklaert, nicht durch erweiterte
Kontofreigaben auf Verdacht.

## Mitglieder

Mitglieder arbeiten im Bereich `/academy`.

- Auf `/academy` beziehungsweise `/academy/hub` den persoenlichen Einstieg
  oeffnen und unter `/academy/courses` freigegebene Kurse starten.
- Lektionen in der vorgegebenen Reihenfolge bearbeiten, Pflichtmedien ansehen,
  Aufgaben/Pruefungen abgeben und Fortschritt fortsetzen. Zugaengliche Lektionen
  lassen sich direkt merken; `/academy/bookmarks` gruppiert die weiterhin
  zugaenglichen Lesezeichen nach Kurs und Modul.
- Unter `/academy/events` Events ansehen, zusagen und Kalenderdateien laden.
- Unter `/academy/community` nur die freigegebenen, nach Area gruppierten Foren
  lesen oder darin mit formatierten Posts und Kommentaren schreiben. Eine
  Kurskarte ist eine serverseitig sichtbarkeitsgepruefte Kursreferenz, kein
  freier Link. Namen und Avatare fuehren zum konfigurierten oeffentlichen Profil,
  das weder E-Mail noch Telefon zeigt. Verlangt der Tenant Pflichtfelder, nennt
  die Schreibsperre die fehlenden Felder und fuehrt zur eigenen Profilpflege;
  Melde- und Moderationsstatus bleiben vertraulich.
- Unter `/academy/certificates` ausgestellte Nachweise ansehen und unter
  `/academy/profile` Sprache, Theme, Profile, optionale Telefonnummer,
  erlaubte Eigenschaften und E-Mail-/Push-Kategorien pflegen. Das
  In-App-Benachrichtigungscenter bleibt immer aktiv.
- KI-Agenten nur verwenden, wenn der Tenant sie freigegeben hat und der
  Transparenzhinweis bestaetigt wurde. Der normale Lernbetrieb bleibt bei einem
  Provider-Ausfall verfuegbar.

## Hilfe und Datenschutz

Der in der Academy konfigurierte Supportkontakt und die Legal-Links sind die
verbindlichen Kundenkontakte. Eine Anfrage sollte Tenant, Zeitpunkt, Route und
angezeigte Request-ID enthalten, aber keine Passwoerter, Tokens, Prompts oder
personenbezogenen Exportdateien. Betroffenenanfragen werden nicht als normales
Supportticket abgeschlossen, sondern durch den Owner im DSAR-Workflow erfasst.

Weitere Fachvertraege stehen im [E-Mail-Vertrag](./MAIL_GATEWAY_CONTRACT.md), in
[Lokalisierung](./LOCALIZATION.md), [Medienverarbeitung](./MEDIA_PROCESSING.md),
[OIDC](./OIDC_SSO.md), [MFA](./MFA_SECURITY.md) und
[Daten/Retention/DSAR](./DATA_RETENTION_AND_DSAR.md).
