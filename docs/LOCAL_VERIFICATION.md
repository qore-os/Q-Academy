# Lokale Release-Verifikation

`npm run verify:local` fuehrt die schnellen, lokalen Release-Vertraege in
fester Reihenfolge aus und stoppt beim ersten Fehler:

1. Secret-Scan
2. Third-Party-Notices
3. Drizzle-Schema-Vertrag
4. OpenAPI-Vertrag
5. Connector-Vertrag
6. Unit-Tests
7. Typecheck
8. Lint

Der Runner fuehrt nur fest definierte npm-Kommandos ohne Shell aus. Er gibt
keine Umgebungsvariablen oder Kommandoargumente aus. Ein Evidence-Report kann
in eine neue Datei geschrieben werden:

```powershell
npm run -- verify:local -- --report .data/verify-local.json
```

Ein separater Accessibility-Lauf steht direkt und ueber den Runner bereit:

```powershell
npm run test:accessibility
npm run -- verify:local -- --accessibility true
```

`--long true` ergaenzt Migrations- und Integrationstests, den verpflichtenden
Backup/Restore-Drill, Accessibility, E2E und Cross-Browser-E2E sowie den
Produktions-Build. Diese Option braucht die jeweiligen lokalen Datenbank- und
Browser-Voraussetzungen und ist bewusst nicht Teil des schnellen Standards.

Externe Gates werden einzeln ausgewaehlt und brauchen eine explizite
Bestaetigung:

```powershell
npm run -- verify:local -- --external-gate dependency-audit --ack-external EXTERNAL_GATES
npm run -- verify:local -- --external-gate ai-provider --ack-external EXTERNAL_GATES
```

Erlaubt sind `dependency-audit`, `connector-release`, `ai-provider`,
`s3-provider`, `s3-app-principal`, `clamav`, `media-processing` und `mobile`.
Provider-Gates laden die normale Projektumgebung und brechen bei fehlender
Konfiguration ab. S3-, ClamAV- und Media-Gates koennen externe Canaries
schreiben oder verarbeiten; sie duerfen nur gegen die dafuer vorgesehene
Staging-Infrastruktur laufen.

Mit `--dry-run true` wird nur der sichere Schrittplan ausgegeben. Mehrere
`--external-gate`-Optionen sind moeglich und werden in der angegebenen
Reihenfolge ausgefuehrt. Report-Dateien duerfen vorher nicht existieren.
