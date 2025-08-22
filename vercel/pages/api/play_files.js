import fetch from "node-fetch";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { PassThrough } from "stream";

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
    console.log("📦 File downloaded:", buffer.length, "bytes");

    // Write buffer to temp file
    const fs = await import("fs/promises");
    const path = await import("path");
    const os = await import("os");
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `input-${Date.now()}.mp3`);
    await fs.writeFile(inputPath, buffer);

    // Split into 5-second MP3 segments
    const FRAGMENT_SEC = 5;
    const fragments = [];

    console.log("✂️ Splitting with ffmpeg…");
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setFfmpegPath(ffmpegPath)
        .outputOptions([
          "-f segment",
          `-segment_time ${FRAGMENT_SEC}`,
          "-c copy",
        ])
        .output(path.join(tmpDir, "frag-%03d.mp3"))
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    // Read back fragments
    const files = await fs.readdir(tmpDir);
    const fragFiles = files.filter(f => f.startsWith("frag-") && f.endsWith(".mp3"));
    fragFiles.sort();

    for (let i = 0; i < fragFiles.length; i++) {
      const fragPath = path.join(tmpDir, fragFiles[i]);
      const fragBuf = await fs.readFile(fragPath);
      const base64Fragment = fragBuf.toString("base64");

      fragments.push({
        action: "play",
        song: {
          fragment: base64Fragment,
          songname: songName,
          totalDuration: undefined, // you can compute with ffprobe if needed
          durationToPlayAt: i * FRAGMENT_SEC,
          durationNow: FRAGMENT_SEC
        },
        effects: { colors: ["#ff0066","#33ccff","#ffee33"], visualizer: "bars", pulseSpeed: 1 },
        xano: { sendAfter: 4000, totalLoops: 1 }
      });
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

    res.status(200).json({ message: "Fragments sent!", fragments: fragments.length, xanoResult });
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Failed to process file", details: err.message });
  }
}
