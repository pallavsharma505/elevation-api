const express = require("express");
const gdal = require("gdal-async");
const { LRUCache } = require("lru-cache");
const https = require("https");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Maximum number of tile datasets to keep open in memory simultaneously.
// Adjust this to balance RAM usage vs. how often tile files need to be re-opened.
const MAX_TILES = 10;

const DATA_DIR = path.join(__dirname, "data");
const TILES_DIR = path.join(DATA_DIR, "COP30_hh");
const VRT_LOCAL_PATH = path.join(DATA_DIR, "COP30_hh.vrt");
const VRT_REMOTE_URL =
    "https://opentopography.s3.sdsc.edu/raster/COP30/COP30_hh.vrt";
const TILE_BASE_URL =
    "https://opentopography.s3.sdsc.edu/raster/COP30/COP30_hh/";

// LRU cache: tile filename → { dataset, band }
// When a tile is evicted, its GDAL dataset is closed to free RAM.
const tileCache = new LRUCache({
    max: MAX_TILES,
    dispose(value) {
        value.dataset.close();
    },
});

// Tracks in-flight tile downloads to prevent duplicate concurrent downloads.
const pendingDownloads = new Map();

/**
 * Derive the COP30 tile filename that covers the given lat/lon.
 * Tiles are 1°×1°, named by their SW corner:
 *   Copernicus_DSM_10_N{lat}_00_{E|W}{lon}_00_DEM.tif
 */
function getTileName(lat, lon) {
    const latDeg = Math.floor(lat);
    const lonDeg = Math.floor(lon);
    const latPfx = latDeg >= 0 ? "N" : "S";
    const lonPfx = lonDeg >= 0 ? "E" : "W";
    const latAbs = String(Math.abs(latDeg)).padStart(2, "0");
    const lonAbs = String(Math.abs(lonDeg)).padStart(3, "0");
    return `Copernicus_DSM_10_${latPfx}${latAbs}_00_${lonPfx}${lonAbs}_00_DEM.tif`;
}

/**
 * Download a file from a public HTTPS URL to destPath.
 * Writes to a .tmp file first, then renames atomically on success.
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const tmpPath = `${destPath}.tmp`;
        const file = fs.createWriteStream(tmpPath);

        https
            .get(url, (response) => {
                if (response.statusCode === 404) {
                    file.close();
                    fs.unlink(tmpPath, () => {});
                    const err = new Error(`Not found: ${url}`);
                    err.code = "TILE_NOT_FOUND";
                    return reject(err);
                }
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(tmpPath, () => {});
                    return reject(
                        new Error(`HTTP ${response.statusCode} for ${url}`),
                    );
                }
                response.pipe(file);
                file.on("finish", () => {
                    file.close(() => {
                        fs.rename(tmpPath, destPath, (renameErr) => {
                            if (renameErr) reject(renameErr);
                            else resolve();
                        });
                    });
                });
                file.on("error", (err) => {
                    fs.unlink(tmpPath, () => {});
                    reject(err);
                });
            })
            .on("error", (err) => {
                file.close();
                fs.unlink(tmpPath, () => {});
                reject(err);
            });
    });
}

/**
 * Ensure the VRT index file is cached locally.
 * The VRT is downloaded once and reused; it is not used as an active GDAL
 * source — it serves as an offline reference for the tile layout.
 */
async function ensureVrt() {
    if (!fs.existsSync(VRT_LOCAL_PATH)) {
        console.log("Downloading VRT index file...");
        await downloadFile(VRT_REMOTE_URL, VRT_LOCAL_PATH);
        console.log(`VRT cached at ${VRT_LOCAL_PATH}`);
    }
}

/**
 * Ensure a tile GeoTIFF is present on disk, downloading it from S3 if needed.
 * Concurrent requests for the same tile share a single download promise.
 */
async function ensureTile(tileName) {
    const tilePath = path.join(TILES_DIR, tileName);
    if (fs.existsSync(tilePath)) return tilePath;

    if (pendingDownloads.has(tileName)) {
        await pendingDownloads.get(tileName);
        return tilePath;
    }

    console.log(`Downloading tile: ${tileName}`);
    const download = downloadFile(TILE_BASE_URL + tileName, tilePath).finally(
        () => pendingDownloads.delete(tileName),
    );
    pendingDownloads.set(tileName, download);
    await download;
    console.log(`Tile cached: ${tileName}`);
    return tilePath;
}

/**
 * Return the LRU-cached { dataset, band } entry for a tile, opening it first
 * if it is not currently in the cache (and downloading it if not on disk).
 * When MAX_TILES is exceeded, the least-recently-used tile dataset is closed.
 */
async function getTileEntry(tileName) {
    if (tileCache.has(tileName)) {
        return tileCache.get(tileName);
    }

    const tilePath = await ensureTile(tileName);
    const dataset = await gdal.openAsync(tilePath);
    const band = dataset.bands.get(1);
    const entry = { dataset, band };
    tileCache.set(tileName, entry);
    return entry;
}

app.get("/elevation", async (req, res) => {
    const latStr = req.query.lat;
    const lonStr = req.query.lon;

    if (!latStr || !lonStr) {
        return res.status(400).json({ error: "Missing lat or lon parameters" });
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: "Invalid coordinates" });
    }

    if (lat < -90 || lat > 84 || lon < -180 || lon > 180) {
        return res
            .status(404)
            .json({ error: "Coordinates are outside the dataset boundaries." });
    }

    try {
        const tileName = getTileName(lat, lon);
        const { band, dataset } = await getTileEntry(tileName);
        const transform = dataset.geoTransform;

        const col = Math.floor((lon - transform[0]) / transform[1]);
        const row = Math.floor((lat - transform[3]) / transform[5]);

        if (
            col < 0 ||
            col >= dataset.rasterSize.x ||
            row < 0 ||
            row >= dataset.rasterSize.y
        ) {
            return res
                .status(404)
                .json({ error: "Coordinates are outside the tile boundaries." });
        }

        let elevation = await band.pixels.getAsync(col, row);
        if (elevation !== null && elevation < -10000) {
            elevation = 0.0;
        }

        return res.json({
            latitude: lat,
            longitude: lon,
            elevation_meters: elevation,
        });
    } catch (err) {
        if (err.code === "TILE_NOT_FOUND") {
            return res
                .status(404)
                .json({ error: "No elevation data for these coordinates." });
        }
        console.error("Failed to fetch elevation:", err);
        return res
            .status(500)
            .json({ error: "Internal server error processing elevation." });
    }
});

async function startup() {
    fs.mkdirSync(TILES_DIR, { recursive: true });
    await ensureVrt();
    console.log("Server ready!");
}

startup()
    .then(() => {
        app.listen(PORT, () => {
            console.log(
                `Global Elevation API running on http://localhost:${PORT}`,
            );
        });
    })
    .catch((err) => {
        console.error("Startup failed:", err);
        process.exit(1);
    });
