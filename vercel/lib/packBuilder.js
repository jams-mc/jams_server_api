// lib/packBuilder.js
import JSZip from "jszip";
import fetch from "node-fetch";
import crypto from "crypto";
import { put } from "@vercel/blob";

const METADATA_URL = "https://jams-mc.github.io/jams-mc.resourcepack/resource_pack/config.json"; // Replace with your actual URL
const HISTORY_BLOB = "resource-pack/build-history.json";

async function getVersionCode({ added, removed, modified }, sha1) {
  const shortSha = sha1.slice(0, 6);
  let prevVersion = { version: "0-0-0-init" };

  try {
    const res = await fetch("https://gr1tvtdf738zcvfo.public.blob.vercel-storage.com/version.json");
    if (res.ok) {
      const json = await res.json();
      prevVersion = json;
    }
  } catch {
    console.warn("⚠️ Failed to fetch previous version. Using 0-0-0.");
  }

  const [prevX, prevY, prevZ] = prevVersion.version.split("-").map(v => parseInt(v, 10));
  const changeCount = added.length + removed.length + modified.length;

  let x = prevX, y = prevY, z = prevZ;

  if (changeCount < 15) {
    z++;
  } else if (changeCount <= 25) {
    y++;
    z = 0;
  } else {
    x++;
    y = 0;
    z = 0;
  }

  return `${x}-${y}-${z}-${shortSha}`;
}


function createChangeLog(versionCode, versionNotes) {
  const { added = [], removed = [], modified = [] } = versionNotes;
  const parts = [
    `====== VERSION ${versionCode} ======`,
    added.length ? `Added:\n${added.map(i => `- ${i}`).join('\n')}` : '',
    removed.length ? `Removed:\n${removed.map(i => `- ${i}`).join('\n')}` : '',
    modified.length ? `Modified:\n${modified.map(i => `- ${i}`).join('\n')}` : ''
  ].filter(Boolean);
  return parts.join('\n\n');
}

export async function buildPack() {
  console.log("🔧 Starting resource pack build...");

  // STEP 1: Fetch metadata JSON
  console.log("🌐 Fetching metadata...");
  const metaRes = await fetch(`${METADATA_URL}?jam=${Math.random()}`);
  if (!metaRes.ok) throw new Error("❌ Failed to fetch metadata JSON");
  const metadata = await metaRes.json();
  console.log("✅ Metadata loaded");

  // STEP 2: Fetch original ZIP from GitHub
  const GITHUB_ZIP_URL =
    "https://github.com/jams-mc/J.A.M.S.-Resource-Pack-Files/archive/refs/heads/OFFICIAL-VERSION-DONT-FUCK-UP.zip";
  console.log("📦 Downloading GitHub ZIP...");
  const githubRes = await fetch(`${GITHUB_ZIP_URL}?cacheBust=${Math.random()}`);
  if (!githubRes.ok) throw new Error("❌ Failed to fetch GitHub ZIP");
  const originalZipBuffer = Buffer.from(await githubRes.arrayBuffer());
  const originalZip = await JSZip.loadAsync(originalZipBuffer);
  const allPaths = Object.keys(originalZip.files);
  const rootFolder = allPaths.find(p => p.endsWith("/"))?.split("/")[0] + "/";

  const newZip = new JSZip();
  let fileCount = 0;
  const currentHashes = {};

  console.log("📂 Extracting and hashing files...");
  for (const [path, file] of Object.entries(originalZip.files)) {
    if (file.dir || !path.startsWith(rootFolder)) continue;
    const relPath = path.slice(rootFolder.length);
    const content = await file.async("nodebuffer");
    newZip.file(relPath, content);
    const hash = crypto.createHash("sha1").update(content).digest("hex");
    currentHashes[relPath] = hash;
    fileCount++;
  }

  // STEP 3: Load previous hashes from Blob
  console.log("📁 Loading previous build history...");
  let previousHashes = {};
  try {
    const prev = await fetch(`https://<your-project-id>.blob.vercel-storage.com/${HISTORY_BLOB}`);
    if (prev.ok) previousHashes = await prev.json();
  } catch (err) {
    console.log("⚠️ No previous hash history found, treating as initial build.");
  }

  // STEP 4: Detect changes
  const added = [], removed = [], modified = [];
  for (const [path, hash] of Object.entries(currentHashes)) {
    if (!(path in previousHashes)) added.push(path);
    else if (previousHashes[path] !== hash) modified.push(path);
  }
  for (const path of Object.keys(previousHashes)) {
    if (!(path in currentHashes)) removed.push(path);
  }
  const versionNotes = { added, removed, modified };

  // STEP 5: Generate final ZIP content
  const finalZipBuffer = await newZip.generateAsync({ type: "nodebuffer" });
  const sha1 = crypto.createHash("sha1").update(finalZipBuffer).digest("hex");
 const versionCode = await getVersionCode(versionNotes, sha1);

  const packMeta = {
    pack: {
      description: `${metadata.description || "Resource Pack"}\n§9V.${versionCode}`,
      pack_format: metadata.pack_format || 1,
    },
  };

  const changeLog = createChangeLog(versionCode, versionNotes);
  const versionInfo = {
    version: versionCode,
    timestamp: new Date().toISOString(),
    fileCount,
    sha1,
  };

  // Add generated files to ZIP
  newZip.file("pack.mcmeta", JSON.stringify(packMeta, null, 2));
  newZip.file("version.txt", versionCode);
  newZip.file("change.txt", changeLog);

  if (metadata.pack_png_base64) {
    const pngBuffer = Buffer.from(metadata.pack_png_base64, "base64");
    newZip.file("pack.png", pngBuffer);
  }

  // STEP 6: Rebuild ZIP to include new files
  const updatedZipBuffer = await newZip.generateAsync({ type: "nodebuffer" });

  // STEP 7: Upload all blobs
  console.log("🚀 Uploading files to blob storage...");

  const [blob, hashBlob, changeBlob, versionBlob, metaBlob] = await Promise.all([
    put("resource-pack/@latest.zip", updatedZipBuffer, {
      token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
      contentType: "application/zip",
      access: "public",
      allowOverwrite: true,
    }),
    put(HISTORY_BLOB, JSON.stringify(currentHashes, null, 2), {
      token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
      contentType: "application/json",
      access: "public",
      allowOverwrite: true,
    }),
    put("resource-pack/change.txt", changeLog, {
      token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
      contentType: "text/plain",
      access: "public",
      allowOverwrite: true,
    }),
    put("resource-pack/version.json", JSON.stringify(versionInfo, null, 2), {
      token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
      contentType: "application/json",
      access: "public",
      allowOverwrite: true,
    }),
    put("resource-pack/temp/metadatastructure.json", JSON.stringify(metadata, null, 2), {
      token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
      contentType: "application/json",
      access: "public",
      allowOverwrite: true,
    }),
  ]);

  console.log("✅ All files uploaded!");
  console.log(`🌐 Pack URL: ${blob.url}`);
  console.log(`🔢 Version: ${versionCode}`);
  console.log(`📦 File count: ${fileCount}`);

  return {
    blobUrl: blob.url,
    version: versionCode,
    sha1,
    fileCount,
    sizeBytes: finalZipBuffer.length
    changeLogUrl: changeBlob.url,
    versionJsonUrl: versionBlob.url,
  };
}
