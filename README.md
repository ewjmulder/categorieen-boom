# Arends categorieenboom

Een kleine statische webapp om woorden interactief in hoofd- en subcategorieen te ordenen.

## Lokaal starten

Omdat het voorbeeld uit `voorbeeld.json` wordt geladen, werkt de voorbeeldknop het betrouwbaarst via een lokale webserver:

```bash
python3 -m http.server 8000
```

Open daarna `http://localhost:8000`.

## Publiceren

De app heeft geen buildstap en geen dependencies. Publiceer deze bestanden samen op een gewone statische host:

- `index.html`
- `styles.css`
- `app.js`
- `voorbeeld.json`

## Gegevens

De boom wordt automatisch opgeslagen in `localStorage` van de browser. Met **JSON exporteren** kun je een kopie downloaden.

`voorbeeld.json` bevat de voorbeeldboom en kan handmatig worden aangepast.
