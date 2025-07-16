import JSZip from "jszip";
import fetch from "node-fetch";
import crypto from "crypto";

export default async function handler(req, res) {
  const GITHUB_ZIP_URL =
    "https://github.com/jams-mc/J.A.M.S.-Resource-Pack-Files/archive/refs/heads/OFFICIAL-VERSION-DONT-FUCK-UP.zip";
  const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;
  const boundary = "----abcd-boundary";

  const userIP = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  const userAgent = req.headers["user-agent"] || "unknown";
  const timestamp = new Date().toISOString();

  console.log("[INFO] Incoming request at:", timestamp);
  console.log("[INFO] IP:", userIP);
  console.log("[INFO] User-Agent:", userAgent);

  let finalZip;
  let sha256;

  try {
    const githubRes = await fetch(`${GITHUB_ZIP_URL}?cacheBust=${Math.random()}`);
    const buf = Buffer.from(await githubRes.arrayBuffer());
    console.log("[INFO] GitHub ZIP downloaded. Size:", buf.length);

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

    console.log(`[INFO] Extracted and restructured ${fileCount} files`);
    finalZip = await newZip.generateAsync({ type: "nodebuffer" });
    sha256 = crypto.createHash("sha256").update(finalZip).digest("hex");
    console.log("[INFO] Final ZIP SHA256:", sha256);
  } catch (zipErr) {
    console.error("[FATAL] ZIP processing failed:", zipErr);
    return res.status(500).json({ error: "Failed to process ZIP" });
  }

  // Send ZIP to user right away
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="JAMS-PACK.zip"`);
  res.setHeader("Content-Length", finalZip.length);
  res.status(200).send(finalZip);

  // After response is sent: logging
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

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": Buffer.byteLength(body),
      },
      body,
    });

    console.log("[INFO] Webhook sent. Status:", response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ERROR] Discord webhook response error:", errorText);
    }
  } catch (logErr) {
    console.error("[WARN] Logging to Discord failed:", logErr.message);
  }
}
