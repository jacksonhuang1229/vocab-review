import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const base = 'http://127.0.0.1:5173';
const shots = process.env.VERIFY_SHOTS ?? '/opt/cursor/artifacts';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-picture-profile-'));
const pngPath = path.join(os.tmpdir(), 'vocab-apple.png');
fs.writeFileSync(
  pngPath,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  userDataDir,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-first-run', '--no-first-run', '--disable-default-browser-check', '--window-size=1280,900'],
});

function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  return page.screenshot({ path: path.join(shots, name), fullPage: true });
}

async function readLibrary(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('english-vocab-review');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['wordSets', 'images'], 'readonly');
          const setsRequest = tx.objectStore('wordSets').getAll();
          const imagesRequest = tx.objectStore('images').getAll();
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            resolve({
              sets: setsRequest.result.map((set) => ({
                name: set.name,
                entries: set.entries.map((entry) => ({
                  spelling: entry.spelling,
                  meaningHint: entry.meaningHint ?? '',
                  imageId: entry.imageId ?? '',
                  abstract: Boolean(entry.abstract),
                  imageAcceptedSpelling: entry.imageAcceptedSpelling ?? '',
                })),
              })),
              images: imagesRequest.result.map((image) => ({
                id: image.id,
                word: image.word,
                meaning: image.meaning,
                source: image.source,
                sceneConfirmed: image.sceneConfirmed,
                size: image.blob?.size ?? 0,
              })),
            });
          };
        };
      }),
  );
}

async function createSet(page, name, lines) {
  await page.goto(`${base}/import`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="set-name"]');
  await page.type('[data-testid="set-name"]', name);
  await page.$eval(
    '[data-testid="paste-lines"]',
    (node, text) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(node, text);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    },
    lines.join('\n'),
  );
  await page.click('[data-testid="paste-add"]');
  await page.waitForFunction((count) => document.querySelectorAll('[data-testid="entry-spelling"]').length === count, {}, lines.length);
  await page.click('[data-testid="confirm-save"]');
  await page.waitForSelector('[data-testid="detail-name"]');
  await page.waitForFunction(() => {
    const picture = document.querySelector('[data-testid="entry-picture"] [data-testid="picture-upload"]');
    return picture && !picture.disabled;
  });
}

async function setField(page, spelling, testId, value) {
  await page.$eval(
    `[data-testid="entry-picture"][data-spelling="${spelling}"]`,
    (node, field, next) => {
      const input = node.closest('.entry-main')?.querySelector(`[data-testid="${field}"]`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, next);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    },
    testId,
    value,
  );
}

async function uploadPicture(page, spelling) {
  const input = await page.waitForSelector(`[data-testid="entry-picture"][data-spelling="${spelling}"] [data-testid="picture-file"]`);
  await input.uploadFile(pngPath);
  await page.waitForSelector(`[data-testid="entry-picture"][data-spelling="${spelling}"] [data-testid="picture-preview"]`);
}

async function saveDetail(page) {
  await page.click('[data-testid="detail-save"]');
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="detail-save"]');
    return button instanceof HTMLButtonElement && button.disabled && document.querySelector('[data-testid="save-notice"]');
  });
}

async function pictureCount(page) {
  return page.$eval('[data-testid="mode-picture"] [data-testid="mode-count"]', (node) => node.textContent ?? '');
}

async function waitForCount(page, text) {
  await page.waitForFunction((expected) => document.querySelector('[data-testid="mode-picture"] [data-testid="mode-count"]')?.textContent === expected, {}, text);
}

async function openSet(page, name) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-testid="set-card"][data-set-name="${name}"]`);
  await page.click(`[data-testid="set-card"][data-set-name="${name}"]`);
  await page.waitForSelector('[data-testid="detail-name"]');
  await page.waitForSelector('[data-testid="mode-picture"] [data-testid="mode-count"]');
}

async function choiceSpellings(page) {
  return page.$$eval('[data-testid="picture-choice"]', (nodes) => nodes.map((node) => node.getAttribute('data-spelling')));
}

async function choose(page, spelling) {
  await page.waitForFunction((word) => {
    const button = document.querySelector(`[data-testid="picture-choice"][data-spelling="${word}"]`);
    return button instanceof HTMLButtonElement && !button.disabled;
  }, {}, spelling);
  await page.click(`[data-testid="picture-choice"][data-spelling="${spelling}"]`);
  await page.waitForFunction((word) => {
    const button = document.querySelector(`[data-testid="picture-choice"][data-spelling="${word}"]`);
    return button?.getAttribute('aria-pressed') === 'true';
  }, {}, spelling);
  await page.click('[data-testid="submit-answer"]');
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}`);
}

