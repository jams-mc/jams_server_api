import fetch from "node-fetch";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { tmpdir } from "os";
import { join } from "path";
import { promises as fs } from "fs";

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

    const inputPath = join(tmpdir(), `input-${Date.now()}.mp3`);
    await fs.writeFile(inputPath, buffer);

    const FRAGMENT_SEC = 5;
    const outputPattern = join(tmpdir(), "frag-%03d.mp3");

    console.log("✂️ Splitting with ffmpeg…");
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setFfmpegPath(ffmpegInstaller.path) // ✅ use installer binary
        .outputOptions(["-f segment", `-segment_time ${FRAGMENT_SEC}`, "-c copy"])
        .output(outputPattern)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    const files = await fs.readdir(tmpdir());
    const fragFiles = files.filter(f => f.startsWith("frag-") && f.endsWith(".mp3")).sort();

    const fragments = [];
    for (let i = 0; i < fragFiles.length; i++) {
      const fragPath = join(tmpdir(), fragFiles[i]);
      const fragBuf = await fs.readFile(fragPath);

      fragments.push({
        action: "play",
        song: {
          fragment: fragBuf.toString("base64"),
          songname: songName,
          totalDuration: FRAGMENT_SEC,
          durationToPlayAt: i * FRAGMENT_SEC,
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
    }

    res.status(200).json({ fragmentsCount: fragments.length, fragments });
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Failed to process file", details: err.message });
  }
}
