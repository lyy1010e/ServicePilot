import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ensureVersionReleaseNotes } from './release-notes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/release.mjs <version>');
  console.error('Example: node scripts/release.mjs 1.0.4');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version: ${version}. Expected x.y.z.`);
  process.exit(1);
}

console.log(`==> Updating version to ${version}`);

await updateJson(path.join(root, 'package.json'), (json) => {
  json.version = version;
  return json;
});

await updateCargoVersion(path.join(root, 'src-tauri', 'Cargo.toml'), version);

await updateJson(path.join(root, 'src-tauri', 'tauri.conf.json'), (json) => {
  json.version = version;
  return json;
});

const releaseNotes = await ensureVersionReleaseNotes(root, version);
console.log(
  releaseNotes.generated
    ? `==> Generated ${releaseNotes.source}`
    : `==> Using ${releaseNotes.source}`
);

console.log('==> Committing and pushing');
const filesToCommit = ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json', releaseNotes.source];
await run('git', ['add', ...filesToCommit]);
await run('git', ['commit', '-m', `release: v${version}`]);
await run('git', ['push', 'origin', 'master']);

console.log('==> Creating tag to trigger release workflow');
await run('git', ['tag', `v${version}`]);
await run('git', ['push', 'origin', `v${version}`]);

console.log('');
console.log(`Done! v${version} was pushed and GitHub Actions is building the release.`);
console.log('Progress: https://github.com/lyy1010e/ServicePilot/actions');

async function updateJson(filePath, transform) {
  const content = JSON.parse(await readFile(filePath, 'utf8'));
  const updated = transform(content);
  await writeFile(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
}

async function updateCargoVersion(filePath, ver) {
  let content = await readFile(filePath, 'utf8');
  content = content.replace(/^version = "[^"]*"/m, `version = "${ver}"`);
  await writeFile(filePath, content, 'utf8');
}

async function run(cmd, args) {
  console.log(`  ${cmd} ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}
