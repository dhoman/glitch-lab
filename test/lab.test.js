const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const sharp = require('sharp');
const { createLab, options } = require('../lab');
const { glitchBytes } = require('../glitch');
const views = require('../views');
const { start } = require('../server');
const exec = promisify(execFile);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glitch-lab-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const lab = createLab(root);
  await lab.init();
  await exec('git', ['init', '-q', root]);
  await fs.writeFile(path.join(root, '.gitignore'), 'images/\ngeneratedimages/\nfavorites/\n');
  const buffer = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#91a47f' } }).png().toBuffer();
  const id = await lab.importImage('photo.png', buffer);
  return { root, lab, buffer, id };
}

test('byte algorithm matches original worker for 45 parameter combinations', async () => {
  let workerSource;
  const context = { Image: function () {}, Blob: function (parts) { workerSource = parts.join(''); }, URL: { createObjectURL() {} }, Worker: function () {}, setTimeout, Promise };
  vm.createContext(context);
  vm.runInContext(await fs.readFile(path.join(__dirname, 'fixtures/glitch-canvas.js'), 'utf8'), context);
  context.glitch({});
  const worker = { self: {} };
  vm.createContext(worker);
  vm.runInContext(workerSource, worker);
  for (const amount of [0, 10, 35, 60, 100]) for (const seed of [0, 25, 100]) for (const iterations of [1, 20, 10000]) {
    const bytes = Buffer.alloc(2000, 100);
    bytes[400] = 255; bytes[401] = 218;
    const before = Buffer.from(bytes);
    assert.deepEqual(glitchBytes(bytes, { amount, seed, iterations }), Buffer.from(worker.glitchByteArray(Array.from(bytes), seed, amount, iterations)));
    assert.deepEqual(bytes, before);
  }
});

test('generation is reproducible; favorite moves image, retains recipe, and stages nothing in Git', async t => {
  const { root, lab, id, buffer } = await fixture(t);
  const input = await lab.inside(lab.images, id);
  const settings = { count: 2, iterations: 1, seed: 80, amount: 20, randomSeed: 'repeat', maxWidth: 80 };
  const first = await lab.generate([input], settings);
  const second = await lab.generate([input], settings);
  assert.equal(first.failed, 0);
  const image = path.join(lab.generated, first.batches[0], '0001.png');
  const bytes = await fs.readFile(image);
  assert.deepEqual(bytes, await fs.readFile(path.join(lab.generated, second.batches[0], '0001.png')));
  assert.equal((await sharp(bytes).metadata()).width, 80);
  const before = (await lab.batches()).find(b => b.id === first.batches[0]);
  const result = await lab.favorite(first.batches[0], 1);
  await assert.rejects(fs.access(image), { code: 'ENOENT' });
  const favorites = await lab.listFavorites();
  assert.equal(favorites.length, 1);
  assert.deepEqual(favorites[0].params, before.records[0].params);
  assert.equal(favorites[0].batchSeed, 'repeat');
  assert.equal(favorites[0].maxWidth, 80);
  assert.deepEqual(bytes, await fs.readFile(path.join(lab.favorites, result.id, '0001.png')));
  assert.deepEqual(await fs.readFile(input), buffer);
  assert.equal((await lab.favorite(first.batches[0], 1)).id, result.id);
  assert.equal((await exec('git', ['diff', '--cached', '--name-only'], { cwd: root })).stdout, '');
  const html = await fs.readFile(path.join(lab.generated, first.batches[0], 'index.html'), 'utf8');
  assert(html.includes(`favorites/${result.id}/0001.png`));
  const suffix = first.batches[0].split('/').pop().replace(/^batch-/, '');
  assert(html.includes(`download="photo-${suffix}-0001.png"`), 'batch downloads carry source and batch');
  assert(html.includes(`download="photo-${suffix}-0002.png"`));
  assert.equal(views.downloadName('my photo.jpeg', 'x/batch-abc', '0003.jpg'), 'my_photo-abc-0003.jpg');
  assert.equal(views.downloadName('0123456789ab-IMG_1.HEIC', 'x/batch-Zz9', '0001.png'), 'IMG_1-Zz9-0001.png');
  await fs.rm(path.join(lab.generated, first.batches[0]), { recursive: true });
  await lab.refresh();
  assert.equal((await lab.listFavorites()).length, 1);
  const favoritesHtml = await fs.readFile(path.join(lab.favorites, 'index.html'), 'utf8');
  assert(favoritesHtml.includes(`${result.id}/metadata.json`));
  assert(favoritesHtml.includes(`download="photo-${suffix}-0001.png"`), 'favorite downloads keep the batch name');
});

test('invalid controls and paths rejected; inputs, outputs, and favorites ignored', async t => {
  const { root, lab, id } = await fixture(t);
  assert.throws(() => options({ iterations: '35:5' }), /maximum/);
  assert.throws(() => options({ count: 0 }), /count/);
  assert.throws(() => options({ quality: 101 }), /quality/);
  await assert.rejects(lab.inside(lab.images, '../.gitignore'), /outside/);
  await fs.symlink(path.join(root, '.gitignore'), path.join(lab.images, 'outside.png'));
  await assert.rejects(lab.inside(lab.images, 'outside.png'), /outside/);
  const ignored = (await exec('git', ['check-ignore', `images/${id}`, 'generatedimages/example.png', 'favorites/example/0001.png'], { cwd: root })).stdout;
  assert(ignored.includes('generatedimages/example.png'));
  assert(ignored.includes('favorites/example/0001.png'));
});

test('local API imports, generates, favorites; blocks cross-origin writes and private files', async t => {
  const { root, buffer } = await fixture(t);
  await fs.cp(path.join(__dirname, '../public'), path.join(root, 'public'), { recursive: true });
  const { server, url } = await start(root, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (route, data) => fetch(url + route, { method: 'POST', headers: { 'X-Glitch-Lab': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url + '/.git/config')).status, 404);
  assert.equal((await fetch(url + '/api/import?name=test.png', { method: 'POST', body: buffer })).status, 403);
  assert.equal((await fetch(url + '/api/import?name=test.png', { method: 'POST', headers: { 'X-Glitch-Lab': '1', Origin: 'https://example.com' }, body: buffer })).status, 403);
  const imported = await (await fetch(url + '/api/import?name=test.png', { method: 'POST', headers: { 'X-Glitch-Lab': '1' }, body: buffer })).json();
  assert(imported.file);
  assert.equal((await post('/api/generate', { images: [imported.file], settings: { count: 1, iterations: 1, seed: 80, amount: 20 } })).status, 202);
  let job;
  for (let i = 0; i < 100; i++) {
    job = await (await fetch(url + '/api/job')).json();
    if (job.state !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(job.state, 'done');
  assert.equal(job.failed, 0);
  const favorite = await (await post('/api/favorite', { batch: job.batches[0], index: 1 })).json();
  assert(favorite.id);
  assert.equal((await fetch(`${url}/thumb/favorites/${favorite.id}/0001.png`)).status, 200);
  const catalog = await (await fetch(url + '/api/catalog')).json();
  assert.equal(catalog.favorites.length, 1);
});
