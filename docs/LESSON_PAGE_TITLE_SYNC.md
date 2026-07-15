# Synchronisierung von Lektions- und Seitentiteln

## Invariante

- Pro Lektion kann hoechstens eine Seite gekoppelt sein.
- Nur die nach `sort_order, id` erste Seite darf gekoppelt sein.
- Eine Titelmutation an der gekoppelten Lektion oder Seite aktualisiert beide
  Datensaetze atomar.
- Das Wiederherstellen der Kopplung verwendet den Lektionstitel als Quelle.
- Wird die gekoppelte Seite nach hinten verschoben oder geloescht, wird die
  Kopplung deaktiviert. Die neue erste Seite wird nicht automatisch umbenannt.
- Neu erstellte erste Seiten sind standardmaessig gekoppelt. Weitere Seiten
  bleiben standardmaessig unabhaengig.

Alle API- und Builder-Mutationen verwenden einen gemeinsamen Service mit einem
lektionsspezifischen Advisory Lock und Row Locks. Ein partieller Unique-Index
sichert zusaetzlich ab, dass nicht mehrere Seiten derselben Lektion gekoppelt
werden koennen.

## Bestandsdaten und Backfill

Migration `0027_lesson_page_title_sync.sql` setzt die neue Spalte fuer alle
Bestandsseiten auf `false`. Es werden bewusst weder Lektions- noch Seitentitel
umbenannt. Damit bleiben historisch unterschiedliche Titel unveraendert.

Eine spaetere, bewusst ausgeloeste Backfill-Aktion darf nur erste Seiten
koppeln, deren normalisierte Titel bereits exakt dem Lektionstitel entsprechen.
Sie muss tenantweise, unter denselben Service-Locks und mit einem Audit-Nachweis
laufen. Unterschiedliche Titel duerfen nie automatisch angeglichen werden.

## Klonen und Generierung

- Beim Kursklonen wird eine bestehende gueltige Kopplung auf die geklonte erste
  Seite uebertragen.
- Bei neu KI-generierten Lektionen wird die erste Seite auf den Lektionstitel
  gesetzt und gekoppelt.
- Reorder- und Delete-Operationen uebertragen die Kopplung nicht auf andere
  Bestandsseiten.
