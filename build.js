// Copy only public website files. No transpiler, framework or dependencies.
const fs = require('node:fs');
const path = require('node:path');
const files = ['index.html', 'styles.css', 'data.js', 'events-api.js', 'script.js'];
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
for (const file of files) fs.copyFileSync(path.join(__dirname, file), path.join(__dirname, 'dist', file));
console.log(`Built ${files.length} static files in dist/`);
