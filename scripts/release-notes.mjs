import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

export function readOptionValue(args, name) {
  const equalsPrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(equalsPrefix)) {
      return arg.slice(equalsPrefix.length);
    }
    if (arg === name) {
      return args[index + 1] ?? '';
    }
  }
  return null;
}

export function getReleaseNotesCandidates(root, version) {
  return [
    path.join(root, 'docs', 'releases', `v${version}.md`),
    path.join(root, 'docs', 'releases', `${version}.md`),
    path.join(root, 'RELEASE_NOTES.md')
  ];
}

export function getVersionReleaseNotesPath(root, version) {
  return path.join(root, 'docs', 'releases', `v${version}.md`);
}

export async function ensureVersionReleaseNotes(root, version, options = {}) {
  const outputPath = options.outputPath ?? getVersionReleaseNotesPath(root, version);

  try {
    const notes = (await readFile(outputPath, 'utf8')).trim();
    if (notes) {
      return {
        notes,
        source: path.relative(root, outputPath),
        generated: false
      };
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const generated = await generateReleaseNotes(root, version, options);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${generated.notes.trim()}\n`, 'utf8');
  return {
    notes: generated.notes,
    source: path.relative(root, outputPath),
    generated: true
  };
}

export async function readReleaseNotes(root, version, explicitPath = null) {
  const candidates = explicitPath
    ? [path.isAbsolute(explicitPath) ? explicitPath : path.join(root, explicitPath)]
    : getReleaseNotesCandidates(root, version);

  for (const candidate of candidates) {
    try {
      const notes = (await readFile(candidate, 'utf8')).trim();
      if (notes) {
        return {
          notes,
          source: path.relative(root, candidate)
        };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      if (explicitPath) {
        throw new Error(`Release notes file not found: ${explicitPath}`);
      }
    }
  }

  const generated = await generateReleaseNotes(root, version);
  return {
    notes: generated.notes,
    source: generated.source
  };
}

export async function writeReleaseNotesArtifact(artifactDir, notes) {
  await mkdir(artifactDir, { recursive: true });
  const outputPath = path.join(artifactDir, 'release-notes.md');
  await writeFile(outputPath, `${notes.trim()}\n`, 'utf8');
  return outputPath;
}

async function generateReleaseNotes(root, version, options = {}) {
  const targetRef = options.targetRef ?? 'HEAD';
  const currentTag = `v${version}`;
  const previousTag = await findPreviousVersionTag(root, version);
  const range = previousTag ? `${previousTag}..${targetRef}` : targetRef;
  const subjects = (await gitLines(root, ['log', '--format=%s', '--no-merges', range]))
    .filter((subject) => subject && !isReleaseCommit(subject, currentTag));
  const notes = renderReleaseNotes(version, subjects);
  const source = previousTag
    ? `generated from git history (${previousTag}..${targetRef})`
    : `generated from git history (${targetRef})`;

  return { notes, source };
}

async function findPreviousVersionTag(root, version) {
  const tags = await gitLines(root, ['tag', '--sort=-v:refname', '--list', 'v[0-9]*.[0-9]*.[0-9]*']);
  return tags.find((tag) => tag !== `v${version}` && compareVersions(tag.slice(1), version) < 0) ?? null;
}

function renderReleaseNotes(version, subjects) {
  const groups = [
    { heading: 'New', items: [] },
    { heading: 'Fixed', items: [] },
    { heading: 'Improved', items: [] },
    { heading: 'Maintenance', items: [] }
  ];

  for (const subject of subjects) {
    const normalized = normalizeSubject(subject);
    if (/^feat(?:\(.+\))?!?:/i.test(subject)) {
      groups[0].items.push(normalized);
    } else if (/^fix(?:\(.+\))?!?:/i.test(subject)) {
      groups[1].items.push(normalized);
    } else if (/^(perf|refactor|style|docs)(?:\(.+\))?!?:/i.test(subject)) {
      groups[2].items.push(normalized);
    } else {
      groups[3].items.push(normalized);
    }
  }

  const sections = groups
    .filter((group) => group.items.length > 0)
    .map((group) => `## ${group.heading}\n\n${group.items.map((item) => `- ${item}`).join('\n')}`);

  if (!sections.length) {
    sections.push('## Changed\n\n- Maintenance release.');
  }

  return `# ServicePilot ${version}\n\n${sections.join('\n\n')}`;
}

function normalizeSubject(subject) {
  const withoutPrefix = subject.replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, '').trim();
  if (!withoutPrefix) {
    return subject;
  }
  return `${withoutPrefix[0].toUpperCase()}${withoutPrefix.slice(1)}`;
}

function isReleaseCommit(subject, currentTag) {
  return subject === `release: ${currentTag}` || subject === `release ${currentTag}`;
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function parseVersion(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

async function gitLines(root, args) {
  try {
    const output = await gitOutput(root, args);
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function gitOutput(root, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with exit code ${code}.`));
    });
  });
}
