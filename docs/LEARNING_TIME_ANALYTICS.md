# Aktive Lernzeit

Stand: 2026-07-12

## Messmodell

Aktive Lernzeit entsteht nur auf einer aktuell freigegebenen Lektionsroute.
Der Client startet beim Wechsel in eine sichtbare und fokussierte Ansicht eine
neue zufaellige Tracking-Sitzung und sendet alle 15 Sekunden einen monotonen
Heartbeat an `POST /api/learning-time/heartbeat`. Verstecken, Fokusverlust,
Seitennavigation und `pagehide` beenden die lokale Sitzung. Der Client liefert
keine anzurechnende Dauer; Zeit wird ausschliesslich aus Serverzeitpunkten
abgeleitet.

## Serverregeln

- Der Endpoint akzeptiert nur eine aktive same-origin Browser-Sitzung und einen
  kleinen strikt validierten JSON-Body.
- Vor jeder Annahme werden aktiver Mitgliedsstatus, Tenant, aktive
  Kurseinschreibung, publizierter Kurssnapshot und die aktuell kombinierte
  Lektionsfreigabe erneut geprueft.
- Sequenz `0` startet eine Sitzung. Danach wird nur die unmittelbar folgende
  Sequenz angenommen; Wiederholungen sind idempotent und Sequenzspruenge werden
  abgelehnt.
- Eine nutzergebundene PostgreSQL-Advisory-Lock serialisiert konkurrierende
  Tabs und Requests. Nur die zuletzt gestartete aktive Ansicht kann Zeit
  erhalten.
- Persistente Nutzer- und Tenant-Limits begrenzen auch ungueltige oder laufend
  neu gestartete Heartbeats und damit Request- sowie Zeilenwachstum.
- Intervalle unter 8 Sekunden werden nicht angenommen. Nach mehr als 30
  Sekunden ist die Sitzung abgelaufen. Ein einzelner Heartbeat kann hoechstens
  20 Sekunden und eine Tracking-Sitzung hoechstens 24 Stunden gutschreiben.
- Die Datenbank speichert pro sichtbarer Fokusphase nur den kumulierten Stand,
  nicht jeden einzelnen Heartbeat. Tenant-Fremdschluessel, positive Zaehler und
  Zeitreihenfolge werden zusaetzlich durch Constraints abgesichert.
- Jede Sitzung ist an die konkrete publizierte `course_version_id` gebunden
  und bewahrt den damaligen `lesson_title` als Snapshot-Wert. Ein
  Publikationswechsel startet zwingend eine neue Sitzung. Das Entfernen der
  Live-Lektion aus einem spaeteren Entwurf loescht deshalb weder Messhistorie
  noch DSAR-Kontext der weiterhin publizierten Version.

Diese Regeln machen die Kennzahl belastbar fuer Produktanalysen, aber nicht zu
einem rechtssicheren Anwesenheits- oder Arbeitszeitnachweis. Ein kompromittierter
Client kann weiterhin eine sichtbare fokussierte Ansicht simulieren.

## Auswertung und Datenschutz

Admin-Overview, Kurskarten, Mitgliederliste, Mitglied-Kursdetails, CSV sowie die
REST-Analytics liefern `activeLearningSeconds`. Der UI-Wert ist eindeutig als
serverseitig gemessene aktive Lernzeit bezeichnet; hinterlegte Lektionsdauer
bleibt eine getrennte Schaetzung.

Tracking-Sitzungen sind personenbezogene Lerndaten. Sie werden im DSAR mit
Kursversion, gespeichertem Lektionsnamen, gutgeschriebenen Sekunden und
Zeitpunkten ausgegeben, ohne den internen Replay-Zaehler. Der Export ist nicht
von der veraenderlichen Live-Lektion abhaengig. Bei einer freigegebenen
Betroffenenloeschung werden die Sitzungen entfernt. Es gibt bewusst keine
pauschale automatische Loeschung: Kunden muessen Lernnachweis- und
Legal-Hold-Fristen festlegen; bis dahin gilt dieselbe Retention-Entscheidung wie
fuer Fortschritt und Einschreibungen.
