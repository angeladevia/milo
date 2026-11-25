const byId = (id) => document.getElementById(id);
const home = byId('home');
const reader = byId('reader');
const shelf = byId('shelf');
const viewport = byId('viewport');
const page = byId('page');
const front = byId('front');
const under = byId('under');
const paperBack = byId('paper-back');
const crease = byId('crease');
const previous = byId('prev');
const next = byId('next');
const zoom = byId('zoom');
const title = byId('book-title');
const readerError = byId('reader-error');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const positions = new Map();
const pages = new Map();
let book;
let index = 0;
let gesture;
let frame = 0;
let turnTimer = 0;
let turnId = 0;
let moving = false;
let queuedDirection = 0;

function readImage(file, alt = '') {
  const image = new Image();
  image.src = file;
  image.alt = alt;
  image.draggable = false;
  return image;
}

function setDownload(link, entry) {
  link.href = `descargas/${entry.slug}.pdf`;
  link.download = `${entry.title}.pdf`;
  link.setAttribute('aria-label', `Descargar PDF de ${entry.title}`);
}

function showBooks(books) {
  for (const entry of books) {
    const card = document.createElement('button');
    card.className = 'book';
    card.type = 'button';
    const art = document.createElement('span');
    art.className = 'art';
    art.append(readImage(entry.cover));
    const caption = document.createElement('span');
    caption.className = 'caption';
    const name = document.createElement('strong');
    name.textContent = entry.title;
    const count = document.createElement('small');
    count.textContent = `${entry.pages.length} páginas`;
    const cta = document.createElement('span');
    cta.className = 'read-cta';
    cta.textContent = 'Abrir libro';
    caption.append(name, count, cta);
    card.append(art, caption);
    card.dataset.slug = entry.slug;
    card.addEventListener('click', () => { location.hash = `leer/${entry.slug}`; });
    const tile = document.createElement('article');
    tile.className = 'book-tile';
    const download = document.createElement('a');
    download.className = 'read-cta download';
    download.textContent = 'Descargar PDF';
    setDownload(download, entry);
    tile.append(card, download);
    shelf.append(tile);
  }
}

function imageFor(number) {
  const { file } = book.pages[number];
  if (!pages.has(file)) {
    const image = readImage(file, `Página ${number + 1} de ${book.title}`);
    const asset = { image, ready: false };
    asset.loaded = image.decode().then(() => {
      asset.ready = true;
      return true;
    }, () => {
      pages.delete(file);
      return false;
    });
    pages.set(file, asset);
  }
  return pages.get(file);
}

function clearFold() {
  front.style.clipPath = '';
  paperBack.style.visibility = '';
  crease.style.visibility = '';
  under.replaceChildren();
}

function drawPage() {
  clearFold();
  const { width, height } = book.pages[index];
  page.style.setProperty('--ratio', width / height);
  front.replaceChildren(imageFor(index).image);
  byId('count').textContent = `${index + 1} / ${book.pages.length}`;
  byId('count').setAttribute('aria-label', `Página ${index + 1} de ${book.pages.length}`);
  previous.disabled = index === 0;
  next.disabled = index === book.pages.length - 1;
  for (const neighbor of [index - 1, index + 1]) {
    if (book.pages[neighbor]) imageFor(neighbor);
  }
}

function setZoom(active) {
  viewport.classList.toggle('zoomed', active);
  zoom.setAttribute('aria-pressed', String(active));
  zoom.textContent = active ? 'Ajustar a pantalla' : 'Ampliar';
  byId('gesture-hint').textContent = active
    ? 'Desplázate para explorar la página ampliada.'
    : 'Toca un borde o arrastra la hoja para pasar de página.';
  viewport.scrollTo(0, 0);
}

