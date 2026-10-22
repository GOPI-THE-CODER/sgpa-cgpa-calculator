'use strict';

/**
 * Minimal PNG reader and colour helpers for the browser verification script.
 *
 * Decoding is needed because the contrast check must measure the *rendered*
 * pixels of a screenshot: CSS colours alone cannot express a gradient, a
 * translucent glass surface or the result of a backdrop filter.
 *
 * Only what CDP `Page.captureScreenshot` produces is supported: 8-bit
 * non-interlaced PNGs in greyscale, RGB, RGBA, palette or greyscale+alpha.
 */

const zlib = require('node:zlib');

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const dataChunks = [];
  let palette = null;
  let transparency = null;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      dataChunks.push(data);
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG images are not supported');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(dataChunks));
  const stride = width * channels;
  const decoded = Buffer.alloc(height * stride);
  let position = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const line = raw.subarray(position, position + stride);
    position += stride;
    const current = decoded.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? decoded.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? current[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      const value = line[x];
      let result;
      if (filter === 0) result = value;
      else if (filter === 1) result = value + a;
      else if (filter === 2) result = value + b;
      else if (filter === 3) result = value + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        result = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
      current[x] = result & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    let r;
    let g;
    let b;
    let a = 255;
    if (colorType === 6) {
      r = decoded[index * 4];
      g = decoded[index * 4 + 1];
      b = decoded[index * 4 + 2];
      a = decoded[index * 4 + 3];
    } else if (colorType === 2) {
      r = decoded[index * 3];
      g = decoded[index * 3 + 1];
      b = decoded[index * 3 + 2];
    } else if (colorType === 0) {
      r = decoded[index];
      g = decoded[index];
      b = decoded[index];
    } else if (colorType === 4) {
      r = decoded[index * 2];
      g = decoded[index * 2];
      b = decoded[index * 2];
      a = decoded[index * 2 + 1];
    } else {
      const entry = decoded[index];
      r = palette[entry * 3];
      g = palette[entry * 3 + 1];
      b = palette[entry * 3 + 2];
      if (transparency && entry < transparency.length) a = transparency[entry];
    }
    rgba[index * 4] = r;
    rgba[index * 4 + 1] = g;
    rgba[index * 4 + 2] = b;
    rgba[index * 4 + 3] = a;
  }

  return { width, height, rgba };
}

function relativeLuminance(rgb) {
  const channel = (value) => {
    const x = value / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianColour(pixels) {
  if (!pixels.length) return null;
  return [
    median(pixels.map((pixel) => pixel[0])),
    median(pixels.map((pixel) => pixel[1])),
    median(pixels.map((pixel) => pixel[2]))
  ];
}

function parseColour(css) {
  const match = String(css).match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
  return [parts[0], parts[1], parts[2]];
}

module.exports = { decodePng, relativeLuminance, contrastRatio, median, medianColour, parseColour };
