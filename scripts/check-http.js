const fs = require('fs');

const files = [
  'static/index.html', 'static/ai.js', 'static/app.js',
  'static/style.css', 'server.js'
];

for (const f of files) {
  try {
    const c = fs.readFileSync(f, 'utf-8');
    const re = /http:\/\/[^\s"'<>)\]]+/g;
    const matches = c.match(re);
    if (matches && matches.length > 0) {
      console.log(f + ':');
      matches.forEach(m => console.log('  - ' + m));
    } else {
      console.log(f + ': \u2713 no http://');
    }
  } catch(e) {
    console.error(f, e.message);
  }
}

// SVG file
const svg = fs.readdirSync('.').find(f => f.endsWith('.svg'));
if (svg) {
  const c = fs.readFileSync(svg, 'utf-8');
  const matches = c.match(/http:\/\/[^\s"'<>)\]]+/g);
  if (matches && matches.length > 0) {
    console.log(svg + ':');
    matches.forEach(m => console.log('  - ' + m));
  } else {
    console.log(svg + ': \u2713 no http://');
  }
}
