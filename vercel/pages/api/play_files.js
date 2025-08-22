import fetch from "node-fetch";
import { AudioContext } from "web-audio-api";
import * as lamejs from "lamejs"; // ES import form, safer in Node ESM

// ⚡ Fix MPEGMode global issue
if (!globalThis.MPEGMode && lamejs.MPEGMode) {
  globalThis.MPEGMode = lamejs.MPEGMode;
}


export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { fileUrl, songName } = req.body;
  if (!fileUrl || !songName) {
    return res.status(400).json({ error: "Missing fileUrl or songName" });
  }

  try {
    console.log("🔗 Fetching file from:", fileUrl);
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    console.log("📦 File downloaded, size:", arrayBuffer.byteLength, "bytes");

    console.log("🎧 Creating AudioContext...");
    const audioCtx = new AudioContext();

    console.log("📥 Decoding audio...");
    const audioBuffer = await new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(Buffer.from(arrayBuffer), resolve, reject);
    });
    console.log("✅ Audio decoded");
    console.log("   Channels:", audioBuffer.numberOfChannels);
    console.log("   Sample rate:", audioBuffer.sampleRate);
    console.log("   Duration:", audioBuffer.duration.toFixed(2), "sec");

    // --- MP3 encoder helper ---
    function encodeMP3(buffer) {
      console.log("🎼 Encoding buffer to MP3...");
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;

      // MP3 encoder (128 kbps CBR)
      const mp3Encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128);
      let mp3Data = [];

      // Currently only encodes channel 0 (mono) for simplicity
      const samples = buffer.getChannelData(0);
      const blockSize = 1152;

      for (let i = 0; i < samples.length; i += blockSize) {
        const sampleChunk = samples.subarray(i, i + blockSize);
        const mp3buf = mp3Encoder.encodeBuffer(sampleChunk);
        if (mp3buf.length > 0) {
          mp3Data.push(Buffer.from(mp3buf));
        }
      }

      const d = mp3Encoder.flush();
      if (d.length > 0) mp3Data.push(Buffer.from(d));

      const finalBuffer = Buffer.concat(mp3Data);
      console.log("✅ MP3 encoded, size:", finalBuffer.length, "bytes");
      return finalBuffer;
    }

    function arrayBufferToBase64(buf) {
      return Buffer.from(buf).toString("base64");
    }

    // --- Slice into fragments ---
    const FRAGMENT_SEC = 5;
    const fragments = [];
    const totalFragments = Math.ceil(audioBuffer.duration / FRAGMENT_SEC);

    console.log("✂️ Splitting into", totalFragments, "fragments of", FRAGMENT_SEC, "sec");

    for (let i = 0; i < totalFragments; i++) {
      const startSample = i * FRAGMENT_SEC * audioBuffer.sampleRate;
      const endSample = Math.min((i + 1) * FRAGMENT_SEC * audioBuffer.sampleRate, audioBuffer.length);
      const sliceLength = endSample - startSample;

      console.log(`  Fragment ${i + 1}/${totalFragments} | Samples: ${sliceLength}`);

      const tmpBuffer = audioCtx.createBuffer(audioBuffer.numberOfChannels, sliceLength, audioBuffer.sampleRate);

      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const originalChannelData = audioBuffer.getChannelData(ch);
        const slice = originalChannelData.subarray(startSample, endSample);
        tmpBuffer.getChannelData(ch).set(slice, 0);
      }

      const mp3Buffer = encodeMP3(tmpBuffer);
      const base64Fragment = arrayBufferToBase64(mp3Buffer);

      fragments.push({
        action: "play",
        song: {
          fragment: base64Fragment,
          songname: songName,
          totalDuration: Math.floor(audioBuffer.duration),
          durationToPlayAt: i * FRAGMENT_SEC,
          durationNow: sliceLength / audioBuffer.sampleRate
        },
        effects: { colors: ["#ff0066", "#33ccff", "#ffee33"], visualizer: "bars", pulseSpeed: 1 },
        xano: { sendAfter: 4000, totalLoops: 1 }
      });
    }

    console.log("📤 Built", fragments.length, "fragments");

    // --- Send to Xano ---
    const xanoUrl = process.env.XANO_ENDPOINT;
    if (!xanoUrl) throw new Error("XANO_ENDPOINT not set in environment variables");
    console.log("🌐 Sending fragments to Xano:", xanoUrl);

    const xanoResp = await fetch(xanoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fragments)
    });

    const xanoResult = await xanoResp.json();
    console.log("✅ Xano responded:", xanoResult);

    res.status(200).json({ message: "Fragments sent!", fragments: fragments.length, xanoResult });
  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: "Failed to process file", details: err.message });
  }
}
