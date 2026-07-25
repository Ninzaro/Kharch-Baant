/**
 * One-shot class migration: Tailwind raw palette → design-system tokens.
 * Run: node scripts/migrate-design-tokens.mjs
 * Idempotent-ish: safe-ish to re-run if replacements are already applied.
 */
import fs from 'fs';
import path from 'path';

const roots = [
  'App.tsx',
  'index.tsx',
  'index.html',
  'components',
  'contexts',
  'hooks',
];

/** Longer / more specific first */
const replacements = [
  // Gradients (before partial color tokens)
  ['bg-gradient-to-br from-indigo-500 to-purple-600', 'bg-gradient-to-br from-primary to-accent'],
  ['hover:from-indigo-600 hover:to-purple-700', 'hover:from-primary/90 hover:to-accent/90'],
  ['from-indigo-500 via-purple-500 to-transparent', 'from-primary via-accent to-transparent'],
  ['from-indigo-500 to-purple-500', 'from-primary to-accent'],
  ['bg-gradient-to-r from-indigo-500 to-purple-500', 'bg-gradient-to-r from-primary to-accent'],
  ['bg-gradient-to-b from-indigo-500 via-purple-500 to-transparent', 'bg-gradient-to-b from-primary via-accent to-transparent'],
  ['from-emerald-500 to-teal-600', 'from-success to-success'],
  ['from-emerald-50 to-teal-50', 'from-success/10 to-success/5'],
  ['from-rose-600 to-red-600', 'from-destructive to-destructive'],
  ['hover:from-rose-500 hover:to-red-500', 'hover:from-destructive/90 hover:to-destructive/90'],
  ['from-rose-600 to-red-600', 'from-destructive to-destructive'],

  // Dark: dual system → single token system
  ['dark:bg-slate-800/60', 'bg-card/60'],
  ['dark:bg-slate-800/50', 'bg-card/50'],
  ['dark:bg-slate-800', 'bg-card'],
  ['dark:bg-slate-700', 'bg-muted'],
  ['dark:bg-black/70', 'bg-overlay/70'],
  ['dark:bg-black/50', 'bg-overlay/50'],
  ['dark:border-white/20', 'border-border'],
  ['dark:border-white/15', 'border-border'],
  ['dark:border-white/10', 'border-border'],
  ['dark:border-white/5', 'border-border'],
  ['dark:text-white', 'text-foreground'],
  ['dark:text-slate-300', 'text-muted-foreground'],
  ['dark:text-slate-400', 'text-muted-foreground'],
  ['dark:hover:bg-white/10', 'hover:bg-foreground/10'],
  ['dark:hover:bg-white/5', 'hover:bg-foreground/5'],
  ['bg-white/95 dark:bg-card/60', 'bg-card/95'],
  ['bg-white dark:bg-card', 'bg-card'],
  ['text-slate-900 dark:text-foreground', 'text-foreground'],
  ['text-slate-900 dark:text-white', 'text-foreground'],
  ['text-slate-600 dark:text-slate-300', 'text-muted-foreground'],
  ['text-slate-600 dark:text-muted-foreground', 'text-muted-foreground'],
  ['border-slate-200 dark:border-border', 'border-border'],
  ['border-slate-200 dark:border-white/20', 'border-border'],
  ['border-slate-200 dark:border-white/15', 'border-border'],
  ['border-slate-200 dark:border-white/10', 'border-border'],
  ['hover:bg-slate-100 dark:hover:bg-foreground/10', 'hover:bg-muted'],
  ['bg-slate-100 text-slate-700 dark:bg-muted dark:text-muted-foreground', 'bg-secondary text-secondary-foreground'],
  ['bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300', 'bg-secondary text-secondary-foreground'],

  // Indigo / primary (alpha forms first)
  ['bg-indigo-900/20', 'bg-primary/20'],
  ['bg-indigo-600/20', 'bg-primary/20'],
  ['bg-indigo-500/25', 'bg-primary/25'],
  ['bg-indigo-500/20', 'bg-primary/20'],
  ['bg-indigo-500/10', 'bg-primary/10'],
  ['border-indigo-500/50', 'border-primary/50'],
  ['border-indigo-500/30', 'border-primary/30'],
  ['border-indigo-500/20', 'border-primary/20'],
  ['ring-indigo-500/50', 'ring-primary/50'],
  ['ring-1 ring-indigo-500/50', 'ring-1 ring-primary/50'],
  ['shadow-indigo-500/25', 'shadow-primary/25'],
  ['shadow-[0_0_15px_rgba(99,102,241,0.6)]', 'shadow-[0_0_15px_hsl(var(--primary)/0.6)]'],
  ['hover:bg-indigo-500/20', 'hover:bg-primary/20'],
  ['hover:bg-indigo-400/10', 'hover:bg-primary/10'],
  ['hover:bg-indigo-500', 'hover:bg-primary/90'],
  ['hover:bg-indigo-600', 'hover:bg-primary/90'],
  ['hover:text-indigo-300', 'hover:text-primary'],
  ['hover:text-indigo-400', 'hover:text-primary'],
  ['focus:border-indigo-500', 'focus:border-ring'],
  ['focus:ring-indigo-500', 'focus:ring-ring'],
  ['focus-visible:ring-indigo-500', 'focus-visible:ring-ring'],
  ['bg-indigo-600', 'bg-primary'],
  ['bg-indigo-500', 'bg-primary'],
  ['text-indigo-400', 'text-primary'],
  ['text-indigo-300', 'text-primary'],
  ['text-indigo-500', 'text-primary'],
  ['text-indigo-600', 'text-primary'],
  ['border-indigo-500', 'border-primary'],
  ['ring-indigo-500', 'ring-ring'],
  ['from-indigo-500', 'from-primary'],
  ['to-purple-600', 'to-accent'],
  ['to-purple-500', 'to-accent'],
  ['via-purple-500', 'via-accent'],
  ['to-purple-700', 'to-accent'],

  // Emerald / success
  ['bg-emerald-500/20', 'bg-success/20'],
  ['bg-emerald-500/10', 'bg-success/10'],
  ['bg-emerald-600/80', 'bg-success/80'],
  ['bg-emerald-600', 'bg-success'],
  ['bg-emerald-500', 'bg-success'],
  ['hover:bg-emerald-500', 'hover:bg-success/90'],
  ['hover:bg-emerald-600', 'hover:bg-success/90'],
  ['text-emerald-400', 'text-success'],
  ['text-emerald-500', 'text-success'],
  ['text-emerald-300', 'text-success'],
  ['text-emerald-600', 'text-success'],
  ['border-emerald-500/30', 'border-success/30'],
  ['border-emerald-500/20', 'border-success/20'],
  ['border-emerald-500', 'border-success'],
  ['focus:border-emerald-500', 'focus:border-success'],
  ['focus:ring-emerald-500', 'focus:ring-success'],
  ['shadow-emerald-900/20', 'shadow-success/20'],
  ['drop-shadow-[0_0_8px_rgba(52,211,153,0.6)]', 'drop-shadow-[0_0_8px_hsl(var(--success)/0.6)]'],
  ['drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]', 'drop-shadow-[0_0_8px_hsl(var(--success)/0.4)]'],
  ['shadow-[0_0_15px_rgba(52,211,153,0.6)]', 'shadow-[0_0_15px_hsl(var(--success)/0.6)]'],

  // Rose / destructive
  ['bg-rose-500/30', 'bg-destructive/30'],
  ['bg-rose-500/20', 'bg-destructive/20'],
  ['bg-rose-500/10', 'bg-destructive/10'],
  ['bg-rose-600/80', 'bg-destructive/80'],
  ['bg-rose-600', 'bg-destructive'],
  ['bg-rose-500', 'bg-destructive'],
  ['hover:bg-rose-500/30', 'hover:bg-destructive/30'],
  ['hover:bg-rose-500/20', 'hover:bg-destructive/20'],
  ['hover:bg-rose-400/10', 'hover:bg-destructive/10'],
  ['hover:bg-rose-500', 'hover:bg-destructive/90'],
  ['hover:text-rose-400', 'hover:text-destructive'],
  ['hover:text-rose-300', 'hover:text-destructive'],
  ['text-rose-400', 'text-destructive'],
  ['text-rose-300', 'text-destructive'],
  ['text-rose-500', 'text-destructive'],
  ['border-rose-500/30', 'border-destructive/30'],
  ['border-rose-500/20', 'border-destructive/20'],
  ['border-rose-500', 'border-destructive'],
  ['shadow-[0_0_15px_rgba(244,63,94,0.6)]', 'shadow-[0_0_15px_hsl(var(--destructive)/0.6)]'],

  // Surfaces (alpha first)
  ['bg-slate-800/80', 'bg-card/80'],
  ['bg-slate-800/60', 'bg-card/60'],
  ['bg-slate-800/50', 'bg-card/50'],
  ['bg-slate-800/40', 'bg-card/40'],
  ['bg-slate-800/30', 'bg-card/30'],
  ['bg-slate-700/50', 'bg-muted/50'],
  ['bg-slate-900/40', 'bg-overlay/40'],
  ['bg-slate-900', 'bg-background'],
  ['bg-slate-800', 'bg-card'],
  ['bg-slate-700', 'bg-muted'],
  ['bg-slate-600', 'bg-muted'],
  ['bg-slate-100', 'bg-secondary'],
  ['bg-slate-50', 'bg-muted'],
  ['hover:bg-slate-800/80', 'hover:bg-card/80'],
  ['hover:bg-slate-700', 'hover:bg-muted'],
  ['hover:bg-slate-600', 'hover:bg-muted'],
  ['hover:bg-slate-100', 'hover:bg-muted'],

  // White / black glass
  ['bg-white/95', 'bg-card/95'],
  ['bg-white/20', 'bg-foreground/20'],
  ['bg-white/10', 'bg-foreground/10'],
  ['bg-white/5', 'bg-foreground/5'],
  ['hover:bg-white/20', 'hover:bg-foreground/20'],
  ['hover:bg-white/10', 'hover:bg-foreground/10'],
  ['hover:bg-white/5', 'hover:bg-foreground/5'],
  ['bg-black/70', 'bg-overlay/70'],
  ['bg-black/60', 'bg-overlay/60'],
  ['bg-black/50', 'bg-overlay/50'],
  ['bg-black/40', 'bg-overlay/40'],
  ['bg-black/30', 'bg-overlay/30'],
  ['bg-black/20', 'bg-overlay/20'],
  ['hover:bg-black/30', 'hover:bg-overlay/30'],

  // Text
  ['text-slate-100', 'text-foreground'],
  ['text-slate-200', 'text-foreground'],
  ['text-slate-300', 'text-muted-foreground'],
  ['text-slate-400', 'text-muted-foreground'],
  ['text-slate-500', 'text-muted-foreground'],
  ['text-slate-600', 'text-muted-foreground'],
  ['text-slate-700', 'text-foreground'],
  ['text-slate-900', 'text-foreground'],
  ['hover:text-white', 'hover:text-foreground'],
  ['hover:text-slate-300', 'hover:text-muted-foreground'],
  ['text-white', 'text-foreground'],

  // Borders
  ['border-white/20', 'border-border'],
  ['border-white/15', 'border-border'],
  ['border-white/10', 'border-border'],
  ['border-white/5', 'border-border'],
  ['border-slate-800', 'border-border'],
  ['border-slate-700', 'border-border'],
  ['border-slate-600', 'border-border'],
  ['border-slate-200', 'border-border'],
  ['ring-slate-800', 'ring-border'],
  ['ring-2 ring-slate-800', 'ring-2 ring-border'],

  // Buttons on primary often used text-foreground after white→foreground — fix common pattern
  ['bg-primary text-foreground', 'bg-primary text-primary-foreground'],
  ['bg-success text-foreground', 'bg-success text-success-foreground'],
  ['bg-destructive text-foreground', 'bg-destructive text-destructive-foreground'],
  ['bg-accent text-foreground', 'bg-accent text-accent-foreground'],

  // Avatar palette chips
  ["'bg-rose-500'", "'bg-[hsl(var(--avatar-1))]'"],
  ["'bg-amber-500'", "'bg-[hsl(var(--avatar-2))]'"],
  ["'bg-emerald-500'", "'bg-[hsl(var(--avatar-3))]'"],
  ["'bg-sky-500'", "'bg-[hsl(var(--avatar-4))]'"],
  ["'bg-indigo-500'", "'bg-[hsl(var(--avatar-5))]'"],
  ["'bg-purple-500'", "'bg-[hsl(var(--avatar-6))]'"],
  ["'bg-pink-500'", "'bg-[hsl(var(--avatar-7))]'"],
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const st = fs.statSync(dir);
  if (st.isFile()) {
    out.push(dir);
    return out;
  }
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue;
    walk(path.join(dir, name), out);
  }
  return out;
}

const files = [];
for (const r of roots) {
  walk(r, files);
}
const targets = files.filter(f => /\.(tsx?|jsx?|html|css)$/.test(f) && !f.includes('migrate-design-tokens'));

let changedFiles = 0;
let totalReplacements = 0;

for (const file of targets) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  let fileCount = 0;
  for (const [from, to] of replacements) {
    if (!from || from === to) continue;
    const parts = src.split(from);
    if (parts.length > 1) {
      fileCount += parts.length - 1;
      src = parts.join(to);
    }
  }
  if (src !== original) {
    fs.writeFileSync(file, src, 'utf8');
    changedFiles += 1;
    totalReplacements += fileCount;
    console.log(`updated ${file} (${fileCount})`);
  }
}

console.log(`\nDone. ${changedFiles} files, ~${totalReplacements} replacements.`);
