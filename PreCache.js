const https = require("https");
const fs = require("fs");
const path = require("path");

// ─── Bounding box to pre-cache ────────────────────────────────────────────────
// Tiles are 1°×1°. All tiles whose SW corner falls within [startLat..endLat]
// × [startLon..endLon] will be downloaded.
const startLat = 49.97;
const startLon = -130.527;
const endLat = 24.87;
const endLon = -73.92;
// ─────────────────────────────────────────────────────────────────────────────


const DATA_DIR = path.join(__dirname, "data");
const TILES_DIR = path.join(DATA_DIR, "COP30_hh");
const VRT_LOCAL_PATH = path.join(DATA_DIR, "COP30_hh.vrt");
const VRT_REMOTE_URL =
    "https://opentopography.s3.sdsc.edu/raster/COP30/COP30_hh.vrt";
const TILE_BASE_URL =
    "https://opentopography.s3.sdsc.edu/raster/COP30/COP30_hh/";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function ensureVrt() {
    if (fs.existsSync(VRT_LOCAL_PATH)) {
        console.log(`VRT already cached: ${VRT_LOCAL_PATH}`);
        return;
    }
    process.stdout.write("\rVRT index    | Downloading COP30_hh.vrt...");
    await downloadFile(VRT_REMOTE_URL, VRT_LOCAL_PATH);
    process.stdout.write("\rVRT index    | ✓ Cached COP30_hh.vrt          \n");
}

function getTileName(lat, lon) {
    const latDeg = Math.floor(lat);
    const lonDeg = Math.floor(lon);
    const latPfx = latDeg >= 0 ? "N" : "S";
    const lonPfx = lonDeg >= 0 ? "E" : "W";
    const latAbs = String(Math.abs(latDeg)).padStart(2, "0");
    const lonAbs = String(Math.abs(lonDeg)).padStart(3, "0");
    return `Copernicus_DSM_10_${latPfx}${latAbs}_00_${lonPfx}${lonAbs}_00_DEM.tif`;
}

function downloadFile(url, destPath, onProgress) {
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
                let bytesReceived = 0;
                response.on("data", (chunk) => {
                    bytesReceived += chunk.length;
                    if (onProgress) onProgress(bytesReceived);
                });
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    fs.mkdirSync(TILES_DIR, { recursive: true });
    await ensureVrt();

    const minLat = Math.floor(Math.min(startLat, endLat));
    const maxLat = Math.floor(Math.max(startLat, endLat));

    // Normalize longitudes: some users express western longitudes in the 0–360
    // range (e.g. 270 instead of -90). Subtract 360 for any value above 180.
    const normLon = (lon) => (lon > 180 ? lon - 360 : lon);
    const minLon = Math.floor(Math.min(normLon(startLon), normLon(endLon)));
    const maxLon = Math.floor(Math.max(normLon(startLon), normLon(endLon)));

    // Collect all tile names in the bounding box.
    const tiles = [];
    for (let lat = minLat; lat <= maxLat; lat++) {
        for (let lon = minLon; lon <= maxLon; lon++) {
            tiles.push(getTileName(lat, lon));
        }
    }

    const total = tiles.length;
    let skipped = 0;
    let failed = 0;
    const tileDurations = []; // ms per successfully downloaded tile

    console.log(
        `\nPre-caching ${total} tile(s) for bbox ` +
        `[${minLat}°..${maxLat}°, ${minLon}°..${maxLon}°] ` +
        `downloading sequentially\n`,
    );

    const pad = String(total).length;
    const totalStart = performance.now();

    const tasks = tiles.map((tileName, i) => async () => {
        const prefix = `[${String(i + 1).padStart(pad)}/${total}]`;
        const tilePath = path.join(TILES_DIR, tileName);

        if (fs.existsSync(tilePath)) {
            skipped++;
            process.stdout.write(`\r${prefix} Already cached: ${tileName}   \n`);
            return;
        }

        const tileStart = performance.now();
        let bytesDownloaded = 0;

        const speedInterval = setInterval(() => {
            const elapsedSec = (performance.now() - tileStart) / 1000;
            const speedMBps = elapsedSec > 0
                ? (bytesDownloaded / 1024 / 1024 / elapsedSec).toFixed(2)
                : "0.00";
            process.stdout.write(
                `\r${prefix} Downloading:    ${tileName}  ${speedMBps} MB/s`,
            );
        }, 250);

        try {
            await downloadFile(TILE_BASE_URL + tileName, tilePath, (bytes) => {
                bytesDownloaded = bytes;
            });
            clearInterval(speedInterval);
            const elapsedMs = performance.now() - tileStart;
            tileDurations.push(elapsedMs);
            const elapsed = (elapsedMs / 1000).toFixed(2);
            const sizeMB = (bytesDownloaded / 1024 / 1024).toFixed(2);
            const avgSpeedMBps = (bytesDownloaded / 1024 / 1024 / (elapsedMs / 1000)).toFixed(2);
            process.stdout.write(
                `\r${prefix} ✓ Cached:       ${tileName}  (${sizeMB} MB in ${elapsed}s @ ${avgSpeedMBps} MB/s)   \n`,
            );
        } catch (err) {
            clearInterval(speedInterval);
            failed++;
            const elapsed = ((performance.now() - tileStart) / 1000).toFixed(2);
            if (err.code === "TILE_NOT_FOUND") {
                process.stdout.write(
                    `\r${prefix} ✗ No data:      ${tileName} (ocean/missing, ${elapsed}s)   \n`,
                );
            } else {
                process.stdout.write(
                    `\r${prefix} ✗ ERROR:        ${tileName} — ${err.message} (${elapsed}s)   \n`,
                );
            }
        }
    });

    for (const task of tasks) await task();

    const totalElapsedMs = performance.now() - totalStart;
    const downloaded = total - skipped - failed;

    const fmt = (ms) =>
        ms >= 60000
            ? `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(1)}s`
            : `${(ms / 1000).toFixed(2)}s`;

    const avgMs =
        tileDurations.length > 0
            ? tileDurations.reduce((a, b) => a + b, 0) / tileDurations.length
            : 0;

    console.log(`
─────────────────────────────────────────────
  Summary
─────────────────────────────────────────────
  Total tiles      : ${total}
  Downloaded       : ${downloaded}
  Already cached   : ${skipped}
  Missing / failed : ${failed}
─────────────────────────────────────────────
  Total time       : ${fmt(totalElapsedMs)}
  Avg per tile     : ${downloaded > 0 ? fmt(avgMs) : "n/a"}
─────────────────────────────────────────────`);
}

main().catch((err) => {
    console.error("Pre-cache failed:", err);
    process.exit(1);
});
