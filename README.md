# Arends categorieenboom

Een kleine statische webapp om woorden interactief in hoofd- en subcategorieen te ordenen.

## Lokaal starten

Omdat het voorbeeld uit `voorbeeld.json` wordt geladen, werkt de voorbeeldknop het betrouwbaarst via een lokale webserver:

```bash
python3 -m http.server 8000
```

Open daarna `http://localhost:8000`.

## Publiceren met Firebase Hosting

De app heeft geen buildstap en geen dependencies. Voor deployment is alleen de
[Firebase CLI](https://firebase.google.com/docs/cli) nodig.

1. Installeer de CLI en log in:

```bash
npm install -g firebase-tools
firebase login
```

Gebruik `firebase login --reauth` als de CLI meldt dat bestaande inloggegevens
zijn verlopen.

2. Deploy de site en Firestore-regels:

```bash
./deploy.sh
```

De app gebruikt Firebase Hosting en Cloud Firestore in project
`categorieen-boom`. Het script publiceert de statische website en de
Firestore-regels samen. HTML, CSS en JavaScript krijgen `Cache-Control:
no-store`; het script controleert die live headers na iedere deployment.

## Gegevens

De volledige sessie wordt automatisch opgeslagen in `localStorage` van de browser.
Met **JSON exporteren** download je een transporteerbaar bestand met:

- de volledige categorieboom;
- alle beschikbare en zelf toegevoegde woorden;
- verwijderde woorden en alle plaatsingen;
- de actieve modus en scrollpositie.

Met **JSON importeren** laad je zo'n bestand op een ander apparaat of in een
andere browser weer in. Eerdere exports met formaatversie 1 blijven ondersteund.

Met **Bomen opslaan/laden** kan dezelfde volledige state publiek in Cloud
Firestore worden opgeslagen. Iedere boom krijgt een unieke ID, waardoor
verschillende bomen dezelfde zichtbare naam mogen hebben. Na het laden blijft de
Firebase-ID lokaal gekoppeld; opnieuw opslaan werkt dan diezelfde boom bij.
Bij het opslaan wordt ook de naam van de maker vastgelegd en in de openbare
bomenlijst getoond.

De gedeelde bomen zijn bewust zonder account leesbaar en overschrijfbaar. De
regels beperken documenten wel tot het verwachte formaat en staan verwijderen
niet toe.

`voorbeeld.json` bevat de voorbeeldboom en kan handmatig worden aangepast.

`woorden.json` bevat de losse woorden voor de Plaatsmodus. Ieder woord heeft een vaste `id`, een zichtbaar `label` en een kleurvariant.

Via het pluskaartje achteraan de woordlade kunnen ook eigen woorden worden toegevoegd. Deze worden lokaal bij de boom opgeslagen.

## Modi

- **Bouwmodus**: categorieen toevoegen, bewerken, invoegen en verwijderen.
- **Plaatsmodus**: losse concrete woorden uit de onderste lade naar categorieen slepen.

Geplaatste woorden worden apart van de categorieboom opgeslagen. Ze zijn alleen zichtbaar in Plaatsmodus en tellen niet mee in de categoriestatistieken.