function route(books) {
  turnId += 1;
  cancelAnimationFrame(frame);
  clearTimeout(turnTimer);
  moving = false;
  queuedDirection = 0;
  gesture = undefined;
  readerError.hidden = true;
  const last = book;
  const slug = location.hash.startsWith('#leer/') ? location.hash.slice(6) : '';
  book = books.find((entry) => entry.slug === slug);
  reader.hidden = !book;
  home.hidden = Boolean(book);
  if (!book) {
    clearFold();
    if (last) shelf.querySelector(`[data-slug="${last.slug}"]`)?.focus();
    if (location.hash === '#libros') byId('libros').scrollIntoView();
    return;
  }
  index = positions.get(book.slug) ?? 0;
  title.textContent = book.title;
  setDownload(byId('download'), book);
  setZoom(false);
  drawPage();
  window.scrollTo(0, 0);
  title.focus({ preventScroll: true });
}

function polygon(points) {
  if (!points.length) return 'polygon(0 0, 0 0, 0 0)';
  return `polygon(${points.map(({ x, y }) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(', ')})`;
}

function clipPolygon(points, distance) {
  const output = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const da = distance(a);
    const db = distance(b);
    if (da >= 0) output.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return output;
}

// The fold lies on the perpendicular bisector of the original and dragged corners.
function renderFold({ direction, cornerY }, progress, vertical) {
  const { width, height } = page.getBoundingClientRect();
  const corner = { x: direction > 0 ? width : 0, y: cornerY * height };
  const dx = -direction * Math.max(0.01, progress * width * 2);
  const dy = vertical * height;
  const length = Math.hypot(dx, dy);
  const nx = dx / length;
  const ny = dy / length;
  const mx = corner.x + dx / 2;
  const my = corner.y + dy / 2;
  const distance = ({ x, y }) => (x - mx) * nx + (y - my) * ny;
  const rectangle = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const fixed = clipPolygon(rectangle, distance);
  const turned = clipPolygon(rectangle, (point) => -distance(point)).map((point) => {
    const offset = 2 * distance(point);
    return { x: point.x - offset * nx, y: point.y - offset * ny };
  });
  const angle = Math.atan2(nx, -ny) * 180 / Math.PI;
  const band = `calc(50% + ${(mx - width / 2) * nx + (my - height / 2) * ny}px)`;
  front.style.clipPath = polygon(fixed);
  paperBack.style.clipPath = polygon(turned);
  paperBack.style.background = `linear-gradient(${angle}deg,#cfb791 ${band},#fff8e7 calc(${band} + 27px),#eee1c3 calc(${band} + 100px))`;
  paperBack.style.visibility = 'visible';
  crease.style.background = `linear-gradient(${angle}deg,transparent calc(${band} - 26px),#42301940 ${band},#412d1b22 calc(${band} + 9px),transparent calc(${band} + 23px))`;
  crease.style.visibility = 'visible';
}

function canTurn(direction) {
  return book && Boolean(book.pages[index + direction]);
}

function finishTurn(direction) {
  cancelAnimationFrame(frame);
  clearTimeout(turnTimer);
  if (direction) {
    index += direction;
    positions.set(book.slug, index);
  }
  moving = false;
  drawPage();
  const pending = queuedDirection;
  queuedDirection = 0;
  if (pending) turn(pending);
}

async function animateTurn(fold, start, vertical, commit) {
  moving = true;
  readerError.hidden = true;
  const id = ++turnId;
  const target = imageFor(index + fold.direction);

  if (!target.ready && commit && !await target.loaded) {
    if (id !== turnId) return;
    readerError.textContent = 'No se pudo cargar esa página. Vuelve a intentarlo.';
    readerError.hidden = false;
    queuedDirection = 0;
    finishTurn(0);
    return;
  }
  if (id !== turnId) return;

  const direction = commit ? fold.direction : 0;
  if (!target.ready || reducedMotion.matches || viewport.classList.contains('zoomed')) {
    finishTurn(direction);
    return;
  }

  under.replaceChildren(target.image);
  const destination = commit ? 1.04 : 0;
  const started = performance.now();
  const duration = commit ? 380 : 175;
  function step(now) {
    const time = Math.min(1, (now - started) / duration);
    if (time === 1) {
      finishTurn(direction);
      return;
    }
    const easing = 1 - (1 - time) ** 2;
    const progress = start + (destination - start) * easing;
    const lift = commit ? Math.sin(time * Math.PI) * (fold.cornerY ? -.20 : .20) : 0;
    renderFold(fold, progress, vertical * (1 - easing) + lift);
    frame = requestAnimationFrame(step);
  }
  frame = requestAnimationFrame(step);
  // Complete the turn even if the browser pauses animation frames in the background.
  turnTimer = setTimeout(() => finishTurn(direction), duration + 85);
}

