import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    console.log("Method not allowed:", req.method);
    return res.status(405).json({ error: "Method not allowed" });
  }
console.log("hello");

  const { data_array, result_url } = req.body;

  if (!Array.isArray(data_array) || data_array.length === 0) {
    console.log("Invalid data_array:", data_array);
    return res.status(400).json({ error: "Missing or invalid 'data_array'" });
  }

  if (!result_url || typeof result_url !== "string") {
    console.log("Invalid result_url:", result_url);
    return res.status(400).json({ error: "Missing or invalid 'result_url'" });
  }

  console.log("Received request:", { data_array, result_url });

  // generate 64-char SHA
  const ID_SHA = crypto.randomBytes(32).toString("hex");

  // wait 1 second
  console.log("Waiting 1 second before sending POST...");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log("Waited 1 second, sending POST to:", result_url);

  // POST body
  const body = { urls: data_array, ID_SHA };
  console.log("POST body:", body);

  // create a fetch with 5-second timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 5000);

  let fetchResponseText = null;
  try {
    const response = await fetch(result_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    fetchResponseText = await response.text();
    console.log("Received response from result_url:", fetchResponseText);
  } catch (err) {
    if (err.name === "AbortError") {
      console.log("POST request timed out after 5 seconds");
    } else {
      console.log("Error sending POST:", err);
    }
  } finally {
    clearTimeout(timeout);
  }

  res.status(200).json({
    result_url,
    ID_SHA,
    fetch_response: fetchResponseText || "timed out or failed"
  });
}
