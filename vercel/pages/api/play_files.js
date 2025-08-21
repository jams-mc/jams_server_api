import fetch from "node-fetch";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import AudioContext from "web-audio-api"; // lightweight AudioContext for Node

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { fileUrl, songName } = req.body;
  if (!fileUrl || !songName) {
    return res.status(400).json({ error: "Missing fileUrl or songName" });
  }

  try {
    // 1. Download file from URL
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();

    // 2. Decode audio
    const audioCtx = new AudioContext();
    const audioBuffer = await new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(Buffer.from(arrayBuffer), resolve, reject);
    });

    // 3. Encode WAV
    function encodeWAV(audioBuffer) {
      const numOfChannels = audioBuffer.numberOfChannels;
      const sampleRate = audioBuffer.sampleRate;
      const bitDepth = 16;
      const bufferLength = audioBuffer.length * numOfChannels * 2;
      const buffer = Buffer.alloc(44 + bufferLength);

      let offset = 0;
      function writeString(str) {
        buffer.write(str, offset); offset += str.length;
      }
      writeString("RIFF");
      buffer.writeUInt32LE(36 + bufferLength, offset); offset += 4;
      writeString("WAVE");
      writeString("fmt ");
      buffer.writeUInt32LE(16, offset); offset += 4;
      buffer.writeUInt16LE(1, offset); offset += 2; // PCM
      buffer.writeUInt16LE(numOfChannels, offset); offset += 2;
      buffer.writeUInt32LE(sampleRate, offset); offset += 4;
      buffer.writeUInt32LE(sampleRate * numOfChannels * bitDepth / 8, offset); offset += 4;
      buffer.writeUInt16LE(numOfChannels * bitDepth / 8, offset); offset += 2;
      buffer.writeUInt16LE(bitDepth, offset); offset += 2;
      writeString("data");
      buffer.writeUInt32LE(bufferLength, offset); offset += 4;

      for (let i = 0; i < audioBuffer.length; i++) {
        for (let ch = 0; ch < numOfChannels; ch++) {
          let sample = audioBuffer.getChannelData(ch)[i];
          sample = Math.max(-1, Math.min(1, sample));
          const s = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          buffer.writeInt16LE(s, offset); offset += 2;
        }
      }
      return buffer;
    }

    function arrayBufferToBase64(buf) {
      return Buffer.from(buf).toString("base64");
    }

    // 4. Slice into 5-second fragments
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

      const wavBuffer = encodeWAV(tmpBuffer);
      const base64Fragment = arrayBufferToBase64(wavBuffer);

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
