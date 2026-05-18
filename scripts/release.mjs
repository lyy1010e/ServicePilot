import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
const releaseNotesPath = path.join(root, 'docs', 'releases', `v${version}.md`);

if (!version) {
  console.error('用法: node scripts/release.mjs <版本号>');
  console.error('例如: node scripts/release.mjs 1.0.4');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`版本号格式错误: ${version}，应为 x.y.z`);
  process.exit(1);
}

console.log(`==> 更新版本号到 ${version}`);

await updateJson(path.join(root, 'package.json'), (json) => {
  json.version = version;
  return json;
});

await updateCargoVersion(path.join(root, 'src-tauri', 'Cargo.toml'), version);

await updateJson(path.join(root, 'src-tauri', 'tauri.conf.json'), (json) => {
  json.version = version;
  return json;
});

console.log('==> 提交并推送');
const filesToCommit = ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json'];
if (await fileExists(releaseNotesPath)) {
  filesToCommit.push(path.relative(root, releaseNotesPath));
}
await run('git', ['add', ...filesToCommit]);
await run('git', ['commit', '-m', `release: v${version}`]);
await run('git', ['push', 'origin', 'master']);

console.log('==> 打 tag 触发自动发布');
await run('git', ['tag', `v${version}`]);
await run('git', ['push', 'origin', `v${version}`]);

console.log('');
console.log(`Done! v${version} 已推送，GitHub Actions 正在构建发布。`);
console.log('查看进度: https://github.com/lyy1010e/ServicePilot/actions');

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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
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
