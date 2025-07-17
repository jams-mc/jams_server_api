// lib/packBuilder.js
import JSZip from "jszip";
import fetch from "node-fetch";
import crypto from "crypto";
import { put } from "@vercel/blob";

export async function buildPack() {
  const GITHUB_ZIP_URL =
    "https://github.com/jams-mc/J.A.M.S.-Resource-Pack-Files/archive/refs/heads/OFFICIAL-VERSION-DONT-FUCK-UP.zip";

  const githubRes = await fetch(`${GITHUB_ZIP_URL}?cacheBust=${Math.random()}`);
  if (!githubRes.ok) throw new Error("Failed to fetch GitHub ZIP");
  const originalZipBuffer = Buffer.from(await githubRes.arrayBuffer());

  const originalZip = await JSZip.loadAsync(originalZipBuffer);
  const newZip = new JSZip();
  const allPaths = Object.keys(originalZip.files);
  const rootFolder = allPaths.find(p => p.endsWith("/"))?.split("/")[0] + "/";

  let fileCount = 0;
  for (const [path, file] of Object.entries(originalZip.files)) {
    if (file.dir || !path.startsWith(rootFolder)) continue;
    const relPath = path.slice(rootFolder.length);
    const content = await file.async("nodebuffer");
    newZip.file(relPath, content);
    fileCount++;
  }

  const finalZipBuffer = await newZip.generateAsync({ type: "nodebuffer" });
  const sha1 = crypto.createHash("sha1").update(finalZipBuffer).digest("hex");

  const blob = await put(`resource-pack/@latest.zip`, finalZipBuffer, {
    token: process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
    allowOverwrite: true,
    contentType: "application/zip",
    access: "public",
  });

  return {
    blobUrl: blob.url,
    sha1,
    sizeBytes: finalZipBuffer.length,
    fileCount,
  };
}
