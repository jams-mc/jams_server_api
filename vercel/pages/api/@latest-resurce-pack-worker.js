// pages/api/github-pack-hook.js
import { buildPack } from "../../lib/packBuilder";

export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  const { discord } = req.query;
  const payload = req.body;
  const event = req.headers["x-github-event"];
  const TARGET_BRANCH = "OFFICIAL-VERSION-DONT-FUCK-UP";

  let shouldBuild = false;
  let commitSummary = "";

  // --- Determine if we should build based on event type ---
  if (event === "push") {
    const branch = payload?.ref?.split("/").pop();
    if (branch !== TARGET_BRANCH) {
      return res.status(200).json({ ignored: true, reason: "Wrong branch (push)" });
    }
    shouldBuild = true;

    const commits = payload.commits || [];
    commitSummary = commits
      .map((c) => `[\`${c.id.slice(0, 7)}\`](${c.url}) - ${c.message}`)
      .join("\n");

  } else if (event === "pull_request") {
    const pr = payload.pull_request;
    const action = payload.action;

    const isMerged = pr.merged === true;
    const isCorrectBranch = pr.base?.ref === TARGET_BRANCH;

    if (isMerged && isCorrectBranch) {
      shouldBuild = true;
      commitSummary = `Merged PR [#${pr.number}](${pr.html_url}) by ${pr.user.login}\n\n> ${pr.title}`;
    } else {
      return res.status(200).json({ ignored: true, reason: "PR not merged to target branch" });
    }

  } else {
    return res.status(200).json({ ignored: true, reason: `Unhandled event: ${event}` });
  }

  // --- Trigger Build ---
  let result;
  try {
    result = await buildPack();
  } catch (err) {
    console.error("[ERROR] Pack build failed:", err);
    return res.status(500).json({ error: true, message: err.message });
  }

  // --- Send Discord Embed ---
  if (discord) {
    const embed = {
      title: "📦 Resource Pack Updated",
      description: `**SHA1:** \`${result.sha1}\`\n**[Download](${result.blobUrl})**\n**Size:** ${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB\n**Files:** ${result.fileCount}`,
      fields: commitSummary
        ? [{ name: "Changes", value: commitSummary }]
        : [],
      color: 0x00ccff,
      timestamp: new Date().toISOString(),
    };

    await fetch(discord, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  }

  return res.status(200).json({ success: true, fromEvent: event, ...result });
}
