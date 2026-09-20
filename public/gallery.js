const entries = [...document.querySelectorAll('.gallery .image-card')].map(card => ({ card, link: card.querySelector('.image-link') })).filter(entry => entry.link);
for (const image of document.querySelectorAll('img[data-original]')) {
  image.addEventListener('error', () => { image.src = image.dataset.original; }, { once: true });
}

const viewer = document.createElement('dialog');
viewer.className = 'image-viewer';
viewer.setAttribute('aria-labelledby', 'viewer-title');
viewer.innerHTML = `<div class="viewer-toolbar"><div><span id="viewer-position" class="eyebrow"></span><h2 id="viewer-title"></h2></div><div class="viewer-navigation"><button type="button" class="secondary" id="viewer-previous" aria-label="Previous image">← Previous</button><button type="button" class="secondary" id="viewer-next" aria-label="Next image">Next →</button><button type="button" class="secondary" id="viewer-close" aria-label="Close image preview" autofocus>Close ✕</button></div></div><div class="viewer-layout"><div class="viewer-image-area"><img id="viewer-image" alt=""><p id="viewer-image-error" role="status" hidden>Could not load this image.</p></div><aside class="viewer-sidebar"><div id="viewer-details"></div><p id="viewer-notice" role="status" aria-live="polite"></p><p class="small muted">Use ← and → to browse. Esc closes the preview.</p></aside></div>`;
document.body.append(viewer);
const preview = viewer.querySelector('#viewer-image');
const previous = viewer.querySelector('#viewer-previous');
const next = viewer.querySelector('#viewer-next');
let current = 0;
let opener;

function renderViewer() {
  const entry = entries[current];
  const sourceImage = entry.link.querySelector('img');
  viewer.querySelector('#viewer-title').textContent = entry.card.querySelector('h2').textContent;
  viewer.querySelector('#viewer-position').textContent = `IMAGE ${current + 1} / ${entries.length}`;
  viewer.querySelector('#viewer-image-error').hidden = true;
  preview.src = entry.link.href;
  preview.alt = sourceImage.alt;
  const details = entry.card.querySelector('.card-body').cloneNode(true);
  // Batch-level settings apply to every image; favorite cards already include them.
  const batchMeta = document.querySelector('.batch-meta');
  if (batchMeta) {
    const meta = batchMeta.cloneNode(true);
    details.append(meta);
    const dimensions = document.createElement('p');
    dimensions.className = 'small';
    dimensions.textContent = document.querySelector('.page-heading p')?.textContent || '';
    details.append(dimensions);
  }
  if (!details.querySelector('button[data-batch]')) {
    const saved = document.createElement('button');
    saved.textContent = 'Saved favorite';
    saved.disabled = true;
    details.querySelector('.actions').prepend(saved);
  }
  viewer.querySelector('#viewer-details').replaceChildren(details);
  viewer.querySelector('#viewer-notice').textContent = entry.card.dataset.notice || '';
  previous.disabled = current === 0;
  next.disabled = current === entries.length - 1;
}
function navigate(offset) {
  const index = current + offset;
  if (index < 0 || index >= entries.length) return;
  current = index;
  renderViewer();
}
for (const [index, entry] of entries.entries()) {
  entry.link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    current = index;
    opener = entry.link;
    renderViewer();
    viewer.showModal();
    document.body.classList.add('viewer-open');
  });
}
previous.addEventListener('click', () => navigate(-1));
next.addEventListener('click', () => navigate(1));
viewer.querySelector('#viewer-close').addEventListener('click', () => viewer.close());
preview.addEventListener('error', () => { viewer.querySelector('#viewer-image-error').hidden = false; });
viewer.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    viewer.close();
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    navigate(event.key === 'ArrowLeft' ? -1 : 1);
  }
});
viewer.addEventListener('click', event => {
  const rect = viewer.getBoundingClientRect();
  if (event.target === viewer && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) viewer.close();
});
viewer.addEventListener('close', () => {
  document.body.classList.remove('viewer-open');
  preview.removeAttribute('src');
  opener?.focus();
});

// Delegate to handle both the gallery buttons and their preview counterparts.
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-batch]');
  if (!button || button.disabled) return;
  const card = button.closest('.image-card') || entries[current].card;
  const originalButton = card.querySelector('button[data-batch]');
  if (originalButton.disabled) return;
  const notify = message => {
    card.dataset.notice = message;
    const notice = document.querySelector('#notice');
    if (notice) notice.textContent = message;
    if (viewer.open && entries[current].card === card) viewer.querySelector('#viewer-notice').textContent = message;
  };
  originalButton.disabled = true;
  button.disabled = true;
  notify('Saving favorite…');
  try {
    const response = await fetch('/api/favorite', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Glitch-Lab': '1' }, body: JSON.stringify({ batch: originalButton.dataset.batch, index: Number(originalButton.dataset.index) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    const link = card.querySelector('.image-link');
    const filename = new URL(link.href).pathname.split('/').pop();
    const favoriteUrl = `/favorites/${encodeURIComponent(result.id)}/${filename}`;
    link.href = favoriteUrl;
    card.querySelector('a[download]').href = favoriteUrl;
    const thumbnail = link.querySelector('img');
    thumbnail.dataset.original = favoriteUrl;
    thumbnail.src = `/thumb${favoriteUrl}`;
    card.querySelector('.tag').textContent = 'FAVORITE';
    originalButton.textContent = 'Saved';
    notify('Favorite saved with its recipe.');
  } catch (error) {
    notify(error.message || 'Start the local helper with npm start to save favorites.');
  } finally {
    originalButton.disabled = false;
    button.disabled = false;
    if (viewer.open && entries[current].card === card) renderViewer();
  }
});
