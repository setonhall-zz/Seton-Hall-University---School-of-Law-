// Turns the single-file build into a body fragment (title, styles, markup,
// script) for hosts that wrap the page in their own document skeleton.
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const grab = re => [...html.matchAll(re)].map(m => m[0]).join('\n');
const out = [
  grab(/<title>[\s\S]*?<\/title>/g),
  grab(/<meta name="claude:[^>]*>/g),
  grab(/<link rel="stylesheet"[^>]*>/g),
  grab(/<style[\s\S]*?<\/style>/g),
  '<div id="root"></div>',
  grab(/<script[\s\S]*?<\/script>/g),
].join('\n');
writeFileSync('dist/elsewhere.html', out);
console.log('dist/elsewhere.html', (out.length / 1024).toFixed(0) + ' kB');
