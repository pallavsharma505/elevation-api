# Global Elevation API

A lightweight, fast, and self-hosted Node.js API that returns the elevation (height in meters) for any latitude and longitude coordinate on Earth. 

This project downloads and utilizes the **Copernicus 90m Global DEM (COP90)** dataset from OpenTopography. By hosting the data locally and using `gdal-async`, the API serves elevation queries in milliseconds without rate limits.

---

## 🚀 Features

* **Completely Offline/Self-Hosted:** Queries local `.tif` data. No external API calls.
* **Fast:** Uses memory-mapped `.vrt` (Virtual Raster) files to instantly query the exact pixel.
* **Resumable Downloads:** Built-in S3 script securely and safely downloads the ~30GB dataset, skipping already downloaded files.

---

## 📋 Prerequisites

1. **Node.js:** v18 or higher recommended.
2. **Disk Space:** At least **35GB** of free disk space to store the global GeoTIFF dataset.
3. **GDAL CLI Tools:** While the app runs on `gdal-async`, you will need the system GDAL tools installed just *once* to stitch the downloaded `.tif` files into a `.vrt` file.
   * **Ubuntu/Debian:** `sudo apt-get install gdal-bin`
   * **macOS:** `brew install gdal`
   * **Windows:** Install via OSGeo4W.

---

## 🛠️ Installation & Setup

### 1. Install Dependencies & Download Data

Run the built-in setup script. This will install the necessary npm packages and immediately begin downloading the COP90 dataset from OpenTopography's AWS S3 bucket.

```bash
npm run setup
```

*Note: This downloads tens of gigabytes of `.tif` files into the `./data/COP90/` directory. Depending on your internet connection, this may take a while. If the process is interrupted, simply run `node GetData.js` again to resume.*

### 2. Generate the Virtual Raster (VRT)

Once all the `.tif` files have finished downloading, you need to combine them into a single virtual file so the API can read them globally. 

Run the following command from the root of your project:

```bash
gdalbuildvrt ./data/COP90_hh.vrt ./data/COP90/*.tif
```

This creates a lightweight XML file (`COP90_hh.vrt`) in the `./data` folder that maps out all the TIFF files.

---

## 💻 Usage

Start the Express server. You can use the development command (which auto-restarts on file changes) or the standard start command.

**Development mode:**

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
├── data/                  # Directory containing the downloaded GIS data
│   ├── COP90/             # Contains the individual .tif files
│   └── COP90_hh.vrt       # The generated Virtual Raster map (created manually)
├── index.js               # Main Express server and GDAL querying logic
├── GetData.js             # AWS S3 download script for OpenTopography data
├── package.json           # Project dependencies and scripts
└── README.md              # Project documentation
```

---

## ⚠️ Notes

* **Ocean/NoData Values:** GeoTIFFs often represent oceans or missing data with massive negative numbers (like `-32768`). The API automatically catches values below `-10000` and normalizes them to `0.0`.
* **RAM Usage:** Because the API relies on a `.vrt` file rather than loading the entire 30GB dataset into memory, RAM usage remains very low (typically under 100MB).
