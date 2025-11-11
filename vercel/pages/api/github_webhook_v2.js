import fetch from "node-fetch";

export const config = {
  api: { bodyParser: true, externalResolver: true },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const configUrl = req.query.config;
  if (!configUrl) return res.status(400).json({ error: "Missing ?config=<url>" });

  // Extract webhook names → webhook URLs passed via query
  const webhookMap = { ...req.query };
  const fallbackWebhook = webhookMap.fallback || null;

  delete webhookMap.config;
  delete webhookMap.fallback;

  let config;
  try {
    config = await fetch(configUrl).then(r => r.json());
  } catch {
    return res.status(400).json({ error: "Config URL did not return valid JSON" });
  }

  const event = req.headers["x-github-event"];
  const payload = req.body;
  let embeds = [];

  console.log("---- Webhook Triggered ----");
  console.log("Event:", event);
  console.log("Webhook keys available:", Object.keys(webhookMap));

  // --- Repo-based embed author formatting ---
  const useRepoAuthor = req.query["use-repo"] === "true";
  const repoIcon = req.query["repo-icon"];
  let author = undefined;

  if (useRepoAuthor && payload.repository) {
    const repo = payload.repository;
    author = {
      name: `${repo.owner.login}/${repo.name}`,
      url: repo.html_url,
      icon_url: repoIcon || undefined,
    };
  }

  // --- Select default webhook initially ---
  let webhook = webhookMap.default;

  // --- Event-based routing (config.event_webhook) ---
  if (config.event_webhook?.[event]) {
    const routeName = config.event_webhook[event];
    if (webhookMap[routeName]) {
      webhook = webhookMap[routeName];
      console.log(`[Routing] Event routing matched: ${event} → ${routeName}`);
    } else {
      console.warn(`[Routing] Config requested webhook "${routeName}" but URL did not define it.`);
    }
  }

  // --- File-based routing (config.file_rules) ---
  if (config.file_rules && payload.commits) {
    const changedFiles = payload.commits.flatMap(c => [...c.added, ...c.modified, ...c.removed]);

    for (const file of changedFiles) {
      for (const rule of config.file_rules) {
        if (file.includes(rule.match)) {
          const routeName = rule.webhook;
          if (webhookMap[routeName]) {
            webhook = webhookMap[routeName];
            console.log(`[Routing] File match "${rule.match}" → ${routeName}`);
          } else {
            console.warn(`[Routing] Config referenced webhook "${routeName}" but query did not provide &${routeName}=`);
          }
        }
      }
    }
  }

  console.log("[Routing] Final selected webhook URL:", webhook || "undefined");

  // --- Decode custom handler if present ---
  let customHandler = null;
  if (config.custom_handler_b64) {
    try {
      const code = Buffer.from(config.custom_handler_b64, "base64").toString("utf8");
      customHandler = new Function("payload", "event", "embeds", "config", "author", code);
      console.log("[Custom] Custom handler loaded.");
    } catch (err) {
      console.error("[Custom] Custom handler decode failed:", err);
    }
  }

  // --- Default Event Handler (only STAR shown here, rest handled in fallback) ---
  if (event === "star") {
    const { sender, repository, action } = payload;
    embeds.push({
      author,
      title: `⭐ Repository Star ${action}`,
      description: `**${sender.login}** ${action} starred **${repository.full_name}**`,
      color: 0xffdd33,
      timestamp: new Date().toISOString(),
    });
  } else {
    // Default
    embeds.push({
      author,
      title: `📣 Unhandled GitHub Event`,
      description: `Event: \`${event}\``,
      color: 0x888888,
      timestamp: new Date().toISOString(),
    });
  }

  // --- Apply custom handler if configured ---
  if (customHandler && config.use_custom_handler_for_events?.includes(event)) {
    try {
      await customHandler(payload, event, embeds, config, author);
      console.log("[Custom] Custom handler executed.");
    } catch (err) {
      console.error("[Custom] Handler error:", err);
    }
  }

  // --- Send helper with full diagnostics ---
  async function send(url, data, label) {
    if (!url) {
      console.error(`[Send] ${label}: URL missing`);
      return false;
    }

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: data })
      });

      if (!resp.ok) {
        console.error(`[Send] ${label}: HTTP ${resp.status}`);
        const text = await resp.text().catch(() => "");
        console.error(`[Send] Discord Response: ${text.slice(0, 300)}`);
        return false;
      }

      console.log(`[Send] ${label}: success`);
      return true;
    } catch (err) {
      console.error(`[Send] ${label}: exception`, err);
      return false;
    }
  }

  // --- MAIN SEND + FALLBACK ---
  let ok = await send(webhook, embeds, "main");

  if (!ok && fallbackWebhook) {
    console.warn("[Send] Main webhook failed → Using fallback");
    const warnEmbed = {
      author,
      title: "⚠ Webhook Delivery Failure",
      description: `Main webhook for event \`${event}\` failed.`,
      color: 0xff0000,
      timestamp: new Date().toISOString()
    };
    await send(fallbackWebhook, [warnEmbed, ...embeds], "fallback");
  }

  return res.status(200).json({ success: true });
}
