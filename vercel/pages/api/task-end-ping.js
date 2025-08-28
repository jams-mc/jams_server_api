import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { data_array } = req.body;

  if (!Array.isArray(data_array) || data_array.length === 0) {
    return res.status(400).json({ error: "Missing or invalid 'data_array'" });
  }

  // generate random 64-char SHA for this request
  const ID_SHA = crypto.randomBytes(32).toString("hex");

  // wait 1 second
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // send POST 1:1 to each URL in the array (fire-and-forget)
  data_array.forEach((url) => {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, ID_SHA }),
    }).catch(() => {
      // silently ignore errors
    });
  });

  // respond with ID_SHA and original data array
  res.status(200).json({
    url: data_array,
    ID_SHA,
  });
}
