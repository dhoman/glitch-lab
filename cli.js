#!/usr/bin/env node
const { parseArgs } = require('node:util');
const { spawn } = require('node:child_process');
const { createLab } = require('./lab');
const { start } = require('./server');
const help = `Glitch lab CLI

  npm run glitch -- [files or folders...] [options]
  npm start                                      Open the local studio

  --input PATH          File or directory; repeatable
  --count N             Variations per image (default 10)
  --recursive           Scan subfolders
  --amount N[:N]        Byte value, 0..100 (default 10:60)
  --iterations N[:N]    Byte writes, 1..10000 (default 5:35)
  --quality N[:N]       JPEG quality, 1..100 (default 10:60)
  --seed N[:N]          Byte positions, 0..100 (default 0:100)
  --random-seed TEXT    Reproduce the random parameter choices
  --max-width N        Resize without upscaling (default original width)
  --format png|jpg     Output format (default png)
  --open               Start local helper and open the batch gallery
  --help               Show this help

Defaults to images/. Results go under generatedimages/<source>/<batch>/.
Use the studio's Save favorite button to move an image and recipe into favorites/
and stage them in Git. No commits are created automatically.
`;
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string', multiple: true }, count: { type: 'string' }, recursive: { type: 'boolean' },
    amount: { type: 'string' }, iterations: { type: 'string' }, quality: { type: 'string' }, seed: { type: 'string' },
    'random-seed': { type: 'string' }, 'max-width': { type: 'string' }, format: { type: 'string' },
    open: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) return console.log(help);
  const lab = createLab(__dirname);
  await lab.init();
  const inputs = [...(values.input || []), ...positionals];
  const files = await lab.collect(inputs.length ? inputs : [lab.images], values.recursive);
  if (!files.length) throw new Error('No images found. Add files to images/ or supply paths.');
  const result = await lab.generate(files, { ...values, randomSeed: values['random-seed'], maxWidth: values['max-width'] }, progress => {
    process.stdout.write(`\r${progress.completed}/${progress.total} generated · ${progress.failed} failed`);
  });
  console.log(`\nRandom seed: ${result.seed}`);
  for (const id of result.batches) console.log(`generatedimages/${id}/index.html`);
  if (result.failed) process.exitCode = 1;
  if (values.open) {
    let url;
    try { ({ url } = await start()); }
    catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      url = `http://127.0.0.1:${process.env.PORT || 4177}`;
    }
    const destination = `${url}/generatedimages/${result.batches[0]}/index.html`;
    console.log(`Open ${destination}\nIf this command started the helper, press Ctrl+C to stop it.`);
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    const child = spawn(command, [destination], { detached: true, stdio: 'ignore' });
    child.on('error', error => console.error(error.message));
    child.unref();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
