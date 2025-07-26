export default async function handler(req, res) {
  const dcUrl = req.query.dc;
  if (!dcUrl) {
    return res.status(400).json({ error: "Missing ?dc= webhook URL" });
  }

  // Extract request details
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.connection?.remoteAddress ||
    "unknown";

  const method = req.method;
  const contentType = req.headers["content-type"] || "unknown";

  // Try to get body (if applicable)
  let body = null;
  if (["POST", "PUT", "PATCH"].includes(method)) {
    try {
      body = req.body;
    } catch (e) {
      body = "Could not parse body";
    }
  }

  // Prepare payload
  const payload = {
    method,
    contentType,
    headers: req.headers,
    ip,
    body,
  };

  // Send webhook
  try {
    const webhookRes = await fetch(dcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return res.status(200).json({
      message: "Forwarded successfully",
      webhookStatus: webhookRes.status,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to send webhook", details: err.message });
  }
}

// Enable body parsing for all content types
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '9mb',
    },
  },
};
