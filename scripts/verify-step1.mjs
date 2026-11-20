import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'public/fixtures');
const base = 'http://127.0.0.1:5173';
const shots = process.env.VERIFY_SHOTS ?? '/opt/cursor/artifacts';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-profile-'));

const launchOptions = {
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  userDataDir,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-first-run',
    '--no-first-run',
    '--disable-default-browser-check',
    '--window-size=1280,900',
  ],
};

function canon(sets) {
  return JSON.stringify(
    [...sets]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((set) => ({
        ...set,
        entries: set.entries.map((entry) => ({ ...entry })),
      })),
  );
}

async function spellings(page) {
  return page.$$eval('[data-testid="entry-spelling"]', (nodes) => nodes.map((node) => node.value));
}

async function meanings(page) {
  return page.$$eval('[data-testid="entry-meaning"]', (nodes) => nodes.map((node) => node.value));
}

async function readSets(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('english-vocab-review');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('wordSets')) {
            resolve([]);
            return;
          }
          const tx = db.transaction('wordSets', 'readonly');
          const request = tx.objectStore('wordSets').getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        };
      }),
  );
}

async function cardNames(page) {
  return page.$$eval('[data-testid="set-card"]', (cards) =>
    cards.map((card) => card.getAttribute('data-set-name')),
  );
}

async function openSet(page, name) {
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-testid="set-card"][data-set-name="${name}"]`);
  await page.click(`[data-testid="set-card"][data-set-name="${name}"]`);
  await page.waitForSelector('[data-testid="detail-name"]');
}

async function replaceInput(page, selector, value) {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
}

async function upload(page, filePath) {
  const input = await page.waitForSelector('[data-testid="file-input"]');
  await input.uploadFile(filePath);
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px at ${page.viewport()?.width}`);
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

