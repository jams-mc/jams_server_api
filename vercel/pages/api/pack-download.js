import JSZip from "jszip";
import fetch from "node-fetch";
import crypto from "crypto";

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

  let buf;
  try {
    const githubRes = await fetch(
      `${GITHUB_ZIP_URL}?jam=${Math.random()}`
    );

    if (!githubRes.ok) {
      console.error("[ERROR] GitHub zip fetch failed:", githubRes.statusText);
      return res
        .status(500)
        .json({ error: true, message: "Failed to download source zip." });
    }

    buf = Buffer.from(await githubRes.arrayBuffer());
    console.log("[INFO] GitHub ZIP downloaded. Size:", buf.length);
  } catch (err) {
    console.error("[ERROR] Failed fetching GitHub ZIP:", err);
    return res
      .status(500)
      .json({ error: true, message: "Failed to fetch source zip." });
  }

  let originalZip;
  try {
    originalZip = await JSZip.loadAsync(buf);
  } catch (err) {
    console.error("[ERROR] Failed to load original ZIP:", err);
    return res
      .status(500)
      .json({ error: true, message: "Invalid zip file format." });
  }

  const newZip = new JSZip();
  const allPaths = Object.keys(originalZip.files);

  // Find root folder (e.g. J.A.M.S.-Resource-Pack-Files-OFFICIAL-VERSION-DONT-FUCK-UP/)
  const rootFolderCandidate = allPaths.find((path) => path.endsWith("/"));
  if (!rootFolderCandidate) {
    console.error("[ERROR] Could not detect root folder in zip.");
    return res
      .status(500)
      .json({ error: true, message: "Root folder missing in zip." });
  }

  const rootFolder = rootFolderCandidate.split("/")[0] + "/";
  console.log("[INFO] Detected root folder:", rootFolder);

  let fileCount = 0;

  try {
    for (const [path, file] of Object.entries(originalZip.files)) {
      if (file.dir || !path.startsWith(rootFolder)) continue;

      const relativePath = path.slice(rootFolder.length);
      const newPath = `JAMS-PACK/${relativePath}`;

      const content = await file.async("nodebuffer");
      newZip.file(newPath, content);

      fileCount++;
      if (fileCount % 50 === 0) {
        console.log(`[INFO] Added ${fileCount} files so far...`);
      }
    }
  } catch (err) {
    console.error("[ERROR] Failed during file restructuring:", err);
    return res
      .status(500)
      .json({ error: true, message: "Error restructuring zip files." });
  }

  if (fileCount === 0) {
    console.error("[ERROR] No files found in the original zip.");
    return res
      .status(500)
      .json({ error: true, message: "Original zip contains no files." });
  }

  console.log(`[INFO] Extracted and restructured ${fileCount} files.`);

  let finalZip;
  let sha256;
  try {
    finalZip = await newZip.generateAsync({ type: "nodebuffer" });
    sha256 = crypto.createHash("sha256").update(finalZip).digest("hex");
    console.log("[INFO] Final ZIP SHA256:", sha256);
  } catch (err) {
    console.error("[ERROR] Failed generating final ZIP:", err);
    return res
      .status(500)
      .json({ error: true, message: "Failed to generate final zip." });
  }

  // Optional: Check size for Vercel limits (~5MB typical for free serverless)
  const MAX_SIZE = 5 * 1024 * 1024;
  if (finalZip.length > MAX_SIZE) {
    console.error(
      `[ERROR] Final zip size ${finalZip.length} exceeds limit (${MAX_SIZE}).`
    );
    return res
      .status(500)
      .json({
        error: true,
        message: "Generated zip too large for direct download.",
      });
  }

  try {
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="JAMS-PACK.zip"`
    );
    res.setHeader("Content-Length", finalZip.length);
    res.status(200).send(finalZip);
    console.log("[INFO] Sent ZIP file to user.");
  } catch (err) {
    console.error("[ERROR] Failed sending ZIP to user:", err);
    return res
      .status(500)
      .json({ error: true, message: "Failed to send zip to user." });
  }

  // Run webhook in background
  (async () => {
    try {
      const proxyRes = await fetch(
        `https://proxycheck.io/v2/${userIP}?key=111111-222222-333333-444444&vpn=3&asn=1&risk=2&port=1&seen=1&days=7&tag=msg&cur=1&node=1&time=1&short=1`
      );

      const proxyJson = await proxyRes.json();
      console.log("[INFO] ProxyCheck result:", proxyJson);

      const reqLog = {
        timestamp,
        ip: userIP,
        userAgent,
        requestedUrl: req.url,
        sha256,
      };

      const payload = {
        content: null,
        embeds: [
          {
            title: "🧨 New Pack Download Req",
            description: `**Pack SHA:** \`${sha256.slice(
              0,
              12
            )}...\`\n**From IP:** ||[${userIP}](https://proxycheck.io/lookup/${userIP})||`,
            color: 0xffcc00,
            timestamp,
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
        console.error(
          "[ERROR] Discord webhook response error:",
          errorText
        );
      }
    } catch (logErr) {
      console.error("[WARN] Webhook logging failed:", logErr);
    }
  })();
}
