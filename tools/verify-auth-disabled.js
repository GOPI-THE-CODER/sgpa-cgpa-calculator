#!/usr/bin/env node
'use strict';

/*
 * Temporary release policy for the current auth-disabled build.
 * This is not a permanent restriction against enabling authentication:
 * update or remove this guard in the release that intentionally configures
 * and verifies Supabase authentication.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const OFFLINE_PATH = path.join(ROOT, 'offline.html');
const SUPABASE_URL_META = 'sgpa-supabase-url';
const SUPABASE_KEY_META = 'sgpa-supabase-publishable-key';

// Baseline copied from the approved auth-disabled index.html and offline.html.
// Intentional exception: img-src allows data: for embedded image resources.
const EXPECTED_CSP = Object.freeze({
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
});

const AUTH_MARKER = /supabase|(?:^|[-_])auth(?:[-_]|$)|publishable|anon[-_]?key|service[-_]?role|api[-_]?key/i;

function read(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

function findTagEnd(html, start) {
  let quote = null;

  for (let index = start; index < html.length; index += 1) {
    const character = html[index];

    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === '>') return index;
  }

  return -1;
}

function findRawTextClose(html, start, tagName) {
  const pattern = new RegExp(`</${tagName}\\b`, 'ig');
  pattern.lastIndex = start;
  const match = pattern.exec(html);
  return match ? match.index : -1;
}

function parseAttributes(tag) {
  const attributes = new Map();
  const body = tag.replace(/^<\s*[a-z0-9:-]+\b/i, '').replace(/\/?>\s*$/i, '');
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = pattern.exec(body)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] !== undefined
      ? match[2]
      : match[3] !== undefined
        ? match[3]
        : match[4] !== undefined
          ? match[4]
          : '';

    if (!attributes.has(name)) attributes.set(name, value);
  }

  return attributes;
}

function scanTags(html, label, errors) {
  const tags = [];
  let index = 0;

  while (index < html.length) {
    const start = html.indexOf('<', index);
    if (start === -1) break;

    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end === -1) {
        errors.push(`${label}: unterminated HTML comment`);
        return tags;
      }
      index = end + 3;
      continue;
    }

    if (html[start + 1] === '!' || html[start + 1] === '?') {
      const end = findTagEnd(html, start + 2);
      if (end === -1) {
        errors.push(`${label}: unterminated markup declaration`);
        return tags;
      }
      index = end + 1;
      continue;
    }

    let cursor = start + 1;
    const closing = html[cursor] === '/';
    if (closing) cursor += 1;

    const nameStart = cursor;
    while (cursor < html.length && /[A-Za-z0-9:-]/.test(html[cursor])) cursor += 1;
    const rawName = html.slice(nameStart, cursor);

    if (!rawName) {
      index = start + 1;
      continue;
    }

    const end = findTagEnd(html, cursor);
    if (end === -1) {
      errors.push(`${label}: unterminated <${rawName}> tag`);
      return tags;
    }

    const tagName = rawName.toLowerCase();
    if (!closing) {
      tags.push({
        name: tagName,
        attributes: parseAttributes(html.slice(start, end + 1)),
      });
    }

    index = end + 1;

    if (!closing && (tagName === 'script' || tagName === 'style')) {
      const closeStart = findRawTextClose(html, index, tagName);
      if (closeStart === -1) {
        errors.push(`${label}: unterminated <${tagName}> element`);
        return tags;
      }
      index = closeStart;
    }
  }

  return tags;
}

function extractHead(html) {
  const open = /<head\b/i.exec(html);
  if (!open) return null;

  const openEnd = findTagEnd(html, open.index + open[0].length);
  if (openEnd === -1) return null;

  const close = html.toLowerCase().indexOf('</head', openEnd + 1);
  if (close === -1) return null;

  return html.slice(openEnd + 1, close);
}

function isWellFormedSource(source) {
  if (/^'(?:self|none|unsafe-inline|unsafe-eval|strict-dynamic|wasm-unsafe-eval|report-sample|unsafe-hashes|inline-speculation-rules)'$/i.test(source)) {
    return true;
  }

  if (/^'(?:nonce|sha256|sha384|sha512)-[A-Za-z0-9+/_-]+={0,2}'$/i.test(source)) return true;
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return true;
  if (source === '*') return true;
  if (/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d+)?(?:\/[\x21-\x7e]*)?$/i.test(source)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d+)?(?:\/[\x21-\x7e]*)?$/i.test(source)) {
    return true;
  }

  return false;
}

function parseCsp(value, label, errors) {
  const directives = new Map();

  for (const rawPart of value.split(';')) {
    const part = rawPart.trim();
    if (!part) continue;

    const tokens = part.split(/\s+/);
    const name = tokens.shift().toLowerCase();

    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      errors.push(`${label}: malformed CSP directive name "${name}"`);
      continue;
    }

    if (directives.has(name)) {
      errors.push(`${label}: duplicate ${name} CSP directive`);
      continue;
    }

    if (tokens.length === 0) {
      errors.push(`${label}: ${name} CSP directive has no source expressions`);
      continue;
    }

    for (const token of tokens) {
      if (!isWellFormedSource(token)) {
        errors.push(`${label}: malformed CSP source expression "${token}" in ${name}`);
      }
    }

    directives.set(name, tokens);
  }

  return directives;
}

function normalizeSources(sources) {
  return sources.map((source) => source.toLowerCase()).sort();
}

function compareCsp(directives, label, errors) {
  for (const name of directives.keys()) {
    if (!Object.prototype.hasOwnProperty.call(EXPECTED_CSP, name)) {
      errors.push(`${label}: unexpected ${name} CSP directive`);
    }
  }

  for (const [name, expectedSources] of Object.entries(EXPECTED_CSP)) {
    if (!directives.has(name)) {
      errors.push(`${label}: missing ${name} CSP directive`);
      continue;
    }

    const actual = normalizeSources(directives.get(name));
    const expected = normalizeSources(expectedSources);

    if (actual.length !== expected.length || actual.some((source, index) => source !== expected[index])) {
      errors.push(`${label}: ${name} must be exactly "${expectedSources.join(' ')}"`);
    }
  }
}

function isCspMeta(tag) {
  return (tag.attributes.get('http-equiv') || '').toLowerCase() === 'content-security-policy';
}

function checkCsp(tags, headTags, label, errors) {
  const cspTags = tags.filter(isCspMeta);
  const headCspTags = headTags.filter(isCspMeta);

  if (cspTags.length !== 1) {
    errors.push(`${label}: expected exactly one Content-Security-Policy meta tag`);
    return;
  }

  if (headCspTags.length !== 1) {
    errors.push(`${label}: Content-Security-Policy meta tag must appear exactly once in the head`);
    return;
  }

  const content = cspTags[0].attributes.get('content');
  if (!content || !content.trim()) {
    errors.push(`${label}: Content-Security-Policy content is missing or empty`);
    return;
  }

  compareCsp(parseCsp(content, label, errors), label, errors);
}

function checkIndex(errors) {
  const html = read(INDEX_PATH);
  if (html === null) {
    errors.push('index.html: file is missing');
    return;
  }

  const tags = scanTags(html, 'index.html', errors);
  const head = extractHead(html);
  if (!head) {
    errors.push('index.html: head element is missing');
    return;
  }

  const headTags = scanTags(head, 'index.html head', errors);
  const allMetaTags = tags.filter((tag) => tag.name === 'meta');
  const headMetaTags = headTags.filter((tag) => tag.name === 'meta');

  for (const name of [SUPABASE_URL_META, SUPABASE_KEY_META]) {
    const matches = allMetaTags.filter((tag) => (tag.attributes.get('name') || '').toLowerCase() === name);
    const headMatches = headMetaTags.filter((tag) => (tag.attributes.get('name') || '').toLowerCase() === name);

    if (matches.length !== 1) {
      errors.push(`index.html: expected exactly one meta[name="${name}"]`);
      continue;
    }

    if (headMatches.length !== 1) {
      errors.push(`index.html: meta[name="${name}"] must appear exactly once in the head`);
    }

    if (matches[0].attributes.get('content') !== '') {
      errors.push(`index.html: meta[name="${name}"] must have an empty content attribute`);
    }
  }

  for (const tag of allMetaTags) {
    const name = (tag.attributes.get('name') || '').toLowerCase();
    if (name && AUTH_MARKER.test(name) && name !== SUPABASE_URL_META && name !== SUPABASE_KEY_META) {
      errors.push(`index.html: unexpected auth configuration meta[name="${name}"]`);
    }
  }

  checkCsp(tags, headTags, 'index.html', errors);
}

function checkOffline(errors) {
  const html = read(OFFLINE_PATH);
  if (html === null) {
    errors.push('offline.html: file is missing');
    return;
  }

  const tags = scanTags(html, 'offline.html', errors);
  const head = extractHead(html);
  if (!head) {
    errors.push('offline.html: head element is missing');
    return;
  }

  const headTags = scanTags(head, 'offline.html head', errors);

  for (const tag of tags) {
    const name = (tag.attributes.get('name') || '').toLowerCase();

    if (tag.name === 'meta' && name && AUTH_MARKER.test(name)) {
      errors.push(`offline.html: unexpected auth configuration meta[name="${name}"]`);
    }

    for (const [attribute, value] of tag.attributes) {
      if (/^on[a-z]+$/.test(attribute)) {
        errors.push(`offline.html: inline event handler "${attribute}" is not allowed`);
      }

      if (/^\s*javascript:/i.test(value)) {
        errors.push('offline.html: javascript: URLs are not allowed');
      }

      if (/^data-/i.test(attribute) && AUTH_MARKER.test(`${attribute} ${value}`)) {
        errors.push(`offline.html: unexpected auth configuration attribute "${attribute}"`);
      }

      if ((attribute === 'id' || attribute === 'name') && tag.name !== 'meta' && AUTH_MARKER.test(value)) {
        errors.push(`offline.html: unexpected auth configuration ${attribute}="${value}"`);
      }

      if ((attribute === 'href' || attribute === 'src' || attribute === 'action') && AUTH_MARKER.test(value)) {
        errors.push(`offline.html: unexpected auth-related resource "${value}"`);
      }
    }
  }

  for (const script of tags.filter((tag) => tag.name === 'script')) {
    const src = (script.attributes.get('src') || '').trim();
    if (!src) {
      errors.push('offline.html: inline scripts are not allowed');
    } else {
      errors.push('offline.html: script elements are not allowed in the offline page');
    }
  }

  checkCsp(tags, headTags, 'offline.html', errors);
}

const errors = [];
checkIndex(errors);
checkOffline(errors);

if (errors.length > 0) {
  console.error('Auth-disabled release policy failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Auth-disabled release policy: PASS');
console.log("  index.html: both Supabase meta tags are empty and the full CSP matches the approved baseline.");
console.log("  offline.html: no auth configuration, no scripts, and the full CSP matches the approved baseline.");