function turn(direction) {
  if (gesture || !book) return;
  if (moving) {
    queuedDirection = direction;
    return;
  }
  if (canTurn(direction)) animateTurn({ direction, cornerY: 1 }, 0, 0, true);
}

page.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0 || moving || gesture || viewport.classList.contains('zoomed')) return;
  const bounds = page.getBoundingClientRect();
  gesture = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    side: event.clientX - bounds.left < bounds.width / 2 ? -1 : 1,
    cornerY: event.clientY - bounds.top > bounds.height / 2 ? 1 : 0,
    width: bounds.width,
    height: bounds.height,
    progress: 0,
    vertical: 0
  };
  page.setPointerCapture(event.pointerId);
});

function updateDrag(active, event) {
  const { x, y, width, height, cornerY } = active;
  const dx = event.clientX - x;
  const dy = event.clientY - y;
  if (!active.direction && Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy)) {
    active.direction = dx < 0 ? 1 : -1;
  }
  if (!active.direction) return;
  const towardPage = Math.max(0, -dx * active.direction);
  active.distance = towardPage;
  active.progress = Math.min(.7, towardPage / (width * 2));
  active.vertical = (cornerY ? -1 : 1) * Math.min(.32, Math.abs(dy) / height);
}

page.addEventListener('pointermove', (event) => {
  if (gesture?.id !== event.pointerId) return;
  updateDrag(gesture, event);
  if (!gesture.direction || !canTurn(gesture.direction) || reducedMotion.matches) return;
  const target = imageFor(index + gesture.direction);
  if (!target.ready) return;
  if (target.image.parentElement !== under) under.replaceChildren(target.image);
  renderFold(gesture, gesture.progress, gesture.vertical);
});

function release(event, canceled) {
  if (gesture?.id !== event.pointerId) return;
  const active = gesture;
  gesture = undefined;
  if (!canceled) updateDrag(active, event);
  if (active.direction && canTurn(active.direction)) {
    const threshold = Math.min(58, Math.max(22, active.width * .075));
    const commit = !canceled && active.distance >= threshold;
    animateTurn(active, under.firstChild ? active.progress : 0, active.vertical, commit);
  } else if (!canceled && !active.direction && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 12) {
    turn(active.side);
  } else {
    clearFold();
  }
}

page.addEventListener('pointerup', (event) => release(event, false));
page.addEventListener('pointercancel', (event) => release(event, true));
page.addEventListener('lostpointercapture', (event) => release(event, true));
previous.addEventListener('click', () => turn(-1));
next.addEventListener('click', () => turn(1));
zoom.addEventListener('click', () => setZoom(!viewport.classList.contains('zoomed')));
byId('back').addEventListener('click', () => { location.hash = 'libros'; });
document.addEventListener('keydown', (event) => {
  if (!book || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'Escape') {
    if (viewport.classList.contains('zoomed')) setZoom(false);
    else location.hash = 'libros';
  }
  if (viewport.classList.contains('zoomed')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    turn(event.key === 'ArrowLeft' ? -1 : 1);
  }
});

const books = window.miloBooks;
if (books?.length) {
  showBooks(books);
  route(books);
  window.addEventListener('hashchange', () => route(books));
} else {
  shelf.textContent = 'No se pudo cargar la biblioteca. Recarga la página para volver a intentarlo.';
}
