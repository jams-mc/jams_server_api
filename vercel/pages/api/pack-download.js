import JSZip from "jszip";
import fetch from "node-fetch";
import crypto from "crypto";
import FormData from "form-data";

export default async function handler(req, res) {
  const GITHUB_ZIP_URL =
    "https://github.com/jams-mc/J.A.M.S.-Resource-Pack-Files/archive/refs/heads/OFFICIAL-VERSION-DONT-FUCK-UP.zip";
  const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

  const userIP =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  const userAgent = req.headers["user-agent"] || "unknown";
  const timestamp = new Date().toISOString();

  console.log("[INFO] Incoming request at:", timestamp);
  console.log("[INFO] IP:", userIP);
  console.log("[INFO] User-Agent:", userAgent);

  try {
    console.log("[INFO] Downloading GitHub ZIP...");
    const githubRes = await fetch(`${GITHUB_ZIP_URL}?cacheBust=${Math.random()}`);
    const buf = Buffer.from(await githubRes.arrayBuffer());
    console.log("[INFO] GitHub ZIP downloaded. Size:", buf.length);

    console.log("[INFO] Extracting ZIP...");
    const originalZip = await JSZip.loadAsync(buf);
    const newZip = new JSZip();

    const rootPrefix = "J.A.M.S.-Resource-Pack-Files-OFFICIAL-VERSION-DONT-FUCK-UP/";
    let fileCount = 0;

    for (const [path, file] of Object.entries(originalZip.files)) {
      if (file.dir) continue;

      const newPath = path.replace(rootPrefix, "");
      const content = await file.async("nodebuffer");
      newZip.file(newPath, content);
      fileCount++;
    }

    console.log(`[INFO] Extracted and flattened ${fileCount} files`);

    const finalZip = await newZip.generateAsync({ type: "nodebuffer" });

    const sha256 = crypto.createHash("sha256").update(finalZip).digest("hex");
    console.log("[INFO] Final ZIP SHA256:", sha256);
    console.log("[INFO] Sending ZIP to user...");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="JAMS-PACK.zip"`);
    res.setHeader("Content-Length", finalZip.length);
    res.status(200).send(finalZip);

    // Continue logging *after* response is sent
    console.log("[INFO] Starting post-response webhook logging...");

    const proxyRes = await fetch(
      `https://proxycheck.io/v2/${userIP}?key=111111-222222-333333-444444&vpn=3&asn=1&risk=2&port=1&seen=1&days=7&tag=msg&cur=1&node=1&time=1&short=1`
    );
    const proxyJson = await proxyRes.json();
    console.log("[INFO] ProxyCheck result:", proxyJson);

    const logData = {
      timestamp,
      ip: userIP,
      userAgent,
      requestedUrl: req.url,
      sha256,
      proxyCheck: proxyJson,
    };

    const form = new FormData();

    form.append("payload_json", JSON.stringify({
      content: null,
      embeds: [
        {
          title: "🧨 New Pack Download Req",
          description: `**Pack SHA:** \`${sha256.slice(0, 12)}...\`\n**From IP:** ||[${userIP}](https://proxycheck.io/lookup/${userIP})||`,
          color: 0xffcc00,
          timestamp,
        },
      ],
    }));

    form.append("files[0]", Buffer.from(JSON.stringify(logData, null, 2)), {
      filename: "req-log.json",
      contentType: "application/json",
    });

    // Optional: attach ZIP file to webhook
    /*
    form.append("files[1]", finalZip, {
      filename: "JAMS-PACK.zip",
      contentType: "application/zip",
    });
    */

    const webhookRes = await fetch(WEBHOOK_URL, {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    });

    console.log("[INFO] Webhook sent. Status:", webhookRes.status);
    if (!webhookRes.ok) {
      const errText = await webhookRes.text();
      console.error("[ERROR] Webhook response:", errText);
    }
  } catch (err) {
    console.error("[FATAL] An error occurred:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
