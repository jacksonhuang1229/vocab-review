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
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-ocr-profile-'));
const expectedWords = ['apple', 'bridge', 'castle', 'donkey', 'engine', 'forest', 'ice cream', 'well-known'];

const browser = await puppeteer.launch({
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
});

function remoteUrl(url) {
  return !url.startsWith(base) && !url.startsWith('blob:') && !url.startsWith('data:') && !url.startsWith('ws://127.0.0.1');
}

async function spellings(page) {
  return page.$$eval('[data-testid="entry-spelling"]', (nodes) => nodes.map((node) => node.value));
}

async function upload(page, testId, filePath) {
  const input = await page.waitForSelector(`[data-testid="${testId}"]`);
  await input.uploadFile(filePath);
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

async function replaceInput(page, selector, value) {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
}

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  const remote = [];
  page.on('request', (request) => {
    if (remoteUrl(request.url())) remote.push(request.url());
  });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(`${base}/import`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="photo-source"]');
  const capture = await page.$eval('[data-testid="camera-input"]', (node) => node.getAttribute('capture'));
  const cameraAccept = await page.$eval('[data-testid="camera-input"]', (node) => node.getAttribute('accept'));
  const albumCapture = await page.$eval('[data-testid="album-input"]', (node) => node.hasAttribute('capture'));
  const albumAccept = await page.$eval('[data-testid="album-input"]', (node) => node.getAttribute('accept'));
  assert.equal(capture, 'environment');
  assert.equal(cameraAccept, 'image/*');
  assert.equal(albumCapture, false);
  assert.equal(albumAccept, 'image/*');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `phone import overflow ${overflow}px`);
  await shot(page, 'ocr_phone_import.png');

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.type('[data-testid="set-name"]', 'Printed Lesson');
  await page.click('[data-testid="add-entry"]');
  await page.waitForSelector('[data-testid="entry-spelling"]');
  await page.type('[data-testid="entry-spelling"]', 'keep-me');

  await upload(page, 'album-input', path.join(fixtures, 'not-a-photo.png'));
  await page.waitForFunction(() => document.querySelector('[data-testid="ocr-error"]')?.textContent?.includes('讀取不到'));
  assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Printed Lesson');
  assert.deepEqual(await spellings(page), ['keep-me']);
  assert.equal(await page.$('[data-testid="photo-preview"]'), null);

  await upload(page, 'album-input', path.join(fixtures, 'blurry-column.png'));
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="ocr-error"]')?.textContent ?? '';
    return text.includes('沒有辨識到英文詞') || text.includes('太模糊');
  });
  assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Printed Lesson');
  assert.deepEqual(await spellings(page), ['keep-me']);
  assert.ok(await page.$('[data-testid="photo-preview"]'));
  await shot(page, 'ocr_blurry_keeps_draft.png');

  await page.type('[data-testid="paste-lines"]', 'mango\nnectar');
  await page.click('[data-testid="paste-add"]');
  await page.waitForSelector('[data-testid="paste-notice"]');
  assert.deepEqual(await spellings(page), ['keep-me', 'mango', 'nectar']);

  await upload(page, 'album-input', path.join(fixtures, 'printed-column.png'));
  await page.waitForFunction(() => document.querySelector('[data-testid="file-status"]')?.textContent?.includes('已辨識 printed-column.png'));
  assert.equal(await page.$eval('[data-testid="set-name"]', (node) => node.value), 'Printed Lesson');
  assert.deepEqual(await spellings(page), expectedWords);
  await replaceInput(page, '[data-testid="entry-spelling"]', 'apples');
  assert.equal((await spellings(page))[0], 'apples');
  assert.equal((await spellings(page))[6], 'ice cream');
  assert.equal((await spellings(page))[7], 'well-known');
  await shot(page, 'ocr_corrected_preview.png');
  await page.click('[data-testid="confirm-save"]');
  await page.waitForSelector('[data-testid="practice-modes"]');
  assert.equal((await spellings(page))[0], 'apples');

  await page.goto(`${base}/import`, { waitUntil: 'domcontentloaded' });
  await page.type('[data-testid="set-name"]', 'Camera Lesson');
  await upload(page, 'camera-input', path.join(fixtures, 'printed-column.png'));
  await page.waitForFunction(() => document.querySelector('[data-testid="file-status"]')?.textContent?.includes('已辨識 printed-column.png'));
  assert.deepEqual(await spellings(page), expectedWords);
  await page.click('[data-testid="confirm-save"]');
  await page.waitForSelector('[data-testid="practice-modes"]');

  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="set-list"]');
  const names = await page.$$eval('[data-testid="set-card"]', (cards) => cards.map((card) => card.getAttribute('data-set-name')));
  assert.deepEqual(names.sort(), ['Camera Lesson', 'Printed Lesson']);
  await page.click('[data-testid="set-card"][data-set-name="Printed Lesson"]');
  await page.waitForSelector('[data-testid="entry-spelling"]');
  assert.equal((await spellings(page))[0], 'apples');
  assert.ok((await spellings(page)).includes('ice cream'));

  assert.deepEqual(remote, [], `photo or model left the origin: ${remote.join(', ')}`);
  console.log('step 2 verification passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
