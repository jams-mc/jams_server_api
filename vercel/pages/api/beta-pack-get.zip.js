import JSZip from "jszip";
import fetch from "node-fetch";
import crypto from "crypto";
import { put } from "@vercel/blob";
import axios from 'axios';


export default async function handler(req, res) {
  const GITHUB_ZIP_URL =
    "https://github.com/jams-mc/J.A.M.S.-Resource-Pack-Files/archive/refs/heads/OFFICIAL-VERSION-DONT-FUCK-UP.zip";
  const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;
  const boundary = "----WebKitFormBoundaryabcd1234jam";

  const userIP =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  const userAgent = req.headers["user-agent"] || "unknown";
  const timestamp = new Date().toISOString();

  console.log("[INFO] Incoming request at:", timestamp);
  console.log("[INFO] IP:", userIP);
  console.log("[INFO] User-Agent:", userAgent);

  let originalZipBuffer;
  try {
    // Fetch GitHub ZIP
    const githubRes = await fetch(`${GITHUB_ZIP_URL}?jam=${Math.random()}`);
    if (!githubRes.ok) {
      throw new Error(
        `Failed to download GitHub zip. Status ${githubRes.status}`
      );
    }
    originalZipBuffer = Buffer.from(await githubRes.arrayBuffer());
    console.log("[INFO] GitHub ZIP downloaded. Size:", originalZipBuffer.length);
  } catch (err) {
    console.error("[ERROR] Downloading GitHub ZIP failed:", err);
    return res
      .status(500)
      .json({ error: true, message: "Could not fetch pack from GitHub." });
  }

  let finalZipBuffer, sha256;
  let fileCount = 0;
  try {
    const originalZip = await JSZip.loadAsync(originalZipBuffer);
    const newZip = new JSZip();

    const allPaths = Object.keys(originalZip.files);
    const rootFolder =
      allPaths.find((path) => path.endsWith("/"))?.split("/")[0] + "/";

    if (!rootFolder) {
      throw new Error("Could not detect root folder in ZIP.");
    }

    for (const [path, file] of Object.entries(originalZip.files)) {
      if (file.dir || !path.startsWith(rootFolder)) continue;

      const relativePath = path.slice(rootFolder.length);
      const content = await file.async("nodebuffer");
      newZip.file(relativePath, content);
      fileCount++;
      if (fileCount % 100 === 0) {
        console.log(`[INFO] Processed ${fileCount} files so far...`);
      }
    }

    if (fileCount === 0) {
      throw new Error(`No files found inside root folder: ${rootFolder}`);
    }

    finalZipBuffer = await newZip.generateAsync({ type: "nodebuffer" });
    sha256 = crypto.createHash("sha256").update(finalZipBuffer).digest("hex");

    console.log(
      `[INFO] Successfully rebuilt zip. Files: ${fileCount}. SHA256: ${sha256}`
    );
  } catch (err) {
    console.error("[ERROR] Failed while restructuring zip:", err);
    return res
      .status(500)
      .json({ error: true, message: "Failed to rebuild resource pack zip." });
  }

  // Upload to Blob Storage
  let blobUrl;
  try {
    const blobPath = `resource-pack/@latest.zip`;

    
    const blob = await put(blobPath, finalZipBuffer, {
      token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
      allowOverwrite: true,
      contentType: "application/zip",
      access: "public", // ensure public read access
    });

    blobUrl = blob.url;
    console.log("[INFO] Uploaded blob to:", blobUrl);
  } catch (err) {
    console.error("[ERROR] Blob upload failed:", err);
    return res
      .status(500)
      .json({ error: true, message: "Could not store pack in blob storage." });
  }

  // Lookup proxy data
  let proxyJson = {};
  try {
    const proxyRes = await fetch(
      `https://proxycheck.io/v2/${userIP}?key=111111-222222-333333-444444&vpn=3&asn=1&risk=2&port=1&seen=1&days=7&tag=msg&cur=1&node=1&time=1&short=1`
    );
    proxyJson = await proxyRes.json();
    console.log("[INFO] ProxyCheck result:", proxyJson);
  } catch (err) {
    console.warn("[WARN] Proxy check failed:", err);
  }

  // Send webhook
  try {
    const reqLog = {
      timestamp,
      ip: userIP,
      userAgent,
      requestedUrl: req.url,
      sha256,
      blobUrl,
    };

    const payload = {
      content: null,
      embeds: [
        {
          title: "🧨 New Pack Download Request",
          description: `**SHA256:** \`${sha256.slice(
            0,
            12
          )}...\`\n**From IP:** ||[${userIP}](https://proxycheck.io/lookup/${userIP})||`,
          color: 0xffcc00,
          timestamp,
        },
        {
          title: "📦 Uploaded New @latest.zip",
          description: `**Blob URL:** [Download Pack](${blobUrl})\n**Size:** ${(finalZipBuffer.length / (1024 * 1024)).toFixed(
            2
          )} MB\n**File Count:** ${fileCount}`,
          color: 0x00ccff,
        },
      ],
    };

    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="payload_json"\r\n\r\n` +
      `${JSON.stringify(payload)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files[0]"; filename="req-log.json"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify(reqLog, null, 2)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files[1]"; filename="ip-info.json"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${JSON.stringify(proxyJson, null, 2)}\r\n` +
      `--${boundary}--\r\n`;

    const webhookRes = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": Buffer.byteLength(body),
      },
      body,
    });

    console.log("[INFO] Webhook sent. Status:", webhookRes.status);
    if (!webhookRes.ok) {
      const errorText = await webhookRes.text();
      console.error("[ERROR] Discord webhook response error:", errorText);
    }
  } catch (err) {
    console.error("[WARN] Discord webhook failed:", err);
  }

  // Respond to user
//  return res.status(200).json({
//    success: true,
//    blobUrl,
//    sha256,
//    sizeBytes: finalZipBuffer.length,
//    fileCount,
//  });
//}

const response = await axios.get(blobUrl, { responseType: 'stream' });
  res.setHeader('Content-Type', 'application/zip');
  response.data.pipe(res);
}
