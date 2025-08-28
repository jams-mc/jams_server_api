import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { data_array, result_url } = req.body;

  if (!Array.isArray(data_array) || data_array.length === 0) {
    return res.status(400).json({ error: "Missing or invalid 'data_array'" });
  }

  if (!result_url || typeof result_url !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'result_url'" });
  }

  const ID_SHA = crypto.randomBytes(32).toString("hex");

  // wait 1 second
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // fire-and-forget POST to result_url
  fetch(result_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_array, ID_SHA }),
  }).catch(() => {}); // ignore errors

  // respond immediately
  res.status(200).json({
    url: result_url,
    ID_SHA,
  });
}
