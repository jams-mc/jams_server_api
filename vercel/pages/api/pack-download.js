import JSZip from "jszip";
import fetch from "node-fetch";
import crypto from "crypto";

export const config = {
  runtime: "edge", // faster on Vercel edge network
};

export default async function handler(req) {
  const GITHUB_ZIP_URL = "https://github.com/jams-mc/J.A.M.S.-Resource-Pack-Files/archive/refs/heads/OFFICIAL-VERSION-DONT-FUCK-UP.zip";
  const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

  const userIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = req.headers.get("user-agent") || "unknown";
  const timestamp = new Date().toISOString();
  const requestURL = new URL(req.url);

  // Download zip
  const res = await fetch(`${GITHUB_ZIP_URL}?jam=${Math.random()}`);
  const buf = await res.arrayBuffer();

  const originalZip = await JSZip.loadAsync(buf);
  const newZip = new JSZip();

  const prefix = "J.A.M.S.-Resource-Pack-Files-OFFICIAL-VERSION-DONT-FUCK-UP/";

  // Repack under /OFFICIAL-VERSION-DONT-FUCK-UP/files/*
  originalZip.folder(`${prefix}files`).forEach(async (relativePath, file) => {
    const content = await file.async("nodebuffer");
    const newPath = `OFFICIAL-VERSION-DONT-FUCK-UP/files/${relativePath}`;
    newZip.file(newPath, content);
  });

  const finalZip = await newZip.generateAsync({ type: "nodebuffer" });
  const sha256 = crypto.createHash("sha256").update(finalZip).digest("hex");

  // Call proxycheck.io
  const proxyRes = await fetch(`https://proxycheck.io/v2/${userIP}?key=111111-222222-333333-444444&vpn=3&asn=1&risk=2&port=1&seen=1&days=7&tag=msg&cur=1&node=1&time=1&short=1`);
  const proxyJson = await proxyRes.json();

  // Create logs
  const logData = {
    timestamp,
    ip: userIP,
    userAgent,
    requestedUrl: requestURL.href,
    sha256,
    proxyCheck: proxyJson,
  };

  // Discord Webhook (embed + logs)
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: null,
      embeds: [
        {
          title: "🧨 New Pack Download Req",
          description: `**Pack SHA:** \`${sha256.slice(0, 10)}...\`\n**From IP:** ||[${userIP}](https://proxycheck.io/lookup/${userIP})||`,
          color: 0xffcc00,
          timestamp,
        },
      ],
      files: [
        {
          name: "req-log.json",
          attachment: Buffer.from(JSON.stringify(logData, null, 2)),
        },
      ],
    }),
  });

  return new Response(finalZip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="JAMS-PACK.zip"`,
      "Content-Length": finalZip.length,
    },
  });
}
