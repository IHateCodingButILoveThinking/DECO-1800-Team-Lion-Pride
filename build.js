// Package plain browser files and a plain JavaScript Worker, with no transpilation.
const fs = require('node:fs');
const path = require('node:path');
const files = {'index.html':'text/html; charset=utf-8','styles.css':'text/css; charset=utf-8','events-api.js':'text/javascript; charset=utf-8','icons.js':'text/javascript; charset=utf-8','community.js':'text/javascript; charset=utf-8','script.js':'text/javascript; charset=utf-8','logo.png':'image/png'};
const assets={};
for(const [name,type] of Object.entries(files)){const binary=name.endsWith('.png');assets['/'+name]={type,binary,body:fs.readFileSync(path.join(__dirname,name),binary?'base64':'utf8')};}
fs.rmSync(path.join(__dirname,'dist'),{recursive:true,force:true});
fs.mkdirSync(path.join(__dirname,'dist/server'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'dist/server/index.js'),`const staticAssets=${JSON.stringify(assets)};\n`+fs.readFileSync(path.join(__dirname,'server/worker.js'),'utf8'));
console.log(`Built ${Object.keys(files).length} assets and the community API.`);
