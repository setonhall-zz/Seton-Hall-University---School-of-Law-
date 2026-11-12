// Browser smoke test: boots the built app, plays a little, checks for errors.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] ?? '.';
const b = await chromium.launch();
const errors = [];
const page = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://localhost:4173/');
await page.waitForTimeout(1500);
await page.screenshot({ path: out + '/01-arrive.png' });
// pick up the stone nearest Pim and set it beside Pim, through real pointer events
const spot = await page.evaluate(() => {
  const r = window.__r, w = r.world, c = w.creatures[0];
  const s = Object.values(w.objects).filter(o => o.kind === 'stone').sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
  const e = t => [0, 0, 3, 9, 9, 9][w.terrain[t.y * w.w + t.x]];
  const a = r.toScreen(s.x, s.y, e(s));
  const land = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [2, 0]].map(([dx, dy]) => ({ x: Math.round(c.x) + dx, y: Math.round(c.y) + dy })).find(t => [2, 3].includes(w.terrain[t.y * w.w + t.x]) && !Object.values(w.objects).some(o => o.x === t.x && o.y === t.y));
  const d = r.toScreen(land.x, land.y, e(land));
  return { a, d };
});
await page.mouse.click(spot.a.x, spot.a.y);
await page.waitForTimeout(200);
await page.mouse.click(spot.d.x, spot.d.y);
await page.waitForTimeout(400);
const afterMove = await page.evaluate(() => window.__r.world.events.filter(e => e.type.startsWith('hand.')).length);
await page.screenshot({ path: out + '/02-moved.png' });
// other tools
for (const name of ['Fruit', 'Signal', 'Log', 'Lumen']) { await page.getByRole('button', { name, exact: true }).click(); await page.mouse.click(spot.d.x + 60, spot.d.y + 30); await page.waitForTimeout(150); }
const hands = await page.evaluate(() => window.__r.world.events.filter(e => e.type.startsWith('hand.')).map(e => e.type));
await page.getByRole('button', { name: 'Sixteen times speed' }).click();
await page.waitForTimeout(9000);
await page.screenshot({ path: out + '/03-later.png' });
await page.getByRole('button', { name: 'Discover' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: out + '/04-chronicle.png' });
const entry = page.locator('.entry').first();
if (await entry.count()) { await entry.click(); await page.waitForTimeout(200); await page.screenshot({ path: out + '/05-evidence.png' }); }
await page.getByRole('button', { name: 'Observe' }).click();
await page.locator('.row').first().click();
await page.waitForTimeout(200);
await page.screenshot({ path: out + '/06-creature.png' });
await page.getByRole('button', { name: 'Island menu' }).click();
await page.getByRole('button', { name: 'Save now' }).click();
await page.waitForTimeout(500);
const before = await page.evaluate(() => ({ tick: window.__r.world.tick, events: window.__r.world.events.length, saved: document.querySelector('.saved')?.textContent }));
await page.reload(); await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({ tick: window.__r.world.tick, events: window.__r.world.events.length, practices: Object.keys(window.__r.world.practices).length }));
const phone = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
phone.on('pageerror', e => errors.push('phone: ' + e));
await phone.goto('http://localhost:4173/'); await phone.waitForTimeout(1500);
await phone.screenshot({ path: out + '/07-phone.png' });
await phone.getByRole('button', { name: 'Discover' }).tap(); await phone.waitForTimeout(300);
await phone.screenshot({ path: out + '/08-phone-sheet.png' });
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth);
console.log(JSON.stringify({ afterMove, hands, before, after, overflow, errors }, null, 1));
await b.close();
