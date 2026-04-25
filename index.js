const express = require("express");
const gdal = require("gdal-async");

const app = express();
const PORT = process.env.PORT || 3000;

// Tell GDAL to stream directly from the public S3 endpoint via HTTP
const VRT_PATH =
    "/vsicurl/https://opentopography.s3.sdsc.edu/raster/COP30/COP30_hh.vrt";

console.log(
    "Opening remote dataset... (this may take a few seconds on startup)",
);

// Open the remote VRT dataset.
// GDAL will fetch the XML headers over the network.
const dataset = gdal.open(VRT_PATH);
const transform = dataset.geoTransform;
const band = dataset.bands.get(1);

console.log("Dataset ready!");

app.get("/elevation", (req, res) => {
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

    try {
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
                .json({
                    error: "Coordinates are outside the dataset boundaries.",
                });
        }

        // When this runs, GDAL makes a tiny HTTP Range Request to the specific
        // .tif file on OpenTopography's server to grab just this one pixel.
        let elevation = band.pixels.get(col, row);

        if (elevation !== null && elevation < -10000) {
            elevation = 0.0;
        }

        return res.json({
            latitude: lat,
            longitude: lon,
            elevation_meters: elevation,
        });
    } catch (err) {
        console.error("Failed to fetch elevation:", err);
        return res
            .status(500)
            .json({ error: "Internal server error processing elevation." });
    }
});

app.listen(PORT, () => {
    console.log(`Global Elevation API running on http://localhost:${PORT}`);
});
