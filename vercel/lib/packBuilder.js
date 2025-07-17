// lib/packBuilder.js
import JSZip from "jszip";
import fetch from "node-fetch";
import crypto from "crypto";
import { put } from "@vercel/blob";

const METADATA_URL = "https://jams-mc.github.io/jams-mc.resourcepack/resource_pack/config.json";
const HISTORY_BLOB = "resource-pack/build-history.json";
const VERSION_BLOB = "version.json";

async function getVersionCode({ added, removed, modified }, sha1) {
  const shortSha = sha1.slice(0, 6);
  let prevVersion = { version: "0-0-0-init" };

  try {
    const res = await fetch("https://gr1tvtdf738zcvfo.public.blob.vercel-storage.com/version.json");
    if (res.ok) {
      prevVersion = await res.json();
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

async function sendDiscordLog(versionCode, previousVersion, versionNotes) {
  const webhookUrl = process.env.LOG_ACTIVE_EDITS;
  if (!webhookUrl) return;

  const { added = [], removed = [], modified = [] } = versionNotes;

  const send = async (title, description, fields = []) => {
  const embed = {
    title: title || null,
    description: description || null,
    color: 0x00bfff,
    timestamp: new Date().toISOString(),
    fields: fields.length ? fields : undefined,
  };

  const body = {
    embeds: [embed],
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await new Promise(resolve => setTimeout(resolve, 500)); // basic rate limit
  } catch (err) {
    console.warn("❌ Failed to send Discord embed:", err.message);
  }
};


  // START BARRIER
  await send(`** **`);

  // INIT MESSAGE
  await send(`🛠 **Resource Pack Build Initialized**\nPrevious version: \`${previousVersion.version || "0-0-0-init"}\`\nNew version: \`${versionCode}\``);

  // CHUNK MESSAGE SENDER
  const sendChunks = async (items, type) => {
    if (!items.length) return;
    const chunkSize = 15;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const content = chunk
        .map(p => `**Type:** ${type}\n**Path:** \`${p}\``)
        .join("\n\n");
      await send(content);
    }
  };

  await sendChunks(added, "added");
  await sendChunks(removed, "removed");
  await sendChunks(modified, "modified");

  // FINAL SUMMARY
  const totalChanges = added.length + removed.length + modified.length;
  const summary = [
    `✅ **Build Complete!**`,
    `📦 **New Version:** \`${versionCode}\``,
    `➕ Added: ${added.length}`,
    `➖ Removed: ${removed.length}`,
    `✏️ Modified: ${modified.length}`,
    `🧾 Total Changes: ${totalChanges}`,
  ].join("\n");

  await send(summary);

  // END BARRIER
  await send(`** **`);
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

  // STEP 3: Load previous hashes and version
  console.log("📁 Loading previous build history...");
  let previousHashes = {};
  let previousVersion = { version: "0-0-0-init" };

  try {
    const [prevHashRes, prevVersionRes] = await Promise.all([
      fetch("https://gr1tvtdf738zcvfo.public.blob.vercel-storage.com/resource-pack/build-history.json"),
      fetch("https://gr1tvtdf738zcvfo.public.blob.vercel-storage.com/version.json"),
    ]);
    if (prevHashRes.ok) previousHashes = await prevHashRes.json();
    if (prevVersionRes.ok) previousVersion = await prevVersionRes.json();
  } catch (err) {
    console.log("⚠️ No previous history/version found.");
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

  // STEP 5: Generate ZIP and version
  const finalZipBuffer = await newZip.generateAsync({ type: "nodebuffer" });
  const sha1 = crypto.createHash("sha1").update(finalZipBuffer).digest("hex");
  const versionCode = await getVersionCode(versionNotes, sha1);

  const packMeta = {
    pack: {
      description: `${metadata.description || "Resource Pack"}\n§9V.${versionCode}`,
      pack_format: metadata.pack_format || 1,
    },
  };

  const newChangeBlock = createChangeLog(versionCode, versionNotes);

  // STEP 6: Load and prepend changelog
  let previousChangeLog = "";
  try {
    const prevChangeRes = await fetch("https://gr1tvtdf738zcvfo.public.blob.vercel-storage.com/resource-pack/change.txt");
    if (prevChangeRes.ok) {
      previousChangeLog = await prevChangeRes.text();
    }
  } catch (err) {
    console.warn("⚠️ No previous changelog found.");
  }

  const changeLog = [newChangeBlock, previousChangeLog].filter(Boolean).join("\n\n");

  const versionInfo = {
    version: versionCode,
    timestamp: new Date().toISOString(),
    fileCount,
    sha1,
  };

  // STEP 7: Add generated files
  newZip.file("pack.mcmeta", JSON.stringify(packMeta, null, 2));
  newZip.file("version.txt", versionCode);
  newZip.file("change.txt", changeLog);

  if (metadata.pack_png_base64) {
    const pngBuffer = Buffer.from(metadata.pack_png_base64, "base64");
    newZip.file("pack.png", pngBuffer);
  }

  const updatedZipBuffer = await newZip.generateAsync({ type: "nodebuffer" });

  // STEP 8: Upload blobs
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
    put(VERSION_BLOB, JSON.stringify(versionInfo, null, 2), {
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

  // STEP 9: Log to Discord
  await sendDiscordLog(versionCode, previousVersion, versionNotes);

  console.log("✅ All files uploaded!");
  console.log(`🌐 Pack URL: ${blob.url}`);
  console.log(`🔢 Version: ${versionCode}`);
  console.log(`📦 File count: ${fileCount}`);

  return {
    blobUrl: blob.url,
    version: versionCode,
    sha1,
    fileCount,
    sizeBytes: finalZipBuffer.length,
    changeLogUrl: changeBlob.url,
    versionJsonUrl: versionBlob.url,
  };
}
