# FMR Geotag App

Offline-first Apache Cordova application for geotagging Farm-to-Market
Roads (FMR). Supports two survey modes — **50 Meter Segment Mode** and
**Pathway Mode** — with GPS capture, camera photos, SQLite storage,
offline (Leaflet-based) mapping, and multi-format export (ZIP, JSON,
CSV, GPX, GeoJSON). The app requires **no internet connection** at any
point; all libraries (Bootstrap 5, Bootstrap Icons, Leaflet, JSZip) are
bundled locally under `www/lib/`.

---

## 1. Project Structure

```
fmr-geotag-app/
├── config.xml                 Cordova app config, permissions, plugins
├── package.json                npm/cordova project + plugin manifest
├── README.md                   this file
└── www/
    ├── index.html               single-page app shell (all screens)
    ├── css/style.css             green agricultural theme, dark mode
    ├── lib/                      bundled offline vendor libraries
    │   ├── bootstrap/            Bootstrap 5 CSS + JS
    │   ├── bootstrap-icons/      icon font
    │   ├── leaflet/              Leaflet JS/CSS + marker images
    │   └── jszip.min.js          ZIP creation (see note below)
    ├── js/
    │   ├── utils.js              formatting, geo-math, toast/loading UI
    │   ├── db.js                 SQLite schema + CRUD (Projects, Segments,
    │   │                         Tracks, Photos, Settings, SyncQueue)
    │   ├── folderCreator.js      cordova-plugin-file folder/file builder
    │   ├── gps.js                foreground + background GPS service
    │   ├── camera.js             cordova-plugin-camera wrapper
    │   ├── mapService.js         Leaflet offline map + canvas snapshot
    │   ├── exportManager.js      GPX/GeoJSON/CSV builders + ZIP export
    │   ├── survey50.js           50m Segment Mode controller
    │   ├── pathway.js            Pathway Mode controller
    │   ├── settings.js           Settings screen bindings
    │   ├── history.js            Previous Surveys + Export screens
    │   └── app.js                router / screen lifecycle / startup
    └── res/                      icons + splash screens (all densities)
```

---

## 2. Important implementation notes

- **`cordova-background-geolocation-lt`** is used for Pathway Mode's
  background tracking instead of the (paid, closed-source) Transistorsoft
  `cordova-plugin-background-geolocation`. It is free/MIT-licensed and
  gives the same "keep recording while backgrounded" behavior requested
  in the spec. If your team has a Transistorsoft license, swap the plugin
  reference in `config.xml`/`package.json` and adjust the small
  `startBackgroundTracking()` block in `www/js/gps.js` — the rest of the
  app is unaffected since it only talks to that one function.
- **ZIP creation** uses the bundled **JSZip** library rather than
  `cordova-plugin-zip`. That plugin only implements *extraction*; there
  is no maintained Cordova plugin that creates ZIP files on-device.
  `cordova-plugin-zip` is still installed per the spec and is available
  for any future on-device *unzip* need (e.g. importing offline map tile
  packs). JSZip runs entirely client-side with no network calls, so the
  offline requirement is preserved.
- **Offline map tiles**: `mapService.js` points Leaflet at a local
  folder of pre-downloaded XYZ tiles (configurable path). If no tile set
  is present on the device, the map still renders (GPS marker, path,
  segment pins) over a neutral grid background instead of blank/broken
  tiles — the app never depends on a live tile server.
- **SQLite**: `db.js` uses `cordova-sqlite-storage` (`window.sqlitePlugin`)
  for a real, file-backed, offline database. When previewing in a plain
  desktop browser (no Cordova runtime), it transparently swaps to an
  in-memory store with an identical API so the UI can still be exercised.
- **Folder structure on device** exactly matches the spec:
  `FMR_Geotag/<Project>_<Date>_<Time>/Segment_N/{photo.jpg,gps.json,metadata.json}`
  for 50m surveys, and `.../Track/{track.json,track.gpx,track.geojson}`
  + `photos/` + `map_snapshot.png` + `summary.json` for Pathway surveys.
  Exports (ZIP/CSV/JSON/GPX/GeoJSON) are written to `FMR_Geotag/exports/`.

---

## 3. Prerequisites

- Node.js 18+ and npm
- Apache Cordova CLI: `npm install -g cordova`
- **Android build**: Android Studio + Android SDK (API 34), JDK 17
- **iOS build**: macOS with Xcode 15+, CocoaPods (`sudo gem install cocoapods`)

---

## 4. Setup

```bash
cd fmr-geotag-app
npm install

# Add platforms
cordova platform add android
cordova platform add ios     # macOS only

# Install plugins (already declared in config.xml / package.json,
# but if starting from a fresh clone without node_modules/plugins):
cordova prepare
```

---

## 5. Android build

```bash
cordova build android                 # debug APK
cordova build android --release       # release (unsigned) APK

# Run directly on a connected device/emulator
cordova run android
```

Signing a release build (once you have a keystore):

```bash
cordova build android --release -- \
  --keystore=/path/to/release.keystore \
  --storePassword=YOUR_STORE_PASSWORD \
  --alias=YOUR_KEY_ALIAS \
  --password=YOUR_KEY_PASSWORD
```

The signed APK/AAB will be under
`platforms/android/app/build/outputs/`.

**Runtime permissions**: on first launch the app requests Location
(fine + background) and Camera permissions. Background location must be
granted as "Allow all the time" for Pathway Mode to keep recording while
the screen is off — walk the user through this once during onboarding.

---

## 6. iOS build

```bash
cordova build ios
open platforms/ios/FMR\ Geotag.xcworkspace
```

In Xcode:
1. Select your development team under *Signing & Capabilities*.
2. Ensure **Background Modes → Location updates** is checked (already
   configured via `config.xml`, but verify after `cordova prepare`).
3. Build & run on a physical device (Location Simulator does not
   exercise background tracking reliably) via *Product → Run*, or
   archive via *Product → Archive* for TestFlight/App Store submission.

---

## 7. Offline map tiles (optional but recommended)

The app works without pre-cached tiles (falls back to a neutral grid),
but for real field use:

1. Use a tool such as MOBAC, QGIS, or `gdal2tiles.py` to generate an
   XYZ tile pyramid (`{z}/{x}/{y}.png`) for your survey area at zoom
   levels ~14–19.
2. Copy the resulting folder onto the device under
   `FMR_Geotag/maps/<your-tileset>/`.
3. Set that path as the "Offline Map Folder" in **Settings**.

---

## 8. Testing without a device

Because `db.js`, `folderCreator.js`, `camera.js`, and `gps.js` all
detect the presence (or absence) of their respective Cordova plugins and
fall back to safe in-browser equivalents, you can preview the UI quickly
with any static file server:

```bash
cd www
python3 -m http.server 8080
# open http://localhost:8080 in a desktop browser
```

Note: real GPS/camera/background-tracking/file-persistence behavior can
only be verified on an actual Android or iOS device/emulator with the
Cordova plugins installed.

---

## 9. Data model summary (SQLite)

| Table      | Purpose                                              |
|------------|-------------------------------------------------------|
| Projects   | One row per survey (type: `segment` or `pathway`)     |
| Segments   | One row per captured 50m segment (photo + GPS)        |
| Tracks     | One row per recorded GPS point in Pathway Mode         |
| Photos     | One row per captured photo, linked to project/segment |
| Settings   | Key/value app preferences                              |
| SyncQueue  | Reserved for a future optional server-sync feature     |

All tables are created automatically on first launch by `db.js`.
