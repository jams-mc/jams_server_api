import { Canvas as SkiaCanvas, FontLibrary } from 'skia-canvas';
import opentype from 'opentype.js';
import { createCanvas } from 'canvas';
import { Buffer } from 'buffer';
import fetch from 'node-fetch';

const fontkit = require('fontkit');


export const config = {
  api: {
    bodyParser: { sizeLimit: '25mb' },
  },
};
let fontBuffers;
const fallbackFonts = [
  { url: 'https://jams-mc.github.io/jams_server_api/vercel/pages/api/svg/converter/fonts/Noto_Emoji/NotoEmoji-VariableFont_wght.ttf' },
  { url: 'https://jams-mc.github.io/jams_server_api/vercel/pages/api/svg/converter/fonts/symbola/Symbola.ttf' },
  { url: 'https://jams-mc.github.io/jams_server_api/vercel/pages/api/svg/converter/fonts/symbola/Symbola_hint.ttf' },
  { url: 'https://jams-mc.github.io/jams_server_api/vercel/pages/api/svg/converter/fonts/dejavu-sans/DejaVuSansCondensed.ttf' },
  { url: 'https://jams-mc.github.io/jams_server_api/vercel/pages/api/svg/converter/fonts/NotoEmoji-VariableFont_wght.ttf' },
  { url: 'https://jams-mc.github.io/jams_server_api/vercel/pages/api/svg/converter/fonts/NotoEmoji-VariableFont_wght.ttf' },
  { url: 'https://jams-mc.github.io/jams_server_api/vercel/pages/api/svg/converter/fonts/NotoSansKR-VariableFont_wght.ttf' },
];


function parseStyle(style = '') {
  const fontSize = parseInt((style.match(/font-size\s*:\s*(\d+)px/i) || [])[1]) || 48;
  const fill = (style.match(/fill\s*:\s*([^;]+)/i) || [])[1] || '#000000';
  return { fontSize, fill };
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

let loadedFallbackFonts = null;
async function getFallbackFonts() {
  if (!loadedFallbackFonts) {
    loadedFallbackFonts = await Promise.all(
      fallbackFonts.map(async (font) => {
        console.log(`Loading fallback font: ${font.url}`);
        const buffer = await loadFontData(font);

       const userFontBuffer = await loadFontData(font); // from payload
fontBuffers = [
  { family: 'PrimaryFont', buffer: userFontBuffer },
  ...await Promise.all(
    fallbackFonts.map(async (font, i) => ({
      family: `FallbackFont${i}`,
      buffer: await loadFontData(font),
    }))
  ),
];
console.log(fontBuffers);

        return opentype.parse(buffer.buffer);
      })
    );
    console.log(`Loaded ${loadedFallbackFonts.length} fallback fonts.`);
  }
  return loadedFallbackFonts;
}

function getBestFontForChar(char, fonts) {
console.log("char to find glyph");
console.log(char);
  for (const font of fonts) {
    const glyph = font.charToGlyph(char);
    if (glyph.unicode !== undefined && glyph.name !== '.notdef') {
      return font;
    }
  }
  return null;
}

function drawTextToCanvas(primaryFont, text, fontSize, fill, fallbackFonts = []) {
  const usedFonts = [primaryFont, ...fallbackFonts];
  const paths = [];
  let x = 0;
console.log("drawTextToCanvas");
console.log(text);
console.log("fonts:");
console.log(usedFonts);

  for (let ch of Array.from(text)) {
    let matchedFont = getBestFontForChar(ch, usedFonts);
    if (!matchedFont) {
      console.warn(`Missing glyph for "${ch}" — using '?'`);
      matchedFont = primaryFont;
      ch = '?';
    }
    const glyph = matchedFont.charToGlyph(ch);
    const glyphPath = glyph.getPath(x, fontSize, fontSize);
    paths.push({ path: glyphPath });
    x += glyph.advanceWidth * (fontSize / matchedFont.unitsPerEm);
  }

  const fullPath = new opentype.Path();
  for (const { path } of paths) {
    for (const cmd of path.commands) {
      fullPath.commands.push(cmd);
    }
  }

  const bbox = fullPath.getBoundingBox();
  const width = Math.ceil(bbox.x2 - bbox.x1 + 20);
  const height = Math.ceil(bbox.y2 - bbox.y1 + 40);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = fill;
  ctx.translate(-bbox.x1 + 10, -bbox.y1 + 10);

  ctx.beginPath();
  for (const cmd of fullPath.commands) {
    if (cmd.type === 'M') ctx.moveTo(cmd.x, cmd.y);
    else if (cmd.type === 'L') ctx.lineTo(cmd.x, cmd.y);
    else if (cmd.type === 'C') ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y);
    else if (cmd.type === 'Q') ctx.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
    else if (cmd.type === 'Z') ctx.closePath();
  }
  ctx.fill();

  return canvas.toBuffer('image/png');
}



