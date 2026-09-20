# Glitch lab

A local image studio for JPEG glitch experiments. Choose images or a folder, adjust
parameters, browse batches, and save favorites with their recipes in Git.

## Start

```sh
cd ~/Source/glitch-lab
npm install
npm start
```

Requires Node 22 or newer and Git. The browser opens at `http://127.0.0.1:4177`.
Stop with Ctrl+C. Use `PORT=4180 npm start` to choose another port, or `npm run serve`
to start without opening a browser.

The interface is plain HTML, CSS, and JavaScript. A small Node helper handles local
files, Sharp image processing, and Git staging. It listens on loopback only. Nothing
is hosted or deployed. Open the localhost URL while the helper is running.

## Use the studio

1. On Create, pick images or a folder. Files are copied into `images/`; originals
   stay untouched. You can also put files directly in `images/` and refresh.
2. Select library images. Each control offers a random min/max range or a fixed value.
3. Choose the variation count, maximum width, output format, and optional random seed.
   The UI starts at 1600px to keep exploration quick; clear the width for full size.
4. Generate, then open a batch. Click an image for a large preview with parameters,
   Save favorite, and Download. Browse with Previous/Next or the arrow keys; close
   with Escape or Close. The same preview works on the Favorites page.
5. Choose **Save favorite**. The image moves to `favorites/<id>/`, accompanied by
   `metadata.json`. Both files are staged with `git add`. Saving does not commit or push.
6. Use Create, Batches, and Favorites in the navigation to move around.

The batch keeps a link to a moved favorite. Favorites show the same four glitch
parameters plus the random seed and width, and link to their full recipe. A favorite
survives deletion of its original batch; its Batch link needs that local batch to exist.
Repeated saves are safe. If Git staging fails, the favorite remains saved and the UI
explains how to retry. Downloads alone do not create favorites or stage files.

## Repository layout

```text
images/                            ignored originals/imports
generatedimages/                   ignored experiments
  <source name>-<content hash>/
    batch-<unique suffix>/
      0001.png
      index.html
      manifest.json
favorites/                         images and recipes included in Git
  <favorite id>/
    0001.png
    metadata.json
  index.html                       ignored; regenerated on startup/save
public/                            HTML, CSS, browser JavaScript
```

Input and batch folders are created on startup and ignored by default. Source
names plus content hashes prevent collisions. Favorite IDs distinguish batches
and variations. The generated Favorites index is rebuilt from metadata, including
after cloning the repository. Review and commit your staged favorites normally:

```sh
git status
git commit -m "Save favorite glitches"
```

## CLI

```sh
# All top-level images in images/
npm run glitch -- --count 20

# One image or several folders
npm run glitch -- ~/Pictures/photo.jpg --count 30 --open
npm run glitch -- --input ~/Pictures/trip --input ./images --recursive

# Fixed values and random ranges
npm run glitch -- --amount 40 --iterations 5:25 --quality 30 --max-width 1200

# Reproduce a batch's random choices
npm run glitch -- --random-seed favorites-1 --count 20
npm run glitch -- --help
```

| Control | Meaning | Default |
| --- | --- | --- |
| `amount` | Value written into changed bytes; not a linear strength slider | `10:60` |
| `iterations` | Number of byte writes | `5:35` |
| `quality` | JPEG quality before corruption | `10:60` |
| `seed` | Byte position within each segment | `0:100` |
| `random-seed` | Text that reproduces random choices for each source | Random and recorded |
| `max-width` | Resize wide images without upscaling | UI: 1600; CLI: original |
| `format` | PNG decoded glitch or corrupted JPEG bytes | `png` |

Amount and seed accept 0–100, quality 1–100, iterations 1–10000, and count 1–10000.
CLI ranges use `low:high`. Images are auto-oriented and transparency is flattened onto
white. JPEG, PNG, WebP, AVIF, TIFF, and GIF inputs are supported; animated images use
the first frame. Browser imports are limited to 100 MiB per image.

Reproduce a favorite using the same original contents, width, and encoder version,
with its fixed amount, iterations, quality, and seed values. For a batch, use the same
ranges, random seed, count, and original. Recipes record the original's SHA-256 hash
and Sharp versions. Originals are not included with favorites, so keep them locally
if you want to regenerate results.

Corruption can make a JPEG undecodable. Failed variations are recorded in the batch
manifest; successful images remain available. The CLI exits with status 1 for partial
failure. Try fewer iterations if necessary. JPEG viewers can interpret corruptions
differently; PNG preserves the decoded appearance.

## Algorithm and checks

`glitch.js` ports the byte-changing worker from the homan.io site's bundled
`glitch-canvas` script. Sharp replaces browser canvas encoding, so browser results
can differ. The original site triggers the effect on window blur, after the background
image loads. The fixture under `test/fixtures` preserves the original bundle for
compatibility checks.

```sh
npm test
```

Tests cover byte compatibility, reproducible generation, input isolation, image moves,
metadata preservation, Git staging, HTTP endpoints, and rejected cross-origin writes.