async function assertTap(page, selector) {
  const box = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
  assert.ok(box.height >= 44, `${selector} height ${box.height}`);
  assert.ok(box.width >= 120, `${selector} width ${box.width}`);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  await createSet(page, 'Fruit Pictures', ['apple', 'banana', 'grape']);
  await setField(page, 'apple', 'entry-meaning', '蘋果');
  await setField(page, 'banana', 'entry-meaning', '香蕉');
  await setField(page, 'grape', 'entry-meaning', '葡萄');
  await uploadPicture(page, 'apple');
  assert.equal(
    await page.$eval('[data-testid="entry-picture"][data-spelling="apple"]', (node) => node.getAttribute('data-state')),
    'ready',
  );
  assert.equal(
    await page.$eval('[data-testid="entry-picture"][data-spelling="apple"] [data-testid="picture-source"]', (node) => node.textContent),
    '來源：家長上傳',
  );
  await saveDetail(page);
  await waitForCount(page, '可出題 1 個詞');
  assert.match(await page.$eval('[data-testid="picture-skipped"]', (node) => node.textContent ?? ''), /缺圖/);

  await page.click('[data-testid="start-picture"]');
  await page.waitForSelector('[data-testid="picture-prompt"]');
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-testid="picture-prompt"]');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  assert.equal(await page.$eval('[data-testid="question-progress"]', (node) => node.textContent), '第 1 題，共 1 題');
  assert.deepEqual((await choiceSpellings(page)).slice().sort(), ['apple', 'banana', 'grape']);
  await choose(page, 'banana');
  await page.waitForSelector('[data-testid="feedback"][data-result="wrong"]');
  assert.equal(await page.$eval('[data-testid="correct-spelling"]', (node) => node.textContent), 'apple');
  await shot(page, 'picture_quiz_feedback.png');
  await page.click('[data-testid="next-question"]');
  await page.waitForSelector('[data-testid="round-summary"]');
  assert.equal(await page.$eval('[data-testid="round-score"]', (node) => node.textContent?.replace(/\s+/g, ' ').trim()), '答對 0 / 1');
  await page.click('[data-testid="retry-round"]');
  await page.waitForSelector('[data-testid="picture-choice"][data-spelling="apple"]');
  await choose(page, 'apple');
  await page.waitForSelector('[data-testid="feedback"][data-result="right"]');
  await page.click('[data-testid="next-question"]');
  await page.waitForSelector('[data-testid="round-summary"]');
  assert.equal(await page.$eval('[data-testid="round-score"]', (node) => node.textContent?.replace(/\s+/g, ' ').trim()), '答對 1 / 1');
  await page.click('[data-testid="back-to-set"]');
  await page.waitForSelector('[data-testid="detail-name"]');

  await createSet(page, 'Snack Pictures', ['apple', 'cookie']);
  await setField(page, 'apple', 'entry-meaning', '蘋果');
  await setField(page, 'cookie', 'entry-meaning', '餅乾');
  await page.waitForSelector('[data-testid="entry-picture"][data-spelling="apple"] [data-testid="picture-reuse"]');
  await page.click('[data-testid="entry-picture"][data-spelling="apple"] [data-testid="picture-reuse"]');
  await page.waitForSelector('[data-testid="entry-picture"][data-spelling="apple"] [data-testid="picture-preview"]');
  await saveDetail(page);
  await waitForCount(page, '可出題 1 個詞');
  await shot(page, 'picture_reuse_detail.png');
  const shared = await readLibrary(page);
  const appleImages = shared.images.filter((image) => image.word === 'apple' && image.meaning === '蘋果');
  assert.equal(appleImages.length, 1);
  assert.equal(appleImages[0].source, 'upload');
  assert.ok(appleImages[0].size > 0);
  const fruitApple = shared.sets.find((set) => set.name === 'Fruit Pictures')?.entries.find((entry) => entry.spelling === 'apple');
  const snackApple = shared.sets.find((set) => set.name === 'Snack Pictures')?.entries.find((entry) => entry.spelling === 'apple');
  assert.equal(fruitApple?.imageId, appleImages[0].id);
  assert.equal(snackApple?.imageId, appleImages[0].id);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="entry-picture"][data-spelling="apple"] [data-testid="picture-preview"]');
  await page.click('[data-testid="start-picture"]');
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-testid="picture-prompt"]');
    return image instanceof HTMLImageElement && image.naturalWidth > 0;
  });
  assert.ok((await choiceSpellings(page)).includes('apple'));
  assert.ok((await choiceSpellings(page)).includes('cookie'));

  await createSet(page, 'Abstract Pictures', ['hope', 'peace', 'joy']);
  await page.click('[data-testid="entry-picture"][data-spelling="hope"] [data-testid="picture-abstract"]');
  await setField(page, 'hope', 'entry-meaning', '希望');
  await setField(page, 'peace', 'entry-meaning', '和平');
  await setField(page, 'joy', 'entry-meaning', '喜悅');
  await uploadPicture(page, 'hope');
  assert.equal(
    await page.$eval('[data-testid="entry-picture"][data-spelling="hope"]', (node) => node.getAttribute('data-state')),
    'needs-scene',
  );
  await saveDetail(page);
  await waitForCount(page, '可出題 0 個詞');
  assert.match(await page.$eval('[data-testid="picture-scene-note"]', (node) => node.textContent ?? ''), /確認情境圖/);
  await shot(page, 'picture_abstract_needs_confirm.png');
  await page.click('[data-testid="picture-confirm-scene"]');
  await waitForCount(page, '可出題 1 個詞');
  const confirmed = (await readLibrary(page)).images.find((image) => image.word === 'hope');
  assert.equal(confirmed?.sceneConfirmed, true);
  assert.equal(confirmed?.source, 'upload');
  await page.click('[data-testid="start-picture"]');
  await page.waitForSelector('[data-testid="picture-choice"][data-spelling="peace"]');
  assert.ok((await choiceSpellings(page)).includes('hope'));
  await choose(page, 'peace');
  await page.waitForSelector('[data-testid="feedback"][data-result="wrong"]');
  assert.equal(await page.$eval('[data-testid="correct-spelling"]', (node) => node.textContent), 'hope');

  await createSet(page, 'Solo Picture', ['solo']);
  await setField(page, 'solo', 'entry-meaning', '單獨');
  await uploadPicture(page, 'solo');
  await saveDetail(page);
  await waitForCount(page, '可出題 0 個詞');
  assert.equal(await page.$eval('[data-testid="mode-listen"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 1 個詞');
  await page.click('[data-testid="start-picture"]');
  await page.waitForSelector('[data-testid="picture-unavailable"]');
  const emptyCopy = await page.$eval('[data-testid="picture-unavailable"]', (node) => node.textContent ?? '');
  assert.match(emptyCopy, /還沒有可出的看圖題/);
  assert.match(emptyCopy, /兩個/);
  assert.match(emptyCopy, /配圖/);
  await shot(page, 'picture_no_questions.png');
  await page.click('[data-testid="back-to-list"]');
  await page.waitForSelector('[data-testid="set-list"]');
  assert.equal(new URL(page.url()).pathname, '/');

  await createSet(page, 'Animal Pictures', ['cat', 'kitten', 'bird']);
  await setField(page, 'cat', 'entry-meaning', '貓');
  await setField(page, 'kitten', 'entry-meaning', '貓');
  await setField(page, 'bird', 'entry-meaning', '鳥');
  await uploadPicture(page, 'cat');
  await saveDetail(page);
  await waitForCount(page, '可出題 1 個詞');
  await page.click('[data-testid="start-picture"]');
  await page.waitForSelector('[data-testid="picture-choices"]');
  assert.deepEqual((await choiceSpellings(page)).slice().sort(), ['bird', 'cat']);

  await openSet(page, 'Fruit Pictures');
  await setField(page, 'apple', 'entry-spelling', 'apples');
  await page.waitForSelector('[data-testid="entry-picture"][data-spelling="apples"][data-state="needs-reconfirm"]');
  assert.match(await page.$eval('[data-testid="picture-reconfirm-note"]', (node) => node.textContent ?? ''), /是否還適用/);
  await saveDetail(page);
  await waitForCount(page, '可出題 0 個詞');
  await page.click('[data-testid="picture-reconfirm"]');
  await page.waitForSelector('[data-testid="entry-picture"][data-spelling="apples"][data-state="ready"]');
  await saveDetail(page);
  await waitForCount(page, '可出題 1 個詞');
  const afterRename = await readLibrary(page);
  const appleStill = afterRename.images.filter((image) => image.word === 'apple' && image.meaning === '蘋果');
  assert.equal(appleStill.length, 1);
  const renamed = afterRename.sets.find((set) => set.name === 'Fruit Pictures')?.entries.find((entry) => entry.spelling === 'apples');
  const snackStill = afterRename.sets.find((set) => set.name === 'Snack Pictures')?.entries.find((entry) => entry.spelling === 'apple');
  assert.equal(renamed?.imageId, appleStill[0].id);
  assert.equal(renamed?.imageAcceptedSpelling, 'apples');
  assert.equal(snackStill?.imageId, appleStill[0].id);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await openSet(page, 'Animal Pictures');
  await page.click('[data-testid="start-picture"]');
  await page.waitForSelector('[data-testid="picture-choice"]');
  await assertTap(page, '[data-testid="picture-choice"]');
  await assertTap(page, '[data-testid="submit-answer"]');
  await assertNoHorizontalOverflow(page);
  await shot(page, 'picture_quiz_phone.png');
  await page.click('[data-testid="picture-choice"]');
  await page.click('[data-testid="submit-answer"]');
  await page.waitForSelector('[data-testid="next-question"]');
  await assertTap(page, '[data-testid="next-question"]');

  console.log('step 4 verification passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser.connected) await browser.close();
}
