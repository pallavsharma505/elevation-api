const express = require("express");
const gdal = require("gdal-async");

const app = express();
const PORT = process.env.PORT || 3000;

const VRT_PATH = "./data/COP90_hh.vrt";

// Open the VRT dataset once when the server starts.
// This keeps the metadata in memory so subsequent requests are fast.
const dataset = gdal.open(VRT_PATH);
const transform = dataset.geoTransform;
const band = dataset.bands.get(1);

// http://localhost:3000/elevation?lat=27.9881&lon=86.9250
app.get("/elevation", (req, res) => {
    const latStr = req.query.lat;
    const lonStr = req.query.lon;

    // 1. Validate inputs
    if (!latStr || !lonStr) {
        return res.status(400).json({ error: "Missing lat or lon parameters" });
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: "Invalid coordinates" });
    }

    try {
        // 2. Convert Lat/Lon to Pixel Coordinates (Column and Row)
        // Formula: Pixel = (Coordinate - TopLeftCoordinate) / PixelResolution
        const col = Math.floor((lon - transform[0]) / transform[1]);
        const row = Math.floor((lat - transform[3]) / transform[5]);

        // 3. Prevent errors by checking if the coordinate is outside the map boundaries
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

        // 4. Extract the exact elevation pixel
        let elevation = band.pixels.get(col, row);

        // 5. Handle missing data / oceans (often stored as -32768 or similar)
        if (elevation !== null && elevation < -10000) {
            elevation = 0.0;
        }

        // 6. Return the JSON response
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

// Start the server
app.listen(PORT, () => {
    console.log(`Global Elevation API running on http://localhost:${PORT}`);
});
