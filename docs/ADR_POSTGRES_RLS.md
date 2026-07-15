# ADR: PostgreSQL Row-Level Security

Status: akzeptiert  
Datum: 2026-07-13

## Kontext

Q-Academy verarbeitet viele Tenants in einem gemeinsamen PostgreSQL-Schema.
Row-Level Security (RLS) kann dabei eine zusaetzliche Datenbankschranke sein,
ersetzt aber keine korrekte Tenant-Bindung in Anwendung und Datenmodell.

Der aktuelle Stand erzwingt Tenant-Isolation durch:

- serverseitig aus Session oder API-Key abgeleitete `organization_id`-Filter,
- transaktionale Rollen-, Status- und Tenant-Revalidierung vor Mutationen,
- zusammengesetzte Unique Keys und Foreign Keys auf fachlich zusammengehoerigen
  `id`-/`organization_id`-Paaren,
- Constraints, Trigger und Advisory Locks fuer kritische Integritaets- und
  Vertragsgrenzen,
- getrennte Least-Privilege-Rollen fuer App, Migration und Medienworker sowie
- positive, negative und Cross-Tenant-Tests fuer die exponierten Workflows.

Gleichzeitig verwenden App, Worker und Operator-Jobs einen Connection Pool.
Scheduler, Retention, Provisionierung, Audit-Export, Migrationen und bestimmte
Worker muessen kontrolliert tenantuebergreifend arbeiten. Es existiert derzeit
kein lueckenloser, erzwungener Request-Vertrag, der jede Datenbankoperation in
eine Transaktion mit `SET LOCAL app.organization_id = ...` bindet.

## Entscheidung

RLS wird derzeit nicht aktiviert. Die vorhandenen tenantgebundenen Queries,
zusammengesetzten Schluessel, Datenbank-Trigger und Rollen bleiben die
verbindliche Sicherheitsbasis.

Eine teilweise Aktivierung einzelner Tabellen wuerde ein falsches
Sicherheitsgefuehl erzeugen: Tabellen ohne Policy, Verbindungen mit altem
Session-Kontext, Owner-/`BYPASSRLS`-Rollen oder tenantuebergreifende Worker
koennten die angenommene Schranke umgehen. RLS darf deshalb nur als
vollstaendiges, getestetes Defense-in-Depth-Projekt eingefuehrt werden.

## Folgen

- Jede neue Query und Mutation muss Tenant-Bindung weiterhin explizit und
  testbar herstellen.
- Direkter Datenbankzugriff fuer Tenant-Admins oder Kunden ist nicht erlaubt.
- Die App-Rolle darf weder Schema-Owner noch Superuser sein; Worker- und
  Operatorrechte bleiben getrennt und minimal.
- Ein externer Security-Test muss die aktuelle Isolation bewerten und darf RLS
  nicht als vorhandene Kontrolle annehmen.

## Neubewertung

Die Entscheidung wird neu bewertet, sobald mindestens einer dieser Ausloeser
eintritt:

- ein Enterprise-Vertrag oder Security-Audit fordert RLS,
- weitere, nicht voll vertrauenswuerdige Dienste erhalten direkten DB-Zugriff,
- der Runtime-Zugriff wird verbindlich auf eine Transaktion pro Request/Job
  umgestellt,
- eine zweite App- oder Workerimplementierung teilt das Schema oder
- Cross-Tenant-Tests zeigen, dass die bestehende Query-/FK-Schicht nicht mehr
  ausreichend wartbar ist.

## Anforderungen fuer eine Einfuehrung

Vor Aktivierung muessen alle folgenden Punkte erfuellt sein:

1. Jeder tenantgebundene Request und Job laeuft in genau einer Transaktion und
   setzt den Tenant mit `SET LOCAL`; Pool-Reuse darf keinen Kontext uebertragen.
2. App- und Workerrollen sind weder Owner noch Superuser noch `BYPASSRLS`;
   `FORCE ROW LEVEL SECURITY` und Policies decken alle tenanthaltigen Tabellen
   und Schreibpfade ab. Views muessen als Security-Invoker arbeiten und duerfen
   die zugrunde liegenden Policies nicht umgehen.
3. Tenantuebergreifende Operator-/Schedulerpfade besitzen separate, minimale
   Rollen, explizite Auftragsgrenzen und Audit statt impliziter Ausnahmen.
4. Migrationseigentum, Backup/Restore, DSAR, Retention und Medienworker werden
   mit denselben produktiven Rollen praktisch getestet.
5. Die komplette Cross-Tenant-Suite laeuft gegen die RLS-faehige Konfiguration;
   Tests decken fehlenden, falschen und nach Pool-Reuse veralteten Kontext ab.
6. Queryplaene, Locking, Pooling und Lastverhalten sind auf Staging vermessen,
   und Rollback sowie Incident-Runbook sind abgenommen.
