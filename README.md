# Global Elevation API

A lightweight, fast, and self-hosted Node.js API that returns the elevation (height in meters) for any latitude and longitude coordinate on Earth.

This project uses the **Copernicus 30m Global DEM (COP30)** dataset from OpenTopography. Tile files are downloaded on-demand and cached locally, so the API requires zero upfront setup and only stores the data you actually query.

---

## 🚀 Features

* **Zero Setup:** No bulk download required. Just install dependencies and start the server.
* **On-Demand Tile Caching:** Individual GeoTIFF tiles (~30MB each) are fetched from OpenTopography's public S3 bucket the first time a coordinate in that tile is queried, then stored in `./data/COP30_hh/` for all future requests.
* **LRU Memory Management:** Up to `MAX_TILES` (default: 10) tile datasets are kept open in memory simultaneously. Least-recently-used tiles are automatically closed to free RAM when the limit is exceeded.
* **No External Binaries:** No need to install GDAL system tools — `gdal-async` bundles its own binaries.

---

## 📋 Prerequisites

1. **Node.js:** v18 or higher recommended.
2. **Disk Space:** Tiles are downloaded on demand (~30MB per 1°×1° tile). Storage grows only as you query new regions.
3. **Internet Access:** Required the first time a new tile or the VRT index is requested. Subsequent queries for the same region are fully local.

---

## 🛠️ Installation & Setup

```bash
npm install
```

That's it. On first start, the server downloads the VRT index file (`COP30_hh.vrt`) automatically. Individual tiles download in the background the first time each region is queried.

---

## 💻 Usage

**Development mode** (auto-restarts on file changes):

```bash
npm run dev
```

**Production mode:**

```bash
npm start
```

The server will start on `http://localhost:3000`.

---

## 📡 API Reference

### Get Elevation

Retrieves the elevation in meters for a specific coordinate.

* **URL:** `/elevation`
* **Method:** `GET`
* **Query Parameters:**
  * `lat` (float, required) - The latitude.
  * `lon` (float, required) - The longitude.

#### Example Request

```bash
curl "http://localhost:3000/elevation?lat=27.9881&lon=86.9250"
```

#### Example Response (Success)

```json
{
  "latitude": 27.9881,
  "longitude": 86.9250,
  "elevation_meters": 8848.86
}
```

#### Example Responses (Errors)

```json
// Missing Parameters
{
  "error": "Missing lat or lon parameters"
}

// Coordinates out of bounds (e.g., deep ocean depending on dataset limits)
{
  "error": "Coordinates are outside the dataset boundaries."
}
```

---

## 📂 Project Structure

```text
├── data/                    # Auto-created on first run
│   ├── COP30_hh/            # Downloaded tile .tif files (on-demand or pre-cached)
│   └── COP30_hh.vrt         # VRT index file (downloaded on startup)
├── index.js                 # Main Express server, tile caching, and GDAL logic
├── PreCache.js              # Optional script to bulk pre-download tiles for a region
├── package.json             # Project dependencies and scripts
└── README.md                # Project documentation
```

---

## 🗺️ Pre-Caching a Region

By default, tiles are downloaded on-demand the first time a coordinate in that region is queried. If you know in advance which geographic area you'll be serving, you can bulk pre-download all tiles for that region using the `PreCache.js` script.

### Configuration

Open `PreCache.js` and set the four bounding-box variables at the top of the file:

```js
const startLat = 49.97;   // Northern boundary
const startLon = -130.527; // Western boundary (negative = west)
const endLat   = 24.87;   // Southern boundary
const endLon   = -73.92;  // Eastern boundary
```

> **Longitude convention:** Both negative (`-130.5`) and 0–360 (`229.5`) formats are accepted — the script normalises them automatically.

Order doesn't matter — `startLat` can be north or south of `endLat`.

### Running the script

```bash
node PreCache.js
```

The script will:

1. Download and cache `COP30_hh.vrt` if not already present
2. Enumerate every 1°×1° tile whose SW corner falls inside the bounding box
3. Skip tiles already on disk
4. Download missing tiles one at a time, showing live download speed
5. Print a summary on completion:

```
─────────────────────────────────────────────
  Summary
─────────────────────────────────────────────
  Total tiles      : 1456
  Downloaded       : 1421
  Already cached   : 30
  Missing / failed : 5
─────────────────────────────────────────────
  Total time       : 6h 12m 3.4s
  Avg per tile     : 15.74s
─────────────────────────────────────────────
```

> **Disk space:** Each tile is roughly 20–60 MB. The contiguous USA (~1 400 tiles) requires approximately **40–60 GB** of free disk space.

---

## ⚠️ Notes

* **Ocean/NoData Values:** GeoTIFFs represent oceans or missing data with large negative numbers (like `-32768`). The API automatically normalizes values below `-10000` to `0.0`.
* **RAM Usage:** Only up to `MAX_TILES` (default: `10`) tile datasets are held open at once. Adjust the `MAX_TILES` constant in `index.js` to trade RAM for fewer re-opens of frequently accessed tiles.
* **First-Request Latency:** The first query into a new 1°×1° tile region incurs a one-time download (~30MB). All subsequent queries to that region are served from disk with no network I/O.
