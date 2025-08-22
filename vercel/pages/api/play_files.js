import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg/node";

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

    // Write MP3 into WASM FS
    ffmpeg.FS("writeFile", "input.mp3", await fetchFile(buffer));

    const FRAGMENT_SEC = 5;
    let fragments = [];
    let start = 0;
    let index = 0;

    // Keep extracting until EOF
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
        break; // no more audio left
      }

      // Try reading the fragment
      let fragData;
      try {
        fragData = ffmpeg.FS("readFile", outName);
      } catch {
        break; // fragment didn’t get created → EOF
      }

      // Convert to base64
      const base64Fragment = Buffer.from(fragData).toString("base64");

      // Push formatted JSON object
      fragments.push({
        action: "play",
        song: {
          fragment: base64Fragment,
          songname: songName,
          totalDuration: FRAGMENT_SEC,   // per-chunk duration
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

      // Clean up
      ffmpeg.FS("unlink", outName);

      start += FRAGMENT_SEC;
      index++;
    }

    console.log("✅ Built", fragments.length, "fragments");

    // Optionally send to Xano
    const xanoUrl = process.env.XANO_ENDPOINT;
    let xanoResult = null;
    if (xanoUrl) {
      const xanoResp = await fetch(xanoUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fragments)
      });
      xanoResult = await xanoResp.json();
    }

    res.status(200).json({
      message: "Fragments ready",
      fragmentsCount: fragments.length,
      fragments,   // remove if you only want to send to Xano
      xanoResult
    });
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Failed to process file", details: err.message });
  }
}
