const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { createLab, options } = require('./lab');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };
async function body(request, limit) {
  const parts = []; let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > limit) throw new Error('Upload is too large');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
async function start(root = __dirname, port = Number(process.env.PORT || 4177)) {
  const lab = createLab(root);
  await lab.refresh();
  let job = null;
  let saving = false;
  const server = http.createServer(async (request, response) => {
    const reply = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== host && request.headers.host !== `localhost:${server.address().port}`) return reply(403, { error: 'Local requests only' });
      const url = new URL(request.url, `http://${host}`);
      if (request.method === 'POST') {
        if (request.headers['x-glitch-lab'] !== '1' || (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)) return reply(403, { error: 'Use the local Glitch lab page' });
        if (url.pathname === '/api/import') {
          const file = await lab.importImage(url.searchParams.get('name') || '', await body(request, 100 * 1024 * 1024));
          return reply(200, { file });
        }
        const data = JSON.parse((await body(request, 1024 * 1024)).toString());
        if (url.pathname === '/api/generate') {
          if (job?.state === 'running' || saving) return reply(409, { error: 'Another operation is running' });
          options(data.settings);
          if (!Array.isArray(data.images) || !data.images.length) throw new Error('Select at least one image');
          const files = await Promise.all(data.images.map(id => lab.inside(lab.images, id)));
          // Recheck after asynchronous path validation so two requests cannot start together.
          if (job?.state === 'running' || saving) return reply(409, { error: 'Another operation is running' });
          job = { state: 'running', completed: 0, total: files.length * Number(data.settings?.count || 10), failed: 0 };
          lab.generate(files, data.settings, progress => Object.assign(job, progress))
            .then(result => Object.assign(job, { state: 'done', ...result }))
            .catch(error => Object.assign(job, { state: 'error', error: error.message }));
          return reply(202, job);
        }
        if (url.pathname === '/api/favorite') {
          if (saving || job?.state === 'running') return reply(409, { error: 'Wait for the current operation to finish' });
          saving = true;
          try { return reply(200, await lab.favorite(data.batch, data.index)); }
          finally { saving = false; }
        }
        return reply(404, { error: 'Unknown operation' });
      }
      if (request.method !== 'GET') return reply(405, { error: 'Method not allowed' });
      if (url.pathname === '/api/catalog') return reply(200, { images: await lab.listImages(), batches: await lab.batches(), favorites: await lab.listFavorites() });
      if (url.pathname === '/api/job') return reply(200, job || { state: 'idle' });
      const requested = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const thumbnail = requested.startsWith('thumb/');
      const relative = thumbnail ? requested.slice(6) : requested;
      let file;
      const section = relative.split('/')[0];
      if (['generatedimages', 'favorites', 'images'].includes(section)) {
        file = await lab.inside(path.join(root, section), relative.slice(section.length + 1));
        if (!/\.(html|json|png|jpe?g|webp|avif|tiff?|gif)$/i.test(file)) throw new Error('File type not served');
      } else if (['index.html', 'batches.html', 'style.css', 'app.js', 'gallery.js'].includes(relative)) file = path.join(root, 'public', relative);
      else return reply(404, { error: 'Page not found' });
      if (thumbnail) {
        const buffer = await sharp(file, { failOn: 'none' }).rotate().resize({ width: 640, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
        response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
        return response.end(buffer);
      }
      const buffer = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(buffer);
    } catch (error) { reply(error.code === 'ENOENT' ? 404 : 400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, lab, url: `http://127.0.0.1:${server.address().port}` };
}
if (require.main === module) start().then(({ url }) => {
  console.log(`Glitch lab: ${url}\nPress Ctrl+C to stop.`);
  if (process.argv.includes('--open')) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
  }
}).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { start };
