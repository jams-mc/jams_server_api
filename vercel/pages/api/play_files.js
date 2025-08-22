import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { fileUrl, songName } = req.body;
  if (!fileUrl || !songName) {
    return res.status(400).json({ error: "Missing fileUrl or songName" });
  }

  try {
    console.log("🔗 Downloading:", fileUrl);
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Init ffmpeg wasm
    const ffmpeg = createFFmpeg({ log: true });
    if (!ffmpeg.isLoaded()) await ffmpeg.load();

    // Write mp3 to FFmpeg virtual FS
    ffmpeg.FS("writeFile", "input.mp3", await fetchFile(buffer));

    const FRAGMENT_SEC = 5;
    let fragments = [];
    let start = 0;
    let index = 0;

    // Loop: extract 5s segments until EOF
    while (true) {
      const outName = `frag-${index}.mp3`;

      try {
        await ffmpeg.run(
          "-i", "input.mp3",
          "-ss", String(start),
          "-t", String(FRAGMENT_SEC),
          "-c", "copy",
          outName
        );
      } catch (err) {
        break; // reached EOF
      }

      // Check if fragment exists in FS
      let fragData;
      try {
        fragData = ffmpeg.FS("readFile", outName);
      } catch {
        break; // no more fragments
      }

      // Convert to base64
      const base64Fragment = Buffer.from(fragData).toString("base64");

      // Push formatted JSON object
      fragments.push({
        action: "play",
        song: {
          fragment: base64Fragment,
          songname: songName,
          totalDuration: FRAGMENT_SEC,
          durationToPlayAt: start,
          durationNow: FRAGMENT_SEC
        },
        effects: {
          colors: ["#ff0066", "#33ccff", "#ffee33"],
          visualizer: "bars",
          pulseSpeed: 1
        },
        xano: {
          sendAfter: 4000,
          totalLoops: 1
        }
      });

      // Clean up fragment from FS
      ffmpeg.FS("unlink", outName);

      start += FRAGMENT_SEC;
      index++;
    }

    console.log("✅ Built", fragments.length, "fragments");

    // Send to Xano
    const xanoUrl = process.env.XANO_ENDPOINT;
    if (!xanoUrl) throw new Error("XANO_ENDPOINT not set in environment variables");

    const xanoResp = await fetch(xanoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fragments)
    });

    const xanoResult = await xanoResp.json();
    console.log("📤 Xano response:", xanoResult);

    res.status(200).json({
      message: "Fragments sent!",
      fragments: fragments.length,
      xanoResult
    });
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Failed to process file", details: err.message });
  }
}
