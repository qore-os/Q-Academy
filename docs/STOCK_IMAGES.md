# Stockbild-Provider

Die Stockbildsuche ist optional. Sie erscheint im Kurs-Builder nur, wenn alle
folgenden Werte gesetzt und gueltig sind:

```dotenv
STOCK_IMAGE_PROVIDER_NAME=Example Stock
STOCK_IMAGE_PROVIDER_BASE_URL=https://api.stock.example/v1/
STOCK_IMAGE_PROVIDER_API_KEY=...
STOCK_IMAGE_ALLOWED_HOSTS=api.stock.example,cdn.stock.example
```

Die Basis-URL und jede vom Provider gelieferte URL muessen HTTPS verwenden.
Benutzerinformationen in URLs, andere Ports, Wildcard-Hosts, Redirects,
private/reservierte DNS-Ziele, gemischte oeffentliche/private DNS-Antworten,
komprimierte Antworten und uebergrosse Bodies werden abgewiesen. DNS wird vor
jedem Serverabruf validiert und die HTTPS-Verbindung an die validierte Adresse
gebunden. Der API-Key bleibt ausschliesslich serverseitig.

## Provider-Vertrag

`GET {base}/search?query=...&page=1&per_page=12` liefert:

```json
{
  "page": 1,
  "perPage": 12,
  "total": 1,
  "results": [
    {
      "id": "photo-1",
      "previewUrl": "https://cdn.stock.example/preview.jpg",
      "imageUrl": "https://cdn.stock.example/image.jpg",
      "width": 1600,
      "height": 900,
      "alt": "Alternativtext oder null",
      "author": "Name",
      "authorUrl": "https://api.stock.example/authors/name",
      "sourceUrl": "https://api.stock.example/photos/photo-1",
      "downloadTrackingUrl": "https://api.stock.example/track/photo-1",
      "attribution": "Photo by Name"
    }
  ]
}
```

`GET {base}/images/{id}` liefert dasselbe Bild unter `{ "image": ... }`.
Bei einer Auswahl ruft Q-Academy die aktuelle Detailressource erneut ab und
anschliessend zwingend `downloadTrackingUrl`. Beide Antworten muessen
`application/json` mit HTTP 200 liefern. Erst danach wird die Auswahl mit
Attribution gespeichert. Suchbegriffe werden nicht persistiert; Auswahlzeilen
laufen nach 30 Tagen ab, waehrend verwendete Kursbloecke die notwendige
Attribution ohne API-Key oder Tracking-URL einfrieren.