async function drawWithSkia(text, fontBuffers, fontSize, fill = '#000') {
  try {
    const resolvedFonts = [];

    for (const { buffer } of fontBuffers) {
      const font = fontkit.create(buffer);
      const family = font.familyName;

      FontLibrary.use({ family, buffer });
      resolvedFonts.push({ family, font });
      console.log(`✅ Registered font buffer as "${family}"`);
    }

    const canvas = new SkiaCanvas(1024, fontSize + 60);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = fill;

    let x = 20;

    for (const char of text) {
      const code = char.codePointAt(0);
      const hex = `U+${code.toString(16).toUpperCase()}`;
      let drawn = false;

      for (const { family, font } of resolvedFonts) {
        const glyph = font.glyphForCodePoint(code);
        if (glyph.id !== 0) {
          ctx.font = `${fontSize}px ${family}`;
          const width = ctx.measureText(char).width;
          ctx.fillText(char, x, fontSize);
          x += width;
          console.log(`✔ "${char}" (${hex}) drawn with "${family}"`);
          drawn = true;
          break;
        }
      }

      if (!drawn) {
        console.warn(`❌ Missing glyph for "${char}" (${hex}) — using fallback '?'`);
        ctx.font = `${fontSize}px ${resolvedFonts[0].family}`;
        const width = ctx.measureText('?').width;
        ctx.fillText('?', x, fontSize);
        x += width;
      }
    }

    return canvas.toBuffer('png');
  } catch (err) {
    throw new Error(`Skia rendering error: ${err.message}`);
  }
}



export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const { access_key, payload } = req.body;
  if (access_key !== process.env.SVG_KEY) return res.status(403).json({ error: 'Invalid access key' });
  if (!Array.isArray(payload)) return res.status(400).json({ error: 'Payload must be an array' });

  try {
    const fallbackParsedFonts = await getFallbackFonts();

    const results = await Promise.all(payload.map(async ({ id, font, text, style }) => {
      try {
        console.log(`---\nProcessing ID: ${id}\nText: "${text}"`);
        const fontBuffer = await loadFontData(font);
        const parsedFont = opentype.parse(fontBuffer.buffer);
        const { fontSize, fill } = parseStyle(style);

        // Try Skia first
        try {
          const skiaPng = await drawWithSkia(text, fontBuffers, fontSize, fill);
          const base64 = skiaPng.toString('base64');
          const datauri = `data:image/png;base64,${base64}`;
          return { id, datauri, success: true, method: 'skia' };
        } catch (skiaErr) {
          console.warn(`Skia rendering failed for ID ${id}: ${skiaErr.message}`);
        }

        // Fallback to opentype.js
        const pngBuffer = drawTextToCanvas(parsedFont, text, fontSize, fill, fallbackParsedFonts);
        const base64 = pngBuffer.toString('base64');
        const datauri = `data:image/png;base64,${base64}`;
        return { id, datauri, success: true, method: 'opentype' };

      } catch (e) {
        console.error(`Error rendering ID ${id}:`, e);
        return { id, success: false, error: e.message };
      }
    }));

    return res.status(200).json(results);
  } catch (err) {
    console.error('Unexpected error in handler:', err);
    return res.status(500).json({ error: 'Unexpected server error.' });
  }
}
