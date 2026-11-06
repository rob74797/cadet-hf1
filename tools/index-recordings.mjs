// Lists the audio files in public/recordings/ into public/recordings/index.json,
// which the radio reads to put real radio traffic on the band alongside its
// computer voices. Runs on every deploy (wrangler.jsonc "build"), so adding a
// recording is just uploading the file to that folder on GitHub.
//
// File names can start with a band to place it there, e.g. "40m-net-control.mp3"
// or "20m_dx-call.m4a". Anything else goes on whichever band has fewest.
// This script never fails the deploy: if anything goes wrong it writes an empty list.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/recordings';
const AUDIO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac)$/i;
const BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m'];
const MAX_BYTES = 8 * 1024 * 1024;   // skip anything over 8 MB
const MAX_FILES = 40;

let files = [];
try {
  files = readdirSync(DIR)
    .filter(f => AUDIO.test(f) && !f.startsWith('.'))
    .filter(f => { try { return statSync(join(DIR, f)).size <= MAX_BYTES; } catch { return false; } })
    .sort()
    .slice(0, MAX_FILES)
    .map(f => {
      const m = /^(\d{2,3}m)[-_ ]/i.exec(f);
      const band = m && BANDS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : 'any';
      return { file: f, band };
    });
} catch (err) {
  console.warn('recordings: could not read', DIR, String(err && err.message || err));
}
try {
  writeFileSync(join(DIR, 'index.json'), JSON.stringify({ made: new Date().toISOString(), files }, null, 1) + '\n');
  console.log('recordings: listed', files.length, 'file(s)');
} catch (err) {
  console.warn('recordings: could not write index.json', String(err && err.message || err));
}