const browser = await puppeteer.launch(launchOptions);
try {
  let page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="empty-library"]');
  const emptyLibrary = await page.$eval('[data-testid="empty-library"]', (node) => node.textContent ?? '');
  assert.ok(emptyLibrary.includes('還沒有單字組'));
  assert.ok(emptyLibrary.includes('Flyer - Unit 4'));

  await page.click('[data-testid="create-set"]');
  await page.waitForSelector('[data-testid="empty-preview"]');
  await page.click('[data-testid="confirm-save"]');
  await page.waitForSelector('[data-testid="save-error"]');
  assert.match(await page.$eval('[data-testid="save-error"]', (node) => node.textContent ?? ''), /請填寫課次名稱/);
  assert.equal((await readSets(page)).length, 0);

  await page.type('[data-testid="set-name"]', 'Only A Name');
  await page.click('[data-testid="confirm-save"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="save-error"]')?.textContent?.includes('請至少加入一個詞條'),
  );
  assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Only A Name');
  await page.click('[data-testid="cancel-import"]');
  await page.waitForSelector('[data-testid="empty-library"]');
  assert.equal((await readSets(page)).length, 0);

  await page.goto(`${base}/import`, { waitUntil: 'domcontentloaded' });
  await page.type('[data-testid="set-name"]', 'Flyer - Unit 4');
  await upload(page, path.join(fixtures, 'flyer-unit-4.txt'));
  await page.waitForSelector('[data-testid="file-status"]');
  assert.match(await page.$eval('[data-testid="file-status"]', (node) => node.textContent ?? ''), /flyer-unit-4\.txt，共 12 個詞/);
  assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Flyer - Unit 4');
  const unit4Preview = await spellings(page);
  assert.deepEqual(unit4Preview, fs.readFileSync(path.join(fixtures, 'flyer-unit-4.txt'), 'utf8').trim().split('\n'));
  await page.click('[data-testid="entry-meaning"]');
  await page.keyboard.type('機場');
  await page.click('[data-testid="confirm-save"]');
  await page.waitForSelector('[data-testid="practice-modes"]');
  assert.equal(await page.$eval('[data-testid="mode-cloze"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 12 個詞');
  assert.equal(await page.$eval('[data-testid="mode-listen"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 12 個詞');
  assert.ok(await page.$('[data-testid="start-cloze"]'));
  assert.ok(await page.$('[data-testid="start-listen"]'));
  assert.equal(await page.$eval('[data-testid="mode-picture"] [data-testid="mode-count"]', (node) => node.textContent), '可出題 0 個詞');
  assert.match(await page.$eval('[data-testid="picture-empty-note"]', (node) => node.textContent ?? ''), /上傳配圖/);
  assert.ok(await page.$('[data-testid="start-picture"]'));
  const modeTitles = await page.$$eval('[data-testid="practice-modes"] h3', (nodes) => nodes.map((node) => node.textContent));
  assert.deepEqual(modeTitles, ['聽音拼字', '字母填空', '看圖選字']);

  await page.goto(`${base}/import`, { waitUntil: 'domcontentloaded' });
  await page.type('[data-testid="set-name"]', 'Flyer - Unit 5');
  await upload(page, path.join(fixtures, 'flyer-unit-5.txt'));
  await page.waitForFunction(() => document.body.textContent?.includes('共 12 個詞'));
  assert.deepEqual(
    await spellings(page),
    fs.readFileSync(path.join(fixtures, 'flyer-unit-5.txt'), 'utf8').trim().split('\n'),
  );
  await page.click('[data-testid="confirm-save"]');
  await page.waitForSelector('[data-testid="practice-modes"]');

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="set-list"]');
  assert.deepEqual((await cardNames(page)).sort(), ['Flyer - Unit 4', 'Flyer - Unit 5']);

  await openSet(page, 'Flyer - Unit 4');
  assert.equal((await spellings(page))[0], 'airport');
  assert.equal((await spellings(page)).at(-1), 'postcard');
  assert.equal((await meanings(page))[0], '機場');
  await openSet(page, 'Flyer - Unit 5');
  assert.deepEqual((await spellings(page)).slice(0, 2), ['ice cream', 'well-known']);
  assert.ok((await spellings(page)).includes('swimming pool'));
  assert.ok((await spellings(page)).includes('post office'));

  await browser.close();
  const reopened = await puppeteer.launch(launchOptions);
  try {
    page = await reopened.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="set-list"]');
    assert.deepEqual((await cardNames(page)).sort(), ['Flyer - Unit 4', 'Flyer - Unit 5']);
    await assertNoHorizontalOverflow(page);
    await shot(page, 'word_sets_after_reload.png');

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="set-list"]');
    await assertNoHorizontalOverflow(page);
    await shot(page, 'word_sets_phone.png');
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

    await openSet(page, 'Flyer - Unit 4');
    const meaningInputs = await page.$$('[data-testid="entry-meaning"]');
    await meaningInputs[1].click();
    await page.keyboard.type('背包');
    await page.click('[data-testid="detail-save"]');
    await page.waitForSelector('[data-testid="save-notice"]');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entry-meaning"]');
    assert.equal((await meanings(page))[1], '背包');

    const unit4Id = (await readSets(page)).find((set) => set.name === 'Flyer - Unit 4').id;
    await page.evaluate(async (id) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('english-vocab-review');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const current = await new Promise((resolve, reject) => {
        const request = db.transaction('wordSets', 'readonly').objectStore('wordSets').get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      current.entries[0].imageId = 'img-airport';
      await new Promise((resolve, reject) => {
        const tx = db.transaction('wordSets', 'readwrite');
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();
        tx.objectStore('wordSets').put(current);
      });
    }, unit4Id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="detail-name"]');
    const thirdMeaning = (await page.$$('[data-testid="entry-meaning"]'))[2];
    await thirdMeaning.click();
    await page.keyboard.type('日曆');
    await page.click('[data-testid="detail-save"]');
    await page.waitForSelector('[data-testid="save-notice"]');
    let storedUnit4 = (await readSets(page)).find((set) => set.id === unit4Id);
    assert.equal(storedUnit4.entries[0].imageId, 'img-airport');
    assert.equal(storedUnit4.entries[0].meaningHint, '機場');
    assert.equal(storedUnit4.entries[0].spelling, 'airport');
    assert.equal(storedUnit4.entries[2].meaningHint, '日曆');
    assert.equal(typeof storedUnit4.createdAt, 'number');
    assert.ok(storedUnit4.updatedAt >= storedUnit4.createdAt);

    const upButtons = await page.$$('[aria-label^="上移"]');
    await upButtons[1].click();
    assert.deepEqual((await spellings(page)).slice(0, 2), ['backpack', 'airport']);
    await page.click('[data-testid="detail-save"]');
    await page.waitForSelector('[data-testid="save-notice"]');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="entry-spelling"]');
    assert.deepEqual((await spellings(page)).slice(0, 2), ['backpack', 'airport']);
    await assertNoHorizontalOverflow(page);
    await shot(page, 'set_detail_modes_unavailable.png');

    const libraryBeforeEdges = canon(await readSets(page));

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(`${base}/import`, { waitUntil: 'domcontentloaded' });
    await page.type('[data-testid="set-name"]', 'Kept Name');
    await upload(page, path.join(fixtures, 'empty.txt'));
    await page.waitForSelector('[data-testid="empty-file"]');
    const emptyCopy = await page.$eval('[data-testid="empty-file"]', (node) => node.textContent ?? '');
    assert.ok(emptyCopy.includes('這份檔案是空的'));
    assert.match(await page.$eval('[data-testid="file-status"]', (node) => node.textContent ?? ''), /這份檔案是空的/);
    assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Kept Name');
    assert.equal((await spellings(page)).length, 0);
    await page.click('[data-testid="add-entry"]');
    await page.waitForSelector('[data-testid="entry-spelling"]');
    await page.type('[data-testid="entry-spelling"]', 'pineapple');
    await page.click('[data-testid="entry-meaning"]');
    await page.keyboard.type('鳳梨');
    assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Kept Name');
    assert.deepEqual(await spellings(page), ['pineapple']);
    assert.deepEqual(await meanings(page), ['鳳梨']);
    assert.match(await page.$eval('[data-testid="file-status"]', (node) => node.textContent ?? ''), /這份檔案是空的/);
    await assertNoHorizontalOverflow(page);
    await shot(page, 'empty_file_preview_edits.png');

    await page.click('[data-testid="cancel-import"]');
    await page.waitForSelector('[data-testid="set-list"]');
    assert.equal(canon(await readSets(page)), libraryBeforeEdges);
    assert.deepEqual((await cardNames(page)).sort(), ['Flyer - Unit 4', 'Flyer - Unit 5']);

    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${base}/import`, { waitUntil: 'domcontentloaded' });
    await page.type('[data-testid="set-name"]', 'Keep Me');
    await page.click('[data-testid="add-entry"]');
    await page.waitForSelector('[data-testid="entry-spelling"]');
    await page.type('[data-testid="entry-spelling"]', 'stay');
    const badPath = path.join(os.tmpdir(), 'bad-encoding.txt');
    fs.writeFileSync(badPath, Buffer.from([0xff, 0xfe, 0xfd]));
    await upload(page, badPath);
    await page.waitForFunction(() => document.querySelector('[data-testid="save-error"]')?.textContent?.includes('無法以 UTF-8'));
    assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Keep Me');
    assert.deepEqual(await spellings(page), ['stay']);

    const utf8Path = path.join(os.tmpdir(), 'utf8-phrase.txt');
    fs.writeFileSync(utf8Path, 'café\nice cream\n', 'utf8');
    await upload(page, utf8Path);
    await page.waitForFunction(() => document.body.textContent?.includes('共 2 個詞'));
    assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Keep Me');
    assert.deepEqual(await spellings(page), ['café', 'ice cream']);

    await page.goto(`${base}/import?simulateSaveFailure=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="failure-armed"]');
    await upload(page, path.join(fixtures, 'flyer-unit-5.txt'));
    await page.waitForSelector('[data-testid="entry-spelling"]');
    await page.type('[data-testid="set-name"]', 'Should Not Persist');
    await replaceInput(page, '[data-testid="entry-spelling"]', 'edited ice cream');
    await page.click('[data-testid="entry-meaning"]');
    await page.keyboard.type('冰淇淋');
    await page.click('[data-testid="add-entry"]');
    const spellingInputs = await page.$$('[data-testid="entry-spelling"]');
    await spellingInputs[spellingInputs.length - 1].type('extra word');
    await page.click('[data-testid="confirm-save"]');
    await page.waitForSelector('[data-testid="save-error"]');
    const failure = await page.$eval('[data-testid="save-error"]', (node) => node.textContent ?? '');
    assert.match(failure, /模擬寫入失敗/);
    assert.match(failure, /修改都還在/);
    assert.ok(page.url().includes('/import'));
    assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Should Not Persist');
    const failedSpellings = await spellings(page);
    assert.equal(failedSpellings[0], 'edited ice cream');
    assert.equal(failedSpellings.at(-1), 'extra word');
    assert.equal((await meanings(page))[0], '冰淇淋');
    const afterFailure = await readSets(page);
    assert.equal(afterFailure.length, 2);
    assert.ok(afterFailure.every((set) => set.name !== 'Should Not Persist'));
    assert.equal(canon(afterFailure), libraryBeforeEdges);
    await shot(page, 'save_failure_keeps_preview.png');

    await openSet(page, 'Flyer - Unit 5');
    const unit5Before = (await readSets(page)).find((set) => set.name === 'Flyer - Unit 5');
    await replaceInput(page, '[data-testid="detail-name"]', 'Flyer - Unit 5 edited');
    await page.evaluate(() => sessionStorage.setItem('vocab:simulateSaveFailure', '1'));
    await page.click('[data-testid="detail-save"]');
    await page.waitForSelector('[data-testid="save-error"]');
    assert.match(await page.$eval('[data-testid="save-error"]', (node) => node.textContent ?? ''), /模擬寫入失敗/);
    assert.equal(await page.$eval('[data-testid="detail-name"]', (node) => node.value), 'Flyer - Unit 5 edited');
    assert.equal((await spellings(page))[0], 'ice cream');
    const unit5After = (await readSets(page)).find((set) => set.id === unit5Before.id);
    assert.equal(unit5After.name, 'Flyer - Unit 5');
    assert.deepEqual(unit5After.entries, unit5Before.entries);

    console.log('step 1 verification passed');
  } finally {
    await reopened.close();
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser.connected) await browser.close();
}
