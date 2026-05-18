import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOptionValue, readReleaseNotes, writeReleaseNotesArtifact } from './release-notes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const notesFile = readOptionValue(process.argv.slice(2), '--notes-file');
const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const tauriConfig = JSON.parse(await readFile(tauriConfigPath, 'utf8'));
const version = tauriConfig.version;
const artifactName = `ServicePilot_${version}_x64-setup.exe`;
const artifactDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const signature = (await readFile(path.join(artifactDir, `${artifactName}.sig`), 'utf8')).trim();
const repository = 'lyy1010e/ServicePilot';
const tag = `v${version}`;
const releaseNotes = await readReleaseNotes(root, version, notesFile);

const manifest = {
  version,
  notes: releaseNotes.notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${repository}/releases/download/${tag}/${artifactName}`
    }
  }
};

await mkdir(artifactDir, { recursive: true });
await writeFile(path.join(artifactDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeReleaseNotesArtifact(artifactDir, releaseNotes.notes);

if (releaseNotes.source) {
  console.log(`Release notes: ${releaseNotes.source}`);
} else {
  console.log('Release notes: default generated text');
}
