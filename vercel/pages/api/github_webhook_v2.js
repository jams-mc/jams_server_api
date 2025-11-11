import fetch from "node-fetch";

export const config = {
  api: { bodyParser: true, externalResolver: true },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const configUrl = req.query.config;
  if (!configUrl) return res.status(400).json({ error: "Missing ?config=" });

  // get webhook URLs from query
  const webhookMap = { ...req.query }; // now webhookMap.default, webhookMap.stars, etc.
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

  // determine initial webhook (default param)
  let webhook = webhookMap.default;

  // ---- Select webhook by event name ----
  if (config.event_webhook?.[event]) {
    const route = config.event_webhook[event];
    if (webhookMap[route]) webhook = webhookMap[route];
  }

  // ---- Select webhook by file matching rules ----
  if (config.file_rules && payload.commits) {
    const changedFiles = payload.commits.flatMap(c => [...c.added, ...c.modified, ...c.removed]);

    for (const file of changedFiles) {
      for (const rule of config.file_rules) {
        if (file.includes(rule.match)) { // substring match
          const route = rule.webhook;
          if (webhookMap[route]) webhook = webhookMap[route];
        }
      }
    }
  }

  // ---- Decode custom handler if present ----
  let customHandler = null;
  if (config.custom_handler_b64) {
    try {
      const code = Buffer.from(config.custom_handler_b64, "base64").toString("utf8");
      customHandler = new Function("payload", "event", "embeds", "config", code);
    } catch {}
  }

  // ---- Default handler (only star included here for clarity) ----
  if (event === "star") {
    const { sender, repository, action } = payload;
    embeds.push({
      title: `⭐ Repository Star ${action}`,
      description: `**${sender.login}** ${action} starred **${repository.full_name}**`,
      color: 0xffdd33,
      timestamp: new Date().toISOString(),
    });
  } else {
    embeds.push({
      title: `📣 Unhandled GitHub Event`,
      description: `Event: \`${event}\``,
      color: 0x888888,
      timestamp: new Date().toISOString(),
    });
  }

  // ---- Apply custom script ----
  if (customHandler && config.use_custom_handler_for_events?.includes(event)) {
    try {
      await customHandler(payload, event, embeds, config);
    } catch (err) {
      console.warn("Custom script error:", err);
    }
  }

  // ---- Send with optional fallback ----
  async function send(url, embedsData) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: embedsData })
    });
    return r.ok;
  }

  const ok = await send(webhook, embeds);

  if (!ok && fallbackWebhook) {
    await send(fallbackWebhook, [
      {
        title: "⚠ Webhook Send Failed",
        description: `Event: \`${event}\` — using fallback.`,
        color: 0xff0000,
        timestamp: new Date().toISOString(),
      },
      ...embeds
    ]);
  }

  return res.status(200).json({ sent: true, webhookUsed: webhook, fallback: !ok });
}
