/**
 * Fail a Play Store / release build if Capacitor is still pointed at a
 * live-reload LAN URL (CAPACITOR_DEV_SERVER_URL). That config would make
 * the AAB try to load http://192.168.x.x instead of bundled dist/.
 */
import fs from 'fs';
import path from 'path';

const configPath = path.resolve('android/app/src/main/assets/capacitor.config.json');

if (!fs.existsSync(configPath)) {
  console.error('[release] Missing', configPath, '— run `npx cap sync android` first.');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const serverUrl = cfg?.server?.url;

if (serverUrl) {
  console.error(
    '[release] capacitor.config.json has server.url =',
    serverUrl,
    '\nUnset CAPACITOR_DEV_SERVER_URL and run `npx cap sync android` before a Play Store build.'
  );
  process.exit(1);
}

if (process.env.CAPACITOR_DEV_SERVER_URL) {
  console.error(
    '[release] CAPACITOR_DEV_SERVER_URL is set in the environment. Unset it for release.'
  );
  process.exit(1);
}

console.log('[release] Capacitor config is production-safe (no live-reload URL).');

const keystoreProps = path.resolve('android/keystore.properties');
if (!fs.existsSync(keystoreProps)) {
  console.error(
    '[release] Missing android/keystore.properties.\n' +
      'Run:  npm run android:keystore\n' +
      'That creates the Play signing key (once) and the local config file.'
  );
  process.exit(1);
}

const props = fs.readFileSync(keystoreProps, 'utf8');
const storeLine = props.split(/\r?\n/).find((l) => l.startsWith('storeFile='));
const storeName = storeLine ? storeLine.slice('storeFile='.length).trim() : '';
const storePath = path.resolve('android', storeName || 'kharch-baant-release.keystore');
if (!storeName || !fs.existsSync(storePath)) {
  console.error('[release] Keystore file not found at', storePath);
  process.exit(1);
}

console.log('[release] Signing config found.');
