import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

  return {
    notes: `ServicePilot ${version}`,
    source: null
  };
}

export async function writeReleaseNotesArtifact(artifactDir, notes) {
  await mkdir(artifactDir, { recursive: true });
  const outputPath = path.join(artifactDir, 'release-notes.md');
  await writeFile(outputPath, `${notes.trim()}\n`, 'utf8');
  return outputPath;
}
