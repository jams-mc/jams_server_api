import opentype from 'opentype.js';
import { createCanvas } from 'canvas';
import { Buffer } from 'buffer';
import fetch from 'node-fetch';

export const config = {
  api: {
    bodyParser: { sizeLimit: '25mb' },
  },
};

function parseStyle(style = '') {
  const fontSize = parseInt((style.match(/font-size\s*:\s*(\d+)px/i) || [])[1]) || 48;
  const fill = (style.match(/fill\s*:\s*([^;]+)/i) || [])[1] || '#000000';
  return { fontSize, fill };
}

function drawTextToCanvas(font, text, fontSize, fill) {
  const safeText = Array.from(text).map(char => {
    const glyph = font.charToGlyph(char);
    return glyph.unicode !== undefined ? char : '?';  // Replace missing glyphs with '?'
  }).join('');

  const path = font.getPath(safeText, 0, fontSize, fontSize);
  const bbox = path.getBoundingBox();

  const width = Math.ceil(bbox.x2 - bbox.x1 + 20);
  const height = Math.ceil(bbox.y2 - bbox.y1 + 20);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = fill;
  ctx.translate(-bbox.x1 + 10, -bbox.y1 + 10);

  ctx.beginPath();
  for (const cmd of path.commands) {
    if (cmd.type === 'M') ctx.moveTo(cmd.x, cmd.y);
    else if (cmd.type === 'L') ctx.lineTo(cmd.x, cmd.y);
    else if (cmd.type === 'C') ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
    else if (cmd.type === 'Q') ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
    else if (cmd.type === 'Z') ctx.closePath();
  }
  ctx.fill();

  return canvas.toBuffer('image/png');
}

async function loadFontData(font) {
  if (font.base64) {
    return Buffer.from(font.base64, 'base64');
  } else if (font.url) {
    const response = await fetch(font.url);
    if (!response.ok) throw new Error(`Failed to fetch font from URL: ${font.url}`);
    return Buffer.from(await response.arrayBuffer());
  } else {
    throw new Error('Font must have either base64 or url');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const { access_key, payload } = req.body;
  if (access_key !== process.env.SVG_KEY) return res.status(403).json({ error: 'Invalid access key' });

  if (!Array.isArray(payload)) return res.status(400).json({ error: 'Payload must be an array' });

  const results = await Promise.all(payload.map(async ({ id, font, text, style }) => {
    try {
      const fontBuffer = await loadFontData(font);
      const parsedFont = opentype.parse(fontBuffer.buffer);
      const { fontSize, fill } = parseStyle(style);

      const pngBuffer = drawTextToCanvas(parsedFont, text, fontSize, fill);
      const base64 = pngBuffer.toString('base64');
      const datauri = `data:image/png;base64,${base64}`;

      return { id, datauri, success: true };
    } catch (e) {
      return { id, success: false, error: e.message };
    }
  }));

  return res.status(200).json(results);
}
