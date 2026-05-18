import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readOptionValue } from './release-notes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'lyy1010e/ServicePilot';
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const dryRun = args.has('--dry-run');
const skipBuild = args.has('--skip-build');
const notesFile = readOptionValue(rawArgs, '--notes-file');

if (args.has('--help') || args.has('-h')) {
  printHelp();
  process.exit(0);
}

await loadLocalReleaseEnv();

const tauriConfig = JSON.parse(await readFile(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const cargoToml = await readFile(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
const version = tauriConfig.version;
const tag = `v${version}`;
const artifactName = `ServicePilot_${version}_x64-setup.exe`;
const artifactDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const artifacts = [
  path.join(artifactDir, artifactName),
  path.join(artifactDir, `${artifactName}.sig`),
  path.join(artifactDir, 'latest.json')
];
const releaseNotesArtifact = path.join(artifactDir, 'release-notes.md');
const releaseTarget = await output('git', ['rev-parse', 'HEAD']);

assertVersionSync(version, packageJson.version, cargoToml);

if (!dryRun && !skipBuild && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
  throw new Error(
    'TAURI_SIGNING_PRIVATE_KEY is required before building updater artifacts. Set it in the shell or in .env.release.local.'
  );
}

await run('git', ['diff', '--quiet']);
await run('git', ['diff', '--cached', '--quiet']);
await assertCommandAvailable(
  'gh',
  'GitHub CLI is required to create or update releases. Install it, then run `gh auth login`.'
);

if (!skipBuild) {
  await run('npm', ['run', 'build']);
}

await run('npm', ['run', 'release:manifest', ...(notesFile ? ['--', '--notes-file', notesFile] : [])]);
if (!dryRun) {
  for (const artifact of [...artifacts, releaseNotesArtifact]) {
    await access(artifact);
  }
}

await run('gh', ['auth', 'status']);

if (dryRun) {
  console.log(`[dry-run] gh release view ${tag} --repo ${repository}`);
  console.log(`[dry-run] If ${tag} exists: gh release upload ${tag} ${artifacts.join(' ')} --repo ${repository} --clobber`);
  console.log(`[dry-run] If ${tag} exists: gh release edit ${tag} --repo ${repository} --notes-file ${releaseNotesArtifact}`);
  console.log(`[dry-run] If ${tag} does not exist: gh release create ${tag} ${artifacts.join(' ')} --repo ${repository} --target ${releaseTarget} --title "ServicePilot ${version}" --notes-file ${releaseNotesArtifact}`);
} else if (await commandSucceeds('gh', ['release', 'view', tag, '--repo', repository])) {
  await run('gh', ['release', 'edit', tag, '--repo', repository, '--notes-file', releaseNotesArtifact]);
  await run('gh', ['release', 'upload', tag, ...artifacts, '--repo', repository, '--clobber']);
} else {
  await run('gh', [
    'release',
    'create',
    tag,
    ...artifacts,
    '--repo',
    repository,
    '--target',
    releaseTarget,
    '--title',
    `ServicePilot ${version}`,
    '--notes-file',
    releaseNotesArtifact
  ]);
}

console.log(`Release ${tag} is ready: https://github.com/${repository}/releases/tag/${tag}`);

function assertVersionSync(tauriVersion, npmVersion, cargoText) {
  if (npmVersion !== tauriVersion) {
    throw new Error(`package.json version ${npmVersion} does not match tauri.conf.json version ${tauriVersion}.`);
  }
  if (!cargoText.includes(`version = "${tauriVersion}"`)) {
    throw new Error(`src-tauri/Cargo.toml does not contain version = "${tauriVersion}".`);
  }
}

async function loadLocalReleaseEnv() {
  const envPath = path.join(root, '.env.release.local');
  let envText = '';
  try {
    envText = await readFile(envPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(equalsIndex + 1).trim());
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  await loadEnvFileValue('TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_FILE');
  await loadEnvFileValue('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD_FILE');
}

async function loadEnvFileValue(targetKey, fileKey) {
  if (process.env[targetKey] || !process.env[fileKey]) {
    return;
  }

  const filePath = path.isAbsolute(process.env[fileKey])
    ? process.env[fileKey]
    : path.join(root, process.env[fileKey]);
  process.env[targetKey] = (await readFile(filePath, 'utf8')).trim();
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function commandSucceeds(command, commandArgs) {
  try {
    await run(command, commandArgs, { quiet: true });
    return true;
  } catch {
    return false;
  }
}

async function assertCommandAvailable(command, message) {
  try {
    await run(command, ['--version'], { quiet: true });
  } catch {
    throw new Error(message);
  }
}

async function run(command, commandArgs, options = {}) {
  const label = [command, ...commandArgs].join(' ');
  if (dryRun) {
    console.log(`[dry-run] ${label}`);
    return;
  }
  if (!options.quiet) {
    console.log(`> ${label}`);
  }

  await new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), commandArgs, {
      cwd: root,
      env: process.env,
      shell: shouldUseShell(command),
      stdio: options.quiet ? 'ignore' : 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}.`));
    });
  });
}

async function output(command, commandArgs) {
  const label = [command, ...commandArgs].join(' ');
  if (dryRun) {
    console.log(`[dry-run] ${label}`);
    return 'HEAD';
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), commandArgs, {
      cwd: root,
      env: process.env,
      shell: shouldUseShell(command),
      stdio: ['ignore', 'pipe', 'inherit']
    });

    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}.`));
    });
  });
}

function resolveCommand(command) {
  return command;
}

function shouldUseShell(command) {
  return process.platform === 'win32' && (command === 'npm' || command === 'npx');
}

function printHelp() {
  console.log(`Usage: npm run release:update -- [--dry-run] [--skip-build]

Builds signed updater artifacts, generates latest.json, and creates or updates
the GitHub release for the current tauri.conf.json version.

Requirements:
  - GitHub CLI authenticated with access to ${repository}
  - TAURI_SIGNING_PRIVATE_KEY set in the shell or .env.release.local when building artifacts

Options:
  --dry-run              Print commands without running them
  --skip-build           Reuse existing bundle artifacts and only regenerate/upload
  --notes-file <path>    Use a specific Markdown release notes file`);
}
