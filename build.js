// Inlines core.js and the trained weights into a single self-contained page: index.html
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = read('template.html')
  .replace('/*__CORE__*/', () => read('core.js'))
  .replace('/*__WEIGHTS__*/', () => read('weights.json'));
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('index.html', (html.length / 1024).toFixed(0) + ' KB');
