import fetch from "node-fetch";

export const config = {
  api: {
    bodyParser: true,
    externalResolver: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const discordWebhook = req.query.discord;
  if (!discordWebhook) return res.status(400).json({ error: "Missing ?discord=" });

  const payload = req.body;
  const event = req.headers["x-github-event"];
  if (!event) return res.status(400).json({ error: "Missing GitHub Event Header" });

  const embeds = [];

  switch (event) {
    case "push": {
      const { repository, ref, commits, pusher } = payload;
      const branch = ref.split("/").pop();
      const commitLines = commits
        .map(c => `[\`${c.id.slice(0, 7)}\`](${c.url}) - ${c.message.split("\n")[0]}`)
        .join("\n");
      embeds.push({
        title: `📦 Pushed to \`${repository.name}:${branch}\``,
        description: `**By:** ${pusher.name}\n\n${commitLines}`,
        color: 0x00ccff,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case "pull_request": {
      const pr = payload.pull_request;
      embeds.push({
        title: `📬 Pull Request ${payload.action}: #${pr.number}`,
        description: `**${pr.title}**\n[View PR](${pr.html_url})\n**Author:** ${pr.user.login}`,
        color: 0x8e44ad,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case "issues": {
      const issue = payload.issue;
      embeds.push({
        title: `❗ Issue ${payload.action}: #${issue.number}`,
        description: `**${issue.title}**\n[View Issue](${issue.html_url})\n**By:** ${issue.user.login}`,
        color: 0xe67e22,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case "workflow_run": {
      const { workflow, action, workflow_run } = payload;
      embeds.push({
        title: `🤖 GitHub Actions: ${workflow.name}`,
        description: `**Status:** ${workflow_run.conclusion || workflow_run.status}\n**Event:** ${workflow_run.event}\n[View Run](${workflow_run.html_url})`,
        color: 0x3498db,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    default: {
      embeds.push({
        title: "📣 Unhandled GitHub Event",
        description: `Event: \`${event}\`\nConsider adding support for this.`,
        color: 0x95a5a6,
        timestamp: new Date().toISOString(),
      });
    }
  }

  try {
    const resp = await fetch(discordWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds }),
    });

    if (!resp.ok) {
      const error = await resp.text();
      return res.status(500).json({ error: "Discord webhook failed", detail: error });
    }

    return res.status(200).json({ success: true, sent: embeds.length });
  } catch (err) {
    console.error("[Webhook Error]", err);
    return res.status(500).json({ error: "Failed to send Discord webhook" });
  }
}
