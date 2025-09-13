import sharp from 'sharp'
import { Resvg } from '@resvg/resvg-js'
import fetch from 'node-fetch'
import { JSDOM } from 'jsdom'

async function embedExternalImages(svgString) {
  const dom = new JSDOM(svgString, { contentType: 'image/svg+xml' })
  const document = dom.window.document
  const images = [...document.querySelectorAll('image')]

  for (const img of images) {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href')
    if (!href) continue
    if (href.startsWith('data:')) continue // already embedded

    try {
      const response = await fetch(href)
      if (!response.ok) continue
      const buffer = await response.buffer()
      const mimeType = response.headers.get('content-type') || 'image/png'
      const base64 = buffer.toString('base64')
      const dataUri = `data:${mimeType};base64,${base64}`

      // Replace href attribute
      if (img.hasAttribute('href')) {
        img.setAttribute('href', dataUri)
      } else {
        img.setAttribute('xlink:href', dataUri)
      }
    } catch (e) {
      // ignore fetch errors, keep original href
      console.warn('Failed to fetch image:', href, e.message)
    }
  }

  // Serialize back to string
  return document.documentElement.outerHTML
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // increase if needed
    },
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' })
  }

  const { svgBase64, access_key } = req.body
  if (access_key !== process.env.SVG_KEY) {
    return res.status(403).json({ error: 'Invalid access key' })
  }
  if (!svgBase64) {
    return res.status(400).json({ error: 'svgBase64 is required' })
  }

  // Decode original SVG string
  let svgString = Buffer.from(svgBase64, 'base64').toString('utf-8')

  // Replace external images with base64 embedded images
  try {
    svgString = await embedExternalImages(svgString)
  } catch (e) {
    console.warn('Failed to embed external images:', e.message)
  }

  // Encode back to buffer for renderers
  const svgBuffer = Buffer.from(svgString, 'utf-8')

  const output = {
    sharp: { success: false },
    resvg: { success: false },
  }

  // --- SHARP ---
  try {
    const sharpImage = sharp(svgBuffer)
    const metadata = await sharpImage.metadata()
    const pngBuffer = await sharpImage.png().toBuffer()

    output.sharp = {
      success: true,
      base64: pngBuffer.toString('base64'),
      base64_length: pngBuffer.length,
      metadata,
    }
  } catch (err) {
    output.sharp.error = err.message
  }

  // --- RESVG ---
  try {
    const resvgInstance = new Resvg(svgBuffer, { fitTo: { mode: 'original' } })
    const pngBuffer = resvgInstance.render().asPng()
    const metadata = {
      width: resvgInstance.width,
      height: resvgInstance.height,
      size: pngBuffer.length,
    }

    output.resvg = {
      success: true,
      base64: pngBuffer.toString('base64'),
      base64_length: pngBuffer.length,
      metadata,
    }
  } catch (err) {
    output.resvg.error = err.message
  }

  res.status(200).json(output)
}
