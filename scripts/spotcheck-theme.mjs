/**
 * Spot-check light/dark design tokens + key UI chrome.
 * Does not require full auth — injects a fixture panel when Clerk gates the app.
 *
 * Usage: node scripts/spotcheck-theme.mjs
 * Requires: npm run dev on :3000, playwright installed
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.SPOTCHECK_URL || 'http://localhost:3000';
const OUT = path.resolve('scripts/spotcheck-output');
fs.mkdirSync(OUT, { recursive: true });

const FIXTURE = `
<div id="ds-fixture" style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;background:hsl(var(--overlay)/0.6);font-family:var(--font-sans)">
  <div style="width:100%;max-width:28rem;border-radius:1rem;border:1px solid hsl(var(--border));background:hsl(var(--card)/0.95);color:hsl(var(--card-foreground));box-shadow:0 25px 50px -12px rgb(0 0 0 / 0.25);overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:1rem 1.5rem;border-bottom:1px solid hsl(var(--border))">
      <h2 style="margin:0;font-size:1.5rem;font-weight:700">Record Settlement</h2>
      <button style="width:2.25rem;height:2.25rem;border-radius:0.375rem;border:1px solid hsl(var(--border));background:transparent;color:hsl(var(--foreground))">×</button>
    </div>
    <div style="padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:1rem">
      <p style="margin:0;font-size:0.875rem;color:hsl(var(--muted-foreground))">This directly updates balances. No expense will be added.</p>
      <div style="text-align:center">
        <div style="display:inline-flex;align-items:center;gap:0.25rem;font-size:2rem;font-weight:700;color:hsl(var(--foreground))">
          <span style="color:hsl(var(--muted-foreground))">₹</span>5000
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem">
        <label style="font-size:0.75rem;font-weight:600;color:hsl(var(--muted-foreground));letter-spacing:0.05em">WHO IS PAYING</label>
        <div style="padding:0.75rem 1rem;border-radius:0.5rem;background:hsl(var(--muted));color:hsl(var(--foreground));font-weight:500">Ashwini Thakurdwave</div>
      </div>
      <div style="display:flex;justify-content:center">
        <div style="width:2.5rem;height:2.5rem;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:hsl(var(--success)/0.15);color:hsl(var(--success));font-weight:700">→</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem">
        <label style="font-size:0.75rem;font-weight:600;color:hsl(var(--muted-foreground));letter-spacing:0.05em">WHO IS RECEIVING</label>
        <div style="padding:0.75rem 1rem;border-radius:0.5rem;background:hsl(var(--muted));color:hsl(var(--foreground));font-weight:500">Ninad Sapre</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <div style="padding:0.75rem;border-radius:0.5rem;border:1px dashed hsl(var(--border));text-align:center;background:hsl(var(--card))">
          <div style="font-size:0.75rem;color:hsl(var(--muted-foreground))">Payer balance</div>
          <div style="font-weight:700;color:hsl(var(--success))">₹4,041</div>
        </div>
        <div style="padding:0.75rem;border-radius:0.5rem;border:1px dashed hsl(var(--border));text-align:center;background:hsl(var(--card))">
          <div style="font-size:0.75rem;color:hsl(var(--muted-foreground))">Receiver balance</div>
          <div style="font-weight:700;color:hsl(var(--destructive))">₹9,100</div>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:0.75rem;padding:1rem 1.5rem;border-top:1px solid hsl(var(--border))">
      <button style="flex:1;padding:0.75rem;border-radius:0.75rem;background:hsl(var(--muted));color:hsl(var(--muted-foreground));border:none;font-weight:500">Cancel</button>
      <button style="flex:2;padding:0.75rem;border-radius:0.75rem;background:hsl(var(--primary));color:hsl(var(--primary-foreground));border:none;font-weight:700">Record settlement</button>
    </div>
  </div>
</div>
`;

function readToken(styles, name) {
  return styles.getPropertyValue(name).trim();
}

async function measure(page, mode) {
  await page.evaluate((m) => {
    document.documentElement.classList.toggle('dark', m === 'dark');
  }, mode);

  // Ensure fixture exists
  await page.evaluate((html) => {
    document.getElementById('ds-fixture')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);
  }, FIXTURE);

  const shot = path.join(OUT, `settlement-modal-${mode}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const pick = (n) => s.getPropertyValue(n).trim();
    const el = document.querySelector('#ds-fixture > div');
    const cs = el ? getComputedStyle(el) : null;
    const title = document.querySelector('#ds-fixture h2');
    const muted = document.querySelector('#ds-fixture p');
    const primaryBtn = document.querySelectorAll('#ds-fixture button')[2];
    return {
      tokens: {
        background: pick('--background'),
        foreground: pick('--foreground'),
        card: pick('--card'),
        primary: pick('--primary'),
        mutedFg: pick('--muted-foreground'),
        border: pick('--border'),
        success: pick('--success'),
        destructive: pick('--destructive'),
      },
      htmlHasDark: document.documentElement.classList.contains('dark'),
      cardBg: cs?.backgroundColor || null,
      titleColor: title ? getComputedStyle(title).color : null,
      mutedColor: muted ? getComputedStyle(muted).color : null,
      primaryBtnBg: primaryBtn ? getComputedStyle(primaryBtn).backgroundColor : null,
      primaryBtnColor: primaryBtn ? getComputedStyle(primaryBtn).color : null,
      bodyColor: getComputedStyle(document.body).color,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });

  return { mode, shot, ...tokens };
}

function contrastHint(rgbStr) {
  // crude luminance from rgb(a)
  const m = rgbStr?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function checkMode(result) {
  const issues = [];
  const { mode, tokens, htmlHasDark, cardBg, titleColor, mutedColor, primaryBtnBg, primaryBtnColor } = result;

  if (mode === 'dark' && !htmlHasDark) issues.push('html missing .dark class');
  if (mode === 'light' && htmlHasDark) issues.push('html still has .dark in light mode');

  if (!tokens.background || !tokens.foreground || !tokens.card) {
    issues.push('missing core CSS variables');
  }

  // Light vs dark background channels should differ
  const bg = tokens.background.split(/\s+/).map(Number);
  if (mode === 'light' && bg[2] < 50) issues.push(`light --background lightness too low: ${tokens.background}`);
  if (mode === 'dark' && bg[2] > 40) issues.push(`dark --background lightness too high: ${tokens.background}`);

  const titleL = contrastHint(titleColor);
  const cardL = contrastHint(cardBg);
  const mutedL = contrastHint(mutedColor);
  const btnL = contrastHint(primaryBtnBg);
  const btnTextL = contrastHint(primaryBtnColor);

  if (titleL != null && cardL != null) {
    const delta = Math.abs(titleL - cardL);
    if (delta < 0.15) issues.push(`title vs card contrast low (ΔL=${delta.toFixed(2)})`);
  }
  if (mutedL != null && cardL != null) {
    const delta = Math.abs(mutedL - cardL);
    if (delta < 0.08) issues.push(`muted text vs card contrast low (ΔL=${delta.toFixed(2)})`);
  }
  if (btnL != null && btnTextL != null) {
    const delta = Math.abs(btnL - btnTextL);
    if (delta < 0.2) issues.push(`primary button text contrast low (ΔL=${delta.toFixed(2)})`);
  }

  // Primary should resolve to a purple-ish (not transparent)
  if (primaryBtnBg && /rgba?\(0,\s*0,\s*0,\s*0\)/.test(primaryBtnBg)) {
    issues.push('primary button background transparent');
  }

  return issues;
}

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const ok = await waitForServer(BASE);
if (!ok) {
  console.error('Dev server not reachable at', BASE);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

// Load app so real CSS (index.css tokens) is applied
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => page.goto(BASE, { waitUntil: 'domcontentloaded' }));

// Wait for CSS variables to exist
await page.waitForFunction(() => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  return v.length > 0;
}, { timeout: 15000 });

const results = [];
for (const mode of ['light', 'dark']) {
  const r = await measure(page, mode);
  r.issues = checkMode(r);
  results.push(r);
  console.log(`\n=== ${mode.toUpperCase()} ===`);
  console.log('tokens:', r.tokens);
  console.log('computed:', {
    cardBg: r.cardBg,
    titleColor: r.titleColor,
    mutedColor: r.mutedColor,
    primaryBtnBg: r.primaryBtnBg,
    primaryBtnColor: r.primaryBtnColor,
  });
  console.log('screenshot:', r.shot);
  if (r.issues.length) console.log('ISSUES:', r.issues);
  else console.log('OK: no automated contrast/token issues');
}

// Also screenshot bare app shell in both modes (auth gate may show)
for (const mode of ['light', 'dark']) {
  await page.evaluate((m) => {
    document.getElementById('ds-fixture')?.remove();
    document.documentElement.classList.toggle('dark', m === 'dark');
  }, mode);
  const p = path.join(OUT, `app-shell-${mode}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log('app shell:', p);
}

await browser.close();

const allIssues = results.flatMap((r) => r.issues.map((i) => `[${r.mode}] ${i}`));
const report = {
  url: BASE,
  results: results.map(({ mode, tokens, issues, shot, cardBg, titleColor, mutedColor, primaryBtnBg }) => ({
    mode, tokens, issues, shot, cardBg, titleColor, mutedColor, primaryBtnBg,
  })),
  allIssues,
  ok: allIssues.length === 0,
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('\nReport:', path.join(OUT, 'report.json'));
process.exit(allIssues.length ? 2 : 0);
