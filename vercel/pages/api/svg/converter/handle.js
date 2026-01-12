import sharp from 'sharp'
import { Resvg } from '@resvg/resvg-js'
import fetch from 'node-fetch'

async function embedExternalImages(svgString) {
  const { JSDOM } = await import('jsdom')
  const sharp = (await import('sharp')).default

  const dom = new JSDOM(svgString, { contentType: 'image/svg+xml' })
  const document = dom.window.document
  const images = [...document.querySelectorAll('image')]

  console.log(`[SVG] Found ${images.length} <image> elements`)

  for (let i = 0; i < images.length; i++) {
    const img = images[i]

    const href = img.getAttribute('href') || img.getAttribute('xlink:href')
    console.log(`\n[IMG ${i}] original href:`, href)

    if (!href) {
      console.log(`[IMG ${i}] ❌ No href, skipping`)
      continue
    }

    if (href.startsWith('data:')) {
      console.log(`[IMG ${i}] ⚠️ Already embedded, skipping`)
      continue
    }

    try {
      const response = await fetch(href)
      if (!response.ok) {
        console.log(`[IMG ${i}] ❌ Fetch failed: ${response.status}`)
        continue
      }

      const buffer = await response.buffer()
      console.log(`[IMG ${i}] ✅ Fetched image (${buffer.length} bytes)`)

      const hasWidth = img.hasAttribute('width')
      const hasHeight = img.hasAttribute('height')

      console.log(
        `[IMG ${i}] SVG attrs before → width: ${img.getAttribute('width')} height: ${img.getAttribute('height')}`
      )

      if (!hasWidth || !hasHeight) {
        const meta = await sharp(buffer).metadata()
        console.log(`[IMG ${i}] Sharp metadata:`, meta)

        if (!meta.width || !meta.height) {
          console.log(`[IMG ${i}] ❌ No intrinsic size from Sharp`)
        }

        if (!hasWidth && hasHeight && meta.width && meta.height) {
          const h = parseFloat(img.getAttribute('height'))
          const w = h * meta.width / meta.height
          img.setAttribute('width', w.toFixed(2))
          console.log(`[IMG ${i}] ➕ Injected width = ${w.toFixed(2)}`)
        }

        if (!hasHeight && hasWidth && meta.width && meta.height) {
          const w = parseFloat(img.getAttribute('width'))
          const h = w * meta.height / meta.width
          img.setAttribute('height', h.toFixed(2))
          console.log(`[IMG ${i}] ➕ Injected height = ${h.toFixed(2)}`)
        }
      } else {
        console.log(`[IMG ${i}] ✅ width & height already present`)
      }

      const mimeType =
        response.headers.get('content-type') || 'image/png'
      const base64 = buffer.toString('base64')
      const dataUri = `data:${mimeType};base64,${base64}`

      img.setAttribute('href', dataUri)
      img.setAttribute('xlink:href', dataUri)

      console.log(
        `[IMG ${i}] 📌 Embedded + final attrs → width: ${img.getAttribute('width')} height: ${img.getAttribute('height')}`
      )

    } catch (e) {
      console.warn(`[IMG ${i}] 💥 Error:`, e.message)
    }
  }

  console.log('[SVG] Image embedding complete')
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
