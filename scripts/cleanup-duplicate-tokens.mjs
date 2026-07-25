import fs from 'fs';
import path from 'path';

function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) {
      if (!['node_modules', 'dist', 'coverage'].includes(n.name)) walk(p, out);
    } else if (/\.tsx?$/.test(n.name)) out.push(p);
  }
  return out;
}

const files = ['App.tsx', ...walk('components')];
let fixed = 0;

for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  const o = s;

  // Collapse exact consecutive duplicates of common tokens
  const tokens = [
    'border-border',
    'text-foreground',
    'text-muted-foreground',
    'bg-background',
    'bg-card',
    'bg-muted',
    'bg-primary',
    'bg-card/95',
    'bg-card/60',
    'bg-card/50',
    'bg-overlay/70',
    'bg-overlay/60',
    'bg-overlay/40',
    'hover:bg-muted',
    'hover:bg-foreground/10',
  ];
  for (const t of tokens) {
    const re = new RegExp(`(?:${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+)+${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
    s = s.replace(re, t);
  }

  // Prefer single glass / overlay values when both light+dark remnants remain
  s = s.replace(/bg-card\/95\s+bg-card\/60/g, 'bg-card/95');
  s = s.replace(/bg-card\/60\s+bg-card\/95/g, 'bg-card/95');
  s = s.replace(/bg-overlay\/40\s+bg-overlay\/70/g, 'bg-overlay/60');
  s = s.replace(/bg-overlay\/70\s+bg-overlay\/40/g, 'bg-overlay/60');
  s = s.replace(/hover:bg-muted\s+hover:bg-foreground\/10/g, 'hover:bg-muted');
  s = s.replace(/hover:bg-secondary\s+hover:bg-foreground\/10/g, 'hover:bg-muted');
  s = s.replace(/text-foreground\s+text-foreground/g, 'text-foreground');
  s = s.replace(/text-muted-foreground\s+text-muted-foreground/g, 'text-muted-foreground');
  s = s.replace(/border-border\s+border-border/g, 'border-border');

  // Primary buttons should use primary-foreground
  s = s.replace(/bg-primary([^\n"']*)\stext-foreground/g, 'bg-primary$1 text-primary-foreground');
  s = s.replace(/bg-success([^\n"']*)\stext-foreground/g, 'bg-success$1 text-success-foreground');
  s = s.replace(/bg-destructive([^\n"']*)\stext-foreground/g, 'bg-destructive$1 text-destructive-foreground');

  if (s !== o) {
    fs.writeFileSync(f, s);
    fixed++;
    console.log('cleaned', f);
  }
}
console.log('files cleaned', fixed);
