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

  try {
    // Step 1: Download GitHub ZIP
    console.log("[INFO] Fetching GitHub ZIP:", GITHUB_ZIP_URL);
    const githubRes = await fetch(`${GITHUB_ZIP_URL}?jam=${Math.random()}`);

    if (!githubRes.ok) {
      const text = await githubRes.text();
      console.error(
        "[ERROR] Failed to fetch GitHub ZIP:",
        githubRes.status,
        text
      );
      return res
        .status(502)
        .json({ error: "Failed to download resource pack from GitHub" });
    }

    const buf = Buffer.from(await githubRes.arrayBuffer());
    console.log("[INFO] GitHub ZIP downloaded. Size:", buf.length);

    // Step 2: Unzip and restructure files
    const originalZip = await JSZip.loadAsync(buf);
    const newZip = new JSZip();

    // Detect root folder
    const allPaths = Object.keys(originalZip.files);
    const folderMatch = allPaths.find((path) => path.endsWith("/"));
    if (!folderMatch) {
      console.error("[ERROR] Could not detect root folder in ZIP");
      return res.status(500).json({ error: "Invalid ZIP structure" });
    }

    const rootFolder = folderMatch.split("/")[0] + "/";
    console.log("[INFO] Detected root folder in ZIP:", rootFolder);

    // Check for pack.mcmeta
    if (!originalZip.file(`${rootFolder}pack.mcmeta`)) {
      console.error("[ERROR] pack.mcmeta not found in ZIP");
      return res
        .status(500)
        .json({ error: "pack.mcmeta not found in resource pack" });
    }
    console.log("[INFO] pack.mcmeta found.");

    let fileCount = 0;

    for (const [path, file] of Object.entries(originalZip.files)) {
      if (file.dir || !path.startsWith(rootFolder)) continue;

      const relativePath = path.slice(rootFolder.length);
      const newPath = `JAMS-PACK/${relativePath}`;
      const content = await file.async("nodebuffer");

      newZip.file(newPath, content);
      console.log(`[INFO] Added file to new zip: ${newPath}`);
      fileCount++;
    }

    if (fileCount === 0) {
      console.error("[ERROR] No files extracted from ZIP");
      return res.status(500).json({ error: "Empty resource pack" });
    }

    console.log(`[INFO] Extracted and restructured ${fileCount} files.`);

    // Step 3: Generate new zip and SHA
    const finalZip = await newZip.generateAsync({ type: "nodebuffer" });
    const sha256 = crypto.createHash("sha256").update(finalZip).digest("hex");
    console.log("[INFO] Final ZIP SHA256:", sha256);

    // Step 4: Send zip file to user
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="JAMS-PACK.zip"`
    );
    res.setHeader("Content-Length", finalZip.length);
    res.status(200).send(finalZip);
    console.log("[INFO] Sent ZIP to user, starting webhook...");

    // Step 5: Run webhook in background
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
  } catch (err) {
    console.error("[ERROR] Fatal handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error" });
    }
  }
}
