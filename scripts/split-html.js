/**
 * 拆分 index.html — 提取 CSS → style.css, JS → app.js
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'static', 'index.html');
const cssPath = path.join(__dirname, '..', 'static', 'style.css');
const jsPath = path.join(__dirname, '..', 'static', 'app.js');

let html = fs.readFileSync(htmlPath, 'utf-8');

// === Extract CSS ===
// First style block (lines 9-997)
const cssMatch1 = html.match(/<style>([\s\S]*?)<\/style>/);
// Second style block (lines 998-1143)
const restAfterFirst = html.replace(cssMatch1[0], '<!--CSS1-->');
const cssMatch2 = restAfterFirst.match(/<style>([\s\S]*?)<\/style>/);

const fullCSS = (cssMatch1[1] + '\n' + cssMatch2[1]).trim();
fs.writeFileSync(cssPath, fullCSS, 'utf-8');
console.log(`  📝 Extracted CSS: ${fullCSS.split('\n').length} lines → static/style.css`);

// === Extract main JS ===
// Find the LAST <script> block that is NOT from CDN
const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const lastScript = scriptMatches[scriptMatches.length - 1];
const mainJS = lastScript[1].trim();
fs.writeFileSync(jsPath, mainJS, 'utf-8');
console.log(`  📝 Extracted JS: ${mainJS.split('\n').length} lines → static/app.js`);

// === Rewrite index.html ===
// Remove CSS blocks
html = html.replace(cssMatch1[0], '');
html = html.replace(cssMatch2[0], '');

// Insert CSS link after <title>
html = html.replace('</title>', '</title>\n<link rel="stylesheet" href="/static/style.css">');

// Remove main inline script
html = html.replace(lastScript[0], '');

// Add app.js script after ai.js
html = html.replace(
  '<script src="/static/ai.js"></script>',
  '<script src="/static/ai.js"></script>\n<script src="/static/app.js"></script>'
);

// Clean up empty lines
html = html.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(htmlPath, html, 'utf-8');
console.log(`  📝 Updated index.html (removed inline CSS/JS, added external references)`);

// Verify
const newLines = html.split('\n').length;
console.log(`  📏 index.html: ${newLines} lines (was 2488)`);
