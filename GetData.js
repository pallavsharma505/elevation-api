const {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
} = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");

// Configuration
const BUCKET_NAME = "raster";
const DOWNLOAD_DIR = path.join(__dirname, "data");

// Targets to download (The VRT file, and the folder containing the TIFFs)
const TARGETS = [
    { type: "file", key: "COP90_hh.vrt" },
    { type: "folder", prefix: "COP90/" },
];

// Configure S3 Client for OpenTopography's custom, public S3 endpoint
const s3Client = new S3Client({
    endpoint: "https://opentopography.s3.sdsc.edu",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
        accessKeyId: "anonymous",
        secretAccessKey: "anonymous",
    },
});

function ensureDirectoryExists(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function downloadSingleFile(key, size) {
    const localFilePath = path.join(DOWNLOAD_DIR, key);
    ensureDirectoryExists(localFilePath);

    if (fs.existsSync(localFilePath) && size) {
        const stats = fs.statSync(localFilePath);
        if (stats.size === size) {
            console.log(`Skipping (already exists): ${key}`);
            return;
        }
    }

    console.log(
        `Downloading: ${key} ${size ? `(${(size / 1024 / 1024).toFixed(2)} MB)` : ""}`,
    );

    const getCommand = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    const { Body } = await s3Client.send(getCommand);
    await pipeline(Body, fs.createWriteStream(localFilePath));
}

async function downloadData() {
    console.log(
        `Starting sync from s3://${BUCKET_NAME}/ to ${DOWNLOAD_DIR}...`,
    );
    let totalFiles = 0;

    for (const target of TARGETS) {
        if (target.type === "file") {
            // Fetch the standalone file (like the .vrt)
            try {
                await downloadSingleFile(target.key, null);
                totalFiles++;
            } catch (err) {
                console.error(
                    `Failed to download file ${target.key}:`,
                    err.message,
                );
            }
        } else if (target.type === "folder") {
            // Paginate and fetch the directory
            let isTruncated = true;
            let continuationToken = undefined;

            while (isTruncated) {
                const listCommand = new ListObjectsV2Command({
                    Bucket: BUCKET_NAME,
                    Prefix: target.prefix,
                    ContinuationToken: continuationToken,
                });

                try {
                    const listResponse = await s3Client.send(listCommand);
                    const objects = listResponse.Contents || [];

                    for (const obj of objects) {
                        if (obj.Key.endsWith("/")) continue; // Skip directories
                        await downloadSingleFile(obj.Key, obj.Size);
                        totalFiles++;
                    }

                    isTruncated = listResponse.IsTruncated;
                    continuationToken = listResponse.NextContinuationToken;
                } catch (err) {
                    console.error(
                        `Error interacting with S3 for prefix ${target.prefix}:`,
                        err,
                    );
                    process.exit(1);
                }
            }
        }
    }

    console.log(`\n✅ Download complete! Processed ${totalFiles} files.`);
}

downloadData();
