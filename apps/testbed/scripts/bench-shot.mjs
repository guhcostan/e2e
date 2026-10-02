// Captures the benchmark todo flow end state for docs.
// Assumes the playground app is already listening (see e2e.bench-*.config.ts).
// Usage: PORT=4272 node app/server.mjs & node scripts/bench-shot.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const base = process.env.BENCH_APP_URL ?? 'http://127.0.0.1:4272';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base + '/todos');
await page.getByRole('textbox', { name: 'New todo' }).fill('Buy milk');
await page.getByRole('button', { name: 'Add' }).click();
await page.getByRole('textbox', { name: 'New todo' }).fill('Walk the dog');
await page.getByRole('button', { name: 'Add' }).click();
await page.getByRole('checkbox', { name: 'Buy milk' }).check();
await page.screenshot({ path: fileURLToPath(new URL('../../docs/images/bench-todo-flow.png', import.meta.url)) });
await browser.close();
console.log('saved docs/images/bench-todo-flow.png');
