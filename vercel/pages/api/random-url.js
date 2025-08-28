export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { possible } = req.body;

    if (!Array.isArray(possible) || possible.length === 0) {
      return res.status(400).json({ error: "Missing or invalid 'possible' array" });
    }

    // pick a random url
    const randomUrl = possible[Math.floor(Math.random() * possible.length)];

    // send POST to chosen url
    const response = await fetch(randomUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: randomUrl }),
    });

    // return backendurl (always as string, or array if you expand later)
    return res.status(200).json({
      backendurl: randomUrl,
      amount: 0,
      success: response.ok,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
