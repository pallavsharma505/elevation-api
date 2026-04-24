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
const PREFIX = "COP90/";
const DOWNLOAD_DIR = path.join(__dirname, "data");

// Configure S3 Client for OpenTopography's custom, public S3 endpoint
const s3Client = new S3Client({
    endpoint: "https://opentopography.s3.sdsc.edu",
    region: "us-east-1", // Region is required by SDK but ignored by custom endpoints
    forcePathStyle: true, // Crucial for non-AWS S3 endpoints
    credentials: {
        accessKeyId: "anonymous", // Dummy credentials for anonymous access
        secretAccessKey: "anonymous", // Dummy credentials
    },
});

/**
 * Helper function to ensure local directories exist
 */
function ensureDirectoryExists(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Main Download Function
 */
async function downloadData() {
    console.log(
        `Starting sync from s3://${BUCKET_NAME}/${PREFIX} to ${DOWNLOAD_DIR}...`,
    );

    let isTruncated = true;
    let continuationToken = undefined;
    let totalFiles = 0;

    // 1. Paginate through the bucket (S3 returns max 1000 items per request)
    while (isTruncated) {
        const listCommand = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: PREFIX,
            ContinuationToken: continuationToken,
        });

        try {
            const listResponse = await s3Client.send(listCommand);
            const objects = listResponse.Contents || [];

            // 2. Download each file in the current batch
            for (const obj of objects) {
                // Skip directories (S3 objects ending with '/')
                if (obj.Key.endsWith("/")) continue;

                const localFilePath = path.join(DOWNLOAD_DIR, obj.Key);
                ensureDirectoryExists(localFilePath);

                // Check if file already exists and matches the size (Basic resume capability)
                if (fs.existsSync(localFilePath)) {
                    const stats = fs.statSync(localFilePath);
                    if (stats.size === obj.Size) {
                        console.log(`Skipping (already exists): ${obj.Key}`);
                        totalFiles++;
                        continue;
                    }
                }

                console.log(
                    `Downloading: ${obj.Key} (${(obj.Size / 1024 / 1024).toFixed(2)} MB)`,
                );

                // Fetch the file stream
                const getCommand = new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: obj.Key,
                });

                const { Body } = await s3Client.send(getCommand);

                // Pipe the S3 stream directly to the local file system safely
                await pipeline(Body, fs.createWriteStream(localFilePath));
                totalFiles++;
            }

            // Update pagination tokens
            isTruncated = listResponse.IsTruncated;
            continuationToken = listResponse.NextContinuationToken;
        } catch (err) {
            console.error("Error interacting with S3:", err);
            process.exit(1);
        }
    }

    console.log(`\n✅ Download complete! Processed ${totalFiles} files.`);
}

// Execute the script
downloadData();
