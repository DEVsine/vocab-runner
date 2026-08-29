const $ = id => document.getElementById(id);

// Add a new vocabulary category here when its deck has locally cached images.
// The UI intentionally does not depend on animal-specific fields.
const categories = [{
  id: 'animals', deck: 'animals.json', icon: '🐘', name: 'สัตว์', englishName: 'Animals',
  description: 'ภาพถ่ายจริงของสัตว์ 204 คำ เพื่อดูความหมายก่อนเริ่มเล่น',
  imageFolder: 'animals/', attribution: 'assets/animals/attribution.json',
}, {
  id: 'verbs', deck: 'verbs.json', icon: '🏃', name: 'กริยา', englishName: 'Verbs',
  description: 'คำกริยาที่ใช้บ่อย พร้อมภาพของการกระทำที่สื่อได้ชัดเจน',
  imageFolder: 'verbs/', attribution: 'assets/verbs/attribution.json',
}, {
  id: 'nouns', deck: 'nouns.json', icon: '🏠', name: 'คำนามในชีวิตประจำวัน', englishName: 'Everyday Nouns',
  description: 'สิ่งของ สถานที่ อาหาร และธรรมชาติรอบตัว',
  imageFolder: 'nouns/', attribution: 'assets/nouns/attribution.json',
}];

let currentCategory;
let currentDeck;
let currentCredits;

function assetUrl(path) {
  return new URL(`../assets/${path}`, import.meta.url).href;
}

function setRoute(category, word) {
  const url = new URL(location.href);
  category ? url.searchParams.set('category', category) : url.searchParams.delete('category');
  word ? url.searchParams.set('word', word) : url.searchParams.delete('word');
  history.pushState({}, '', url);
}

function show(view) {
  $('category-view').hidden = view !== 'categories';
  $('words-view').hidden = view !== 'words';
  $('word-dialog').hidden = true;
}

function categoryCard(category, count) {
  const button = document.createElement('button');
  button.className = 'category-card';
  button.type = 'button';
  button.append(Object.assign(document.createElement('span'), { className: 'category-icon', textContent: category.icon }));
  const copy = document.createElement('span');
  copy.className = 'category-copy';
  const title = document.createElement('strong');
  title.textContent = `${category.name} · ${category.englishName}`;
  const detail = document.createElement('span');
  detail.textContent = `${count} คำ · ${category.description}`;
  copy.append(title, detail);
  button.append(copy, Object.assign(document.createElement('span'), { className: 'arrow', textContent: '→', 'aria-hidden': 'true' }));
  button.addEventListener('click', () => openCategory(category.id));
  return button;
}

async function loadCategory(category) {
  const [deckResponse, creditsResponse] = await Promise.all([
    fetch(`./decks/${category.deck}`, { cache: 'no-store' }),
    fetch(`./${category.attribution}`, { cache: 'no-store' }),
  ]);
  if (!deckResponse.ok || !creditsResponse.ok) throw new Error('ยังโหลดคลังคำศัพท์นี้ไม่ได้');
  return Promise.all([deckResponse.json(), creditsResponse.json()]);
}

async function renderCategories() {
  const grid = $('category-grid');
  grid.replaceChildren();
  for (const category of categories) {
    try {
      const [deck] = await loadCategory(category);
      grid.append(categoryCard(category, deck.words.length));
    } catch {
      // Do not offer a category that is not ready for offline use.
    }
  }
}

function wordTile(word) {
  const button = document.createElement('button');
  button.className = 'word-tile';
  button.type = 'button';
  if (word.img) {
    const image = document.createElement('img');
    image.src = assetUrl(word.img);
    image.alt = '';
    image.loading = 'lazy';
    button.append(image);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'word-placeholder';
    placeholder.textContent = word.emoji || '💬';
    placeholder.setAttribute('aria-hidden', 'true');
    button.append(placeholder);
  }
  const label = document.createElement('span');
  label.textContent = word.en;
  button.append(label);
  button.addEventListener('click', () => openWord(word.en));
  return button;
}

async function openCategory(id, replace = false) {
  const category = categories.find(item => item.id === id);
  if (!category) return show('categories');
  try {
    [currentDeck, currentCredits] = await loadCategory(category);
    currentCategory = category;
    $('category-title').textContent = `${category.icon} ${category.name}`;
    $('category-description').textContent = category.description;
    $('category-count').textContent = `${currentDeck.words.length} คำ`;
    const grid = $('word-grid');
    grid.replaceChildren(...currentDeck.words.map(wordTile));
    show('words');
    if (replace) history.replaceState({}, '', new URL(`?category=${id}`, location.href));
    else setRoute(id);
  } catch (error) {
    $('category-grid').textContent = error.message;
    show('categories');
  }
}

function openWord(en, replace = false) {
  const word = currentDeck?.words.find(item => item.en === en);
  if (!word) return;
  const credit = currentCredits[word.en];
  const image = $('detail-image');
  const noImage = $('detail-no-image');
  if (word.img) {
    image.src = assetUrl(word.img);
    image.alt = `${word.en} — ${word.th}`;
    image.hidden = false;
    noImage.hidden = true;
  } else {
    image.removeAttribute('src');
    image.hidden = true;
    noImage.hidden = false;
    noImage.textContent = currentCredits.omissions?.[word.en]
      ? `ไม่มีภาพประกอบ · ${currentCredits.omissions[word.en]}`
      : 'ไม่มีภาพประกอบสำหรับคำนี้';
  }
  $('detail-en').textContent = word.en;
  $('detail-th').textContent = word.th;
  const source = $('detail-credit');
  source.replaceChildren();
  if (credit) {
    source.append('ภาพ: ');
    const imageLink = document.createElement('a');
    imageLink.href = credit.sourceUrl; imageLink.target = '_blank'; imageLink.rel = 'noreferrer'; imageLink.textContent = credit.title;
    const licenseLink = document.createElement('a');
    licenseLink.href = credit.licenseUrl; licenseLink.target = '_blank'; licenseLink.rel = 'noreferrer'; licenseLink.textContent = credit.license;
    source.append(imageLink, ` โดย ${credit.creator} · `, licenseLink);
  } else if (word.img) source.textContent = 'กำลังเตรียมข้อมูลเครดิตภาพ';
  $('word-dialog').hidden = false;
  if (replace) history.replaceState({}, '', new URL(`?category=${currentCategory.id}&word=${encodeURIComponent(en)}`, location.href));
  else setRoute(currentCategory.id, en);
}

function closeWord() {
  $('word-dialog').hidden = true;
  setRoute(currentCategory.id);
}

$('back-to-categories').addEventListener('click', () => { show('categories'); setRoute(); });
$('close-detail').addEventListener('click', closeWord);
$('word-dialog').addEventListener('click', event => { if (event.target === $('word-dialog')) closeWord(); });
window.addEventListener('popstate', () => boot());

async function boot() {
  await renderCategories();
  const params = new URLSearchParams(location.search);
  const category = params.get('category');
  if (!category) return show('categories');
  await openCategory(category, true);
  if (params.get('word')) openWord(params.get('word'), true);
}

boot().catch(error => { $('category-grid').textContent = error.message; });
