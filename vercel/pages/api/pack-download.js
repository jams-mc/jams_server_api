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
    const githubRes = await fetch(`${GITHUB_ZIP_URL}?jam=${Math.random()}`);
    const buf = Buffer.from(await githubRes.arrayBuffer());
    console.log("[INFO] GitHub ZIP downloaded. Size:", buf.length);

    // Step 2: Unzip and restructure files
    const originalZip = await JSZip.loadAsync(buf);
    const newZip = new JSZip();

    const rootFolder = Object.keys(originalZip.files)[0]?.split("/")[0]; // Auto-detect root folder name
    const prefix = `${rootFolder}/files/`;
    let fileCount = 0;

    for (const [path, file] of Object.entries(originalZip.files)) {
      if (!path.startsWith(prefix) || file.dir) continue;

      const relativePath = path.slice(prefix.length); // Remove rootFolder/files/
      const content = await file.async("nodebuffer");
      newZip.file(relativePath, content);
      fileCount++;
    }

    if (fileCount === 0) {
      throw new Error("No files found inside the 'files/' folder.");
    }

    console.log(`[INFO] Extracted and restructured ${fileCount} files`);

    // Step 3: Generate new zip and SHA
    const finalZip = await newZip.generateAsync({ type: "nodebuffer" });
    const sha256 = crypto.createHash("sha256").update(finalZip).digest("hex");
    console.log("[INFO] Final ZIP SHA256:", sha256);

    // Step 4: Send zip file to user
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="JAMS-PACK.zip"`);
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
              description: `**Pack SHA:** \`${sha256.slice(0, 12)}...\`\n**From IP:** ||[${userIP}](https://proxycheck.io/lookup/${userIP})||`,
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
          console.error("[ERROR] Discord webhook response error:", errorText);
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
