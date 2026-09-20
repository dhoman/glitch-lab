const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const sharp = require('sharp');
const { glitchBytes } = require('./glitch');
const views = require('./views');
const supported = /\.(jpe?g|png|webp|avif|tiff?|gif)$/i;
const hash = value => createHash('sha256').update(value).digest('hex');
const safeName = value => path.basename(value).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'image';

function integer(value, name, min, max) {
  if (value === '' || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return Number(value);
}
function range(value, name, min, max) {
  const parts = String(value).split(':');
  if (parts.length > 2 || parts.some(p => !/^\d+$/.test(p))) throw new Error(`Invalid ${name}: ${value}`);
  const low = integer(parts[0], name, min, max);
  const high = integer(parts[1] ?? parts[0], name, min, max);
  if (high < low) throw new Error(`${name} maximum must be at least its minimum`);
  return [low, high];
}
function options(values = {}) {
  const format = values.format ?? 'png';
  if (!['png', 'jpg'].includes(format)) throw new Error('format must be png or jpg');
  return {
    count: integer(values.count ?? 10, 'count', 1, 10000),
    maxWidth: values.maxWidth ? integer(values.maxWidth, 'max-width', 1, 100000) : undefined,
    format,
    batchSeed: String(values.randomSeed || randomBytes(8).toString('hex')),
    ranges: {
      amount: range(values.amount ?? '10:60', 'amount', 0, 100),
      iterations: range(values.iterations ?? '5:35', 'iterations', 1, 10000),
      quality: range(values.quality ?? '10:60', 'quality', 1, 100),
      seed: range(values.seed ?? '0:100', 'seed', 0, 100),
    },
  };
}
function random(seed) {
  let state = Buffer.from(hash(seed), 'hex').readUInt32LE();
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
async function json(file, value) {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temporary, file);
}
async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function directories(folder) {
  return (await fs.readdir(folder, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
}

function createLab(root) {
  const images = path.join(root, 'images');
  const generated = path.join(root, 'generatedimages');
  const favorites = path.join(root, 'favorites');
  async function init() {
    await Promise.all([images, generated, favorites].map(dir => fs.mkdir(dir, { recursive: true })));
  }
  // All browser-provided paths must resolve within a specific lab directory.
  async function inside(base, relative) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Invalid relative path');
    const target = await fs.realpath(path.resolve(base, relative));
    const realBase = await fs.realpath(base);
    if (!target.startsWith(realBase + path.sep)) throw new Error('Path is outside the allowed folder');
    return target;
  }
  async function collect(inputs, recursive = false) {
    const result = new Set();
    const excluded = await Promise.all([generated, favorites].map(dir => fs.realpath(dir)));
    async function visit(input, explicit = false) {
      const file = await fs.realpath(input);
      if (excluded.some(dir => file === dir || file.startsWith(dir + path.sep))) return;
      const stat = await fs.stat(file);
      if (stat.isFile()) {
        if (supported.test(file)) result.add(file);
        else if (explicit) throw new Error(`Unsupported image: ${file}`);
      } else if (stat.isDirectory()) {
        for (const entry of await fs.readdir(file, { withFileTypes: true })) {
          if (entry.isFile() || (recursive && entry.isDirectory())) await visit(path.join(file, entry.name));
        }
      }
    }
    for (const input of inputs) await visit(input, true);
    return [...result].sort();
  }
  async function importImage(name, buffer) {
    if (!supported.test(name)) throw new Error('Unsupported image extension');
    await sharp(buffer).metadata();
    const file = `${hash(buffer).slice(0, 12)}-${safeName(name)}`;
    try { await fs.writeFile(path.join(images, file), buffer, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return file;
  }
  async function listImages() {
    return (await collect([images], true)).map(file => ({ id: path.relative(images, file).split(path.sep).join('/'), name: path.basename(file) }));
  }
  async function batches() {
    const result = [];
    for (const source of await directories(generated)) {
      for (const batch of await directories(path.join(generated, source))) {
        const id = `${source}/${batch}`;
        const manifestPath = path.join(generated, id, 'manifest.json');
        try {
          const manifest = await readJson(manifestPath);
          const stat = await fs.stat(manifestPath);
          result.push({ id, createdAt: manifest.createdAt || stat.birthtime.toISOString(), ...manifest });
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function listFavorites() {
    const result = [];
    for (const id of await directories(favorites)) {
      try { result.push({ id, ...await readJson(path.join(favorites, id, 'metadata.json')) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async function renderBatch(batch) {
    await fs.writeFile(path.join(generated, batch.id, 'index.html'), views.batch(batch));
  }
  async function refresh() {
    await init();
    for (const batch of await batches()) await renderBatch(batch);
    await fs.writeFile(path.join(favorites, 'index.html'), views.favorites(await listFavorites()));
  }
  async function generate(files, settings, progress = () => {}) {
    if (!files.length) throw new Error('Select at least one image');
    const config = options(settings);
    const results = [];
    let completed = 0;
    let failed = 0;
    for (const file of files) {
      const source = await fs.readFile(file);
      const sourceHash = hash(source);
      const next = random(`${config.batchSeed}:${sourceHash}`);
      const parent = path.join(generated, `${safeName(file)}-${sourceHash.slice(0, 10)}`);
      await fs.mkdir(parent, { recursive: true });
      const dir = await fs.mkdtemp(path.join(parent, 'batch-'));
      const id = path.relative(generated, dir).split(path.sep).join('/');
      const manifest = { source: path.basename(file), sourceHash, createdAt: new Date().toISOString(), ...config, sharpVersions: sharp.versions, records: [] };
      for (let index = 1; index <= config.count; index++) {
        const params = Object.fromEntries(Object.entries(config.ranges).map(([key, [low, high]]) => [key, Math.round(low + next() * (high - low))]));
        const record = { index, params, file: `${String(index).padStart(4, '0')}.${config.format}` };
        try {
          let image = sharp(source).rotate().flatten({ background: '#fff' });
          if (config.maxWidth) image = image.resize({ width: config.maxWidth, withoutEnlargement: true });
          const jpeg = await image.jpeg({ quality: params.quality, progressive: false }).toBuffer();
          const corrupted = glitchBytes(jpeg, params);
          const png = await sharp(corrupted, { failOn: 'none' }).png().toBuffer();
          await fs.writeFile(path.join(dir, record.file), config.format === 'png' ? png : corrupted, { flag: 'wx' });
        } catch (error) { record.error = error.message; failed++; }
        manifest.records.push(record);
        completed++;
        progress({ completed, total: files.length * config.count, failed, source: manifest.source });
      }
      await json(path.join(dir, 'manifest.json'), manifest);
      await renderBatch({ id, ...manifest });
      results.push(id);
    }
    return { batches: results, failed, seed: config.batchSeed };
  }
  async function favorite(batchId, index) {
    const dir = await inside(generated, batchId);
    const manifest = await readJson(path.join(dir, 'manifest.json'));
    const record = manifest.records.find(r => r.index === Number(index));
    if (!record || record.error) throw new Error('Image does not exist in this batch');
    const id = hash(`${batchId}:${record.file}`).slice(0, 24);
    const destination = path.join(favorites, id);
    await fs.mkdir(destination, { recursive: true });
    const metadataPath = path.join(destination, 'metadata.json');
    const imagePath = path.join(destination, path.basename(record.file));
    if (!record.favorite) {
      const metadata = {
        file: path.basename(record.file), source: path.basename(manifest.source), sourceHash: manifest.sourceHash,
        batch: batchId, index: record.index, params: record.params, batchSeed: manifest.batchSeed,
        maxWidth: manifest.maxWidth, format: manifest.format, sharpVersions: manifest.sharpVersions,
        savedAt: new Date().toISOString(),
      };
      await json(metadataPath, metadata);
      try { await fs.rename(await inside(dir, record.file), imagePath); }
      catch (error) {
        // Recover a move that finished before a previous manifest write was interrupted.
        if (error.code !== 'ENOENT') throw error;
        await fs.access(imagePath);
      }
      record.favorite = `${id}/${path.basename(record.file)}`;
      await json(path.join(dir, 'manifest.json'), manifest);
    }
    await renderBatch({ id: batchId, ...manifest });
    await fs.writeFile(path.join(favorites, 'index.html'), views.favorites(await listFavorites()));
    return { id };
  }
  return { root, images, generated, favorites, init, inside, collect, importImage, listImages, batches, listFavorites, refresh, generate, favorite };
}
module.exports = { createLab, options, supported };
