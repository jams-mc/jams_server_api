export default async function handler(req, res) {
  const dcUrl = req.query.dc;
  if (!dcUrl) {
    return res.status(400).json({ error: "Missing ?dc= webhook URL" });
  }

  // Extract details
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.connection?.remoteAddress ||
    "unknown";

  const method = req.method;
  const contentType = req.headers["content-type"] || "unknown";

  // Construct Discord-style embed payload
  const embed = {
    title: "📥 Incoming API Request",
    color: 0x00bfff,
    fields: [
      { name: "Method", value: method, inline: true },
      { name: "Content-Type", value: contentType, inline: true },
      { name: "IP", value: ip, inline: false },
    ],
    timestamp: new Date().toISOString(),
  };

  // Send webhook
  try {
    const webhookRes = await fetch(dcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });

    return res.status(200).json({
      message: "Embed sent",
      webhookStatus: webhookRes.status,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to send webhook", details: err.message });
  }
}

// Vercel body parser is fine as-is here (no need to access raw body)
