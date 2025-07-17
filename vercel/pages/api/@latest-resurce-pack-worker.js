// pages/api/github-pack-hook.js
import { buildPack } from "../../lib/packBuilder";


export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  const { discord } = req.query;
  const payload = req.body;
console.log(payload);

  const branch = payload?.ref?.split("/").pop();
  if (branch !== "OFFICIAL-VERSION-DONT-FUCK-UP") {
    return res.status(200).json({ ignored: true, reason: "Wrong branch" });
  }

  let result;
  try {
    result = await buildPack();
  } catch (err) {
    console.error("[ERROR] Pack build failed:", err);
    return res.status(500).json({ error: true, message: err.message });
  }

  if (discord) {
    const commits = payload.commits || [];
    const commitMsg = commits
      .map((c) => `[\`${c.id.slice(0, 7)}\`](${c.url}) - ${c.message}`)
      .join("\n");

    const embed = {
      title: "📦 Resource Pack Updated",
      description: `**SHA1:** \`${result.sha1}\`\n**[Download](${result.blobUrl})**\n**Size:** ${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB\n**Files:** ${result.fileCount}`,
      fields: [{ name: "Commits", value: commitMsg || "*No commits provided*" }],
      color: 0x00ccff,
      timestamp: new Date().toISOString(),
    };

    await fetch(discord, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  }

  return res.status(200).json({ success: true, ...result });
}
