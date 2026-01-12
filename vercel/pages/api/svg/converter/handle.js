import sharp from 'sharp'
import { Resvg } from '@resvg/resvg-js'
import fetch from 'node-fetch'

async function embedExternalImages(svgString) {
  const { JSDOM } = await import('jsdom')
  const sharp = (await import('sharp')).default

  const dom = new JSDOM(svgString, { contentType: 'image/svg+xml' })
  const document = dom.window.document
  const images = [...document.querySelectorAll('image')]

  for (const img of images) {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href')
    if (!href) continue
    if (href.startsWith('data:')) continue

    try {
      const response = await fetch(href)
      if (!response.ok) continue

      // 👇 THIS buffer is used for BOTH size detection and embedding
      const buffer = await response.buffer()

      // ================================
      // ✅ ADD THIS BLOCK — RIGHT HERE
      // ================================
      const hasWidth = img.hasAttribute('width')
      const hasHeight = img.hasAttribute('height')

      if (!hasWidth || !hasHeight) {
        const meta = await sharp(buffer).metadata()

        // height exists → compute width
        if (!hasWidth && hasHeight && meta.width && meta.height) {
          const h = parseFloat(img.getAttribute('height'))
          img.setAttribute('width', (h * meta.width / meta.height).toString())
        }

        // width exists → compute height
        if (!hasHeight && hasWidth && meta.width && meta.height) {
          const w = parseFloat(img.getAttribute('width'))
          img.setAttribute('height', (w * meta.height / meta.width).toString())
        }
      }
      // ================================
      // ✅ END FIX
      // ================================

      const mimeType =
        response.headers.get('content-type') || 'image/png'
      const base64 = buffer.toString('base64')
      const dataUri = `data:${mimeType};base64,${base64}`

      // Set BOTH (important for resvg)
      img.setAttribute('href', dataUri)
      img.setAttribute('xlink:href', dataUri)

    } catch (e) {
      console.warn('Failed to fetch image:', href, e.message)
    }
  }

  return document.documentElement.outerHTML
}


export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
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

  let svgString = Buffer.from(svgBase64, 'base64').toString('utf-8')

  try {
    svgString = await embedExternalImages(svgString)
  } catch (e) {
    console.warn('Failed to embed external images:', e.message)
  }

  const svgBuffer = Buffer.from(svgString, 'utf-8')
  const output = { sharp: { success: false }, resvg: { success: false } }

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
