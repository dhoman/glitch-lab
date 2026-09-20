const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const url = value => value.split('/').map(encodeURIComponent).join('/');
let catalog;
const selected = new Set();
let importing = false;
let generating = false;
let polling = false;
async function api(route, data) {
  const response = await fetch(route, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Glitch-Lab': '1' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function status(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}
function batchCards() {
  const filter = $('#batch-filter')?.value.toLowerCase() || '';
  let batches = catalog.batches.filter(batch => batch.source.toLowerCase().includes(filter));
  if (document.body.dataset.page === 'create') batches = batches.slice(0, 6);
  $('#batch-list').innerHTML = batches.length ? batches.map(batch => {
    const first = batch.records.find(record => !record.error);
    const image = first ? first.favorite ? `favorites/${url(first.favorite)}` : `generatedimages/${url(batch.id)}/${url(first.file)}` : null;
    return `<a class="image-card batch-link" href="generatedimages/${url(batch.id)}/index.html">${image ? `<img loading="lazy" src="thumb/${image}" alt="Preview of ${escape(batch.source.split('/').pop())}">` : ''}<div class="card-body"><div class="card-heading"><h2>${escape(batch.source.split('/').pop())}</h2><span class="tag">${batch.records.filter(r => !r.error).length} IMAGES</span></div><p class="small" style="margin:12px 0 0">${escape(new Date(batch.createdAt).toLocaleString())}<br>Seed <code>${escape(batch.batchSeed)}</code></p></div></a>`;
  }).join('') : '<div class="empty"><h2>No batches yet.</h2><p>Your next experiment starts on the Create page.</p></div>';
}
function selectedCount() { $('#selected-count').textContent = `${selected.size} selected / ${catalog.images.length} in library`; }
function renderLibrary() {
  $('#image-picker').innerHTML = catalog.images.length ? catalog.images.map(image => `<label class="pick-card"><input type="checkbox" value="${escape(image.id)}" ${selected.has(image.id) ? 'checked' : ''}><img loading="lazy" src="thumb/images/${url(image.id)}" alt=""><span title="${escape(image.name)}">${escape(image.name)}</span></label>`).join('') : '<p class="small">Your library is empty. Add a few images above, or put files in the images folder.</p>';
  $('#image-picker').onchange = event => { event.target.checked ? selected.add(event.target.value) : selected.delete(event.target.value); selectedCount(); };
  selectedCount();
}
async function refresh() {
  catalog = await api('/api/catalog');
  batchCards();
  if ($('#image-picker')) renderLibrary();
}
function busy() {
  if (!$('#generate')) return;
  $('#generate').disabled = generating || importing;
  $('#files').disabled = generating || importing;
  $('#folder').disabled = generating || importing;
}
async function importFiles(files) {
  importing = true; busy();
  const supported = [...files].filter(file => /\.(jpe?g|png|webp|avif|tiff?|gif)$/i.test(file.name));
  const errors = [];
  let complete = 0;
  for (const file of supported) {
    $('#import-status').textContent = `Importing ${++complete}/${supported.length}: ${file.name}`;
    try {
      const response = await fetch(`/api/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Glitch-Lab': '1' }, body: file });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      selected.add(result.file);
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  $('#import-status').textContent = `${supported.length - errors.length} images imported. ${files.length - supported.length} unsupported files skipped. ${errors.join(' ')}`;
  try { await refresh(); } catch (error) { status(error.message, true); }
  importing = false; busy();
}
async function poll() {
  if (polling) return;
  polling = true;
  try {
    while (true) {
      const job = await api('/api/job');
      generating = job.state === 'running'; busy();
      if (job.state === 'running') {
        $('#status').innerHTML = `<p>Generating ${job.completed} / ${job.total} · ${escape(job.source || 'Preparing images')} · ${job.failed} failed</p><progress max="${job.total}" value="${job.completed}"></progress>`;
        await new Promise(resolve => setTimeout(resolve, 700));
      } else {
        if (job.state === 'error') status(job.error, true);
        if (job.state === 'done') {
          $('#status').innerHTML = `<p>Batch complete. ${job.failed ? `${job.failed} variations could not be decoded; successful images were kept.` : 'All variations saved.'} Random seed <code>${escape(job.seed)}</code></p>${job.batches.map((id, i) => `<a class="button secondary" style="margin:4px" href="generatedimages/${url(id)}/index.html">Open batch ${i + 1} ↗</a>`).join('')}`;
          await refresh();
        }
        break;
      }
    }
  } catch (error) { status(`Connection interrupted. Generation may still be running. Refresh to reconnect. ${error.message}`, true); }
  finally { polling = false; }
}
if ($('#parameter-controls')) {
  const controls = [ ['amount', 'Byte value', 0, 100, 10, 60], ['iterations', 'Byte writes', 1, 10000, 5, 35], ['quality', 'JPEG quality', 1, 100, 10, 60], ['seed', 'Byte positions', 0, 100, 0, 100] ];
  $('#parameter-controls').innerHTML = controls.map(([name, description, min, max, low, high]) => `<div class="param-row" data-param="${name}"><div class="param-label"><strong>${name[0].toUpperCase() + name.slice(1)}</strong><small>${description}</small></div><label>Mode<select name="${name}Mode" aria-label="${name} mode"><option value="range">Range</option><option value="fixed">Fixed</option></select></label><label><span class="low-label">Min</span><input aria-label="${name} minimum or fixed value" name="${name}Low" type="number" min="${min}" max="${max}" value="${low}" required></label><label class="high-label">Max<input aria-label="${name} maximum" name="${name}High" type="number" min="${min}" max="${max}" value="${high}" required></label></div>`).join('');
  for (const row of document.querySelectorAll('[data-param]')) {
    row.querySelector('select').onchange = event => {
      const fixed = event.target.value === 'fixed';
      row.querySelector('.low-label').textContent = fixed ? 'Value' : 'Min';
      row.querySelector('.high-label input').disabled = fixed;
      row.querySelector('.high-label').style.visibility = fixed ? 'hidden' : 'visible';
    };
  }
  $('#files').onchange = event => importFiles(event.target.files);
  $('#folder').onchange = event => importFiles(event.target.files);
  $('#select-all').onclick = () => { catalog.images.forEach(image => selected.add(image.id)); renderLibrary(); };
  $('#select-none').onclick = () => { selected.clear(); renderLibrary(); };
  $('#generate-form').onsubmit = async event => {
    event.preventDefault();
    if (!selected.size) return status('Choose at least one image from your library.', true);
    const data = new FormData(event.target);
    const settings = Object.fromEntries(['count', 'maxWidth', 'format', 'randomSeed'].map(key => [key, data.get(key)]));
    for (const [name] of controls) settings[name] = data.get(`${name}Mode`) === 'fixed' ? data.get(`${name}Low`) : `${data.get(`${name}Low`)}:${data.get(`${name}High`)}`;
    generating = true; busy(); status('Starting experiment…');
    try { await api('/api/generate', { images: [...selected], settings }); await poll(); }
    catch (error) { generating = false; busy(); status(error.message, true); }
  };
}
if ($('#batch-filter')) $('#batch-filter').oninput = batchCards;
refresh().then(() => { if ($('#generate')) poll(); }).catch(error => status(`Start Glitch lab with npm start, then open the localhost address. ${error.message}`, true));
