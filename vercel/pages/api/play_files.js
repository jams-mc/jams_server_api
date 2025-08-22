import fetch from "node-fetch";
import lamejs from "lamejs"; // MP3 encoder
import { AudioContext } from "web-audio-api";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { fileUrl, songName } = req.body;
  if (!fileUrl || !songName) {
    return res.status(400).json({ error: "Missing fileUrl or songName" });
  }

  try {
    // 1. Download file
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();

    // 2. Decode audio → PCM
    const audioCtx = new AudioContext();
    const audioBuffer = await new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(Buffer.from(arrayBuffer), resolve, reject);
    });

    // 3. Helper: encode PCM → MP3 (with lamejs)
    function encodeMP3(buffer) {
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;

      const mp3Encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128);
      let mp3Data = [];

      const samples = buffer.getChannelData(0); // mono for simplicity
      const blockSize = 1152;

      for (let i = 0; i < samples.length; i += blockSize) {
        const sampleChunk = samples.subarray(i, i + blockSize);
        const mp3buf = mp3Encoder.encodeBuffer(sampleChunk);
        if (mp3buf.length > 0) mp3Data.push(Buffer.from(mp3buf));
      }

      const d = mp3Encoder.flush();
      if (d.length > 0) mp3Data.push(Buffer.from(d));

      return Buffer.concat(mp3Data);
    }

    function arrayBufferToBase64(buf) {
      return Buffer.from(buf).toString("base64");
    }

    // 4. Slice into fragments
    const FRAGMENT_SEC = 5;
    const fragments = [];
    const totalFragments = Math.ceil(audioBuffer.duration / FRAGMENT_SEC);

    for (let i = 0; i < totalFragments; i++) {
      const startSample = i * FRAGMENT_SEC * audioBuffer.sampleRate;
      const endSample = Math.min((i + 1) * FRAGMENT_SEC * audioBuffer.sampleRate, audioBuffer.length);
      const sliceLength = endSample - startSample;

      const tmpBuffer = audioCtx.createBuffer(audioBuffer.numberOfChannels, sliceLength, audioBuffer.sampleRate);
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        tmpBuffer.copyToChannel(audioBuffer.getChannelData(ch).subarray(startSample, endSample), ch, 0);
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
        effects: { colors: ["#ff0066","#33ccff","#ffee33"], visualizer: "bars", pulseSpeed: 1 },
        xano: { sendAfter: 4000, totalLoops: 1 }
      });
    }

    // 5. Send to Xano
    const xanoUrl = process.env.XANO_ENDPOINT;
    if (!xanoUrl) throw new Error("XANO_ENDPOINT not set in environment variables");

    const xanoResp = await fetch(xanoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fragments)
    });

    const xanoResult = await xanoResp.json();

    res.status(200).json({ message: "Fragments sent!", fragments: fragments.length, xanoResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process file", details: err.message });
  }
}
