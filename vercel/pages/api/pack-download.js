const JSZip = require("jszip");
const fetch = require("node-fetch");
const crypto = require("crypto");

export default async function handler(req, res) {
  const GITHUB_ZIP_URL = "https://github.com/jams-mc/J.A.M.S.-Resource-Pack-Files/archive/refs/heads/OFFICIAL-VERSION-DONT-FUCK-UP.zip";
  const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

  const userIP = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  const userAgent = req.headers["user-agent"] || "unknown";
  const timestamp = new Date().toISOString();

  const githubRes = await fetch(`${GITHUB_ZIP_URL}?jam=${Math.random()}`);
  const buf = await githubRes.buffer();

  const originalZip = await JSZip.loadAsync(buf);
  const newZip = new JSZip();

  for (const [path, file] of Object.entries(originalZip.files)) {
    if (
      file.dir ||
      !path.startsWith("J.A.M.S.-Resource-Pack-Files-OFFICIAL-VERSION-DONT-FUCK-UP/files/")
    ) continue;

    const strippedPath = path.replace(
      "J.A.M.S.-Resource-Pack-Files-OFFICIAL-VERSION-DONT-FUCK-UP/",
      ""
    );
    const content = await file.async("nodebuffer");
    newZip.file(strippedPath, content);
  }

  const finalZip = await newZip.generateAsync({ type: "nodebuffer" });
  const sha256 = crypto.createHash("sha256").update(finalZip).digest("hex");

  const proxyRes = await fetch(`https://proxycheck.io/v2/${userIP}?key=111111-222222-333333-444444&vpn=3&asn=1&risk=2&port=1&seen=1&days=7&tag=msg&cur=1&node=1&time=1&short=1`);
  const proxyJson = await proxyRes.json();

  const logData = {
    timestamp,
    ip: userIP,
    userAgent,
    requestedUrl: req.url,
    sha256,
    proxyCheck: proxyJson,
  };

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

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="JAMS-PACK.zip"`);
  res.setHeader("Content-Length", finalZip.length);
  res.status(200).send(finalZip);
}
