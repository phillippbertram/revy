import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import { simpleGit } from 'simple-git'
import type {
  ChangeSource,
  FileChange,
  FileChangeStatus,
  RepositoryPreferences,
  RepositorySnapshot,
} from '../shared/contracts.js'
import { createLogger } from './logger.js'

const logger = createLogger('git')

const instructionCandidates = [
  '.agents/skills/code-review/SKILL.md',
  '.agents/skills/review-pull-request/SKILL.md',
  '.codex/skills/code-review/SKILL.md',
  '.codex/skills/review-pull-request/SKILL.md',
] as const

interface NameStatusEntry {
  path: string
  previousPath: string | null
  status: FileChangeStatus
}

function statusFromGit(value: string): FileChangeStatus {
  switch (value.at(0)) {
    case 'A':
      return 'added'
    case 'C':
      return 'copied'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'U':
      return 'conflicted'
    default:
      return 'modified'
  }
}

function parseNameStatus(output: string): NameStatusEntry[] {
  const tokens = output.split('\0').filter(Boolean)
  const entries: NameStatusEntry[] = []

  for (let index = 0; index < tokens.length; ) {
    const statusToken = tokens[index]
    const firstPath = tokens[index + 1]
    if (!statusToken || !firstPath) {
      break
    }

    if (statusToken.startsWith('R') || statusToken.startsWith('C')) {
      const secondPath = tokens[index + 2]
      if (!secondPath) {
        break
      }
      entries.push({
        path: secondPath,
        previousPath: firstPath,
        status: statusFromGit(statusToken),
      })
      index += 3
    } else {
      entries.push({ path: firstPath, previousPath: null, status: statusFromGit(statusToken) })
      index += 2
    }
  }

  return entries
}

function mergeStatus(current: FileChangeStatus, next: FileChangeStatus): FileChangeStatus {
  const priority: FileChangeStatus[] = [
    'modified',
    'copied',
    'renamed',
    'added',
    'deleted',
    'conflicted',
    'untracked',
  ]
  return priority.indexOf(next) > priority.indexOf(current) ? next : current
}

export class GitService {
  async resolveRepository(selectedPath: string): Promise<string> {
    logger.debug('Resolving repository', { selectedPath })
    const candidate = await realpath(selectedPath)
    const candidateBare = (await this.run(['rev-parse', '--is-bare-repository'], candidate)).trim()
    if (candidateBare === 'true') {
      throw new Error('Bare repositories are not supported.')
    }
    const root = (await this.run(['rev-parse', '--show-toplevel'], candidate)).trim()
    const bare = (await this.run(['rev-parse', '--is-bare-repository'], root)).trim()
    if (bare === 'true') {
      throw new Error('Bare repositories are not supported.')
    }
    return realpath(root)
  }

  async inspect(
    root: string,
    preferences: RepositoryPreferences,
    requestedBaseBranch?: string,
  ): Promise<RepositorySnapshot> {
    const canonicalRoot = await this.resolveRepository(root)
    const branch = await this.optional(
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      canonicalRoot,
    )
    const headSha = await this.optional(['rev-parse', '--verify', 'HEAD'], canonicalRoot)
    const branches = await this.listBranches(canonicalRoot)
    const detectedBaseBranch = await this.detectBaseBranch(canonicalRoot, branches)
    const preferredBase = requestedBaseBranch ?? preferences.baseBranch ?? detectedBaseBranch
    const baseBranch =
      preferredBase && branches.includes(preferredBase) ? preferredBase : detectedBaseBranch
    const files = await this.collectChanges(canonicalRoot, baseBranch, headSha)
    const status = await this.run(['status', '--porcelain=v2', '-z', '--branch'], canonicalRoot)
    const fingerprint = createHash('sha256')
      .update(headSha ?? 'unborn')
      .update('\0')
      .update(status)
      .digest('hex')
    const detectedInstructionFiles = await this.findInstructionFiles(canonicalRoot)
    const instructionFiles = preferences.instructionFile
      ? [...new Set([...detectedInstructionFiles, preferences.instructionFile])]
      : detectedInstructionFiles
    const selectedInstructionFile = preferences.instructionFile
      ? preferences.instructionFile
      : detectedInstructionFiles.length === 1
        ? (detectedInstructionFiles[0] ?? null)
        : null

    const repository = {
      baseBranch,
      branches,
      branch: branch || null,
      files,
      fingerprint,
      headSha: headSha || null,
      instructionFiles,
      name: basename(canonicalRoot),
      preferences: {
        baseBranch,
        instructionFile: selectedInstructionFile,
        workflowId: preferences.workflowId,
      },
      root: canonicalRoot,
    }
    logger.info('Repository inspected', {
      changeCount: repository.files.length,
      repositoryName: repository.name,
    })
    return repository
  }

  async isGitAvailable(): Promise<boolean> {
    try {
      await simpleGit({
        baseDir: process.cwd(),
        maxConcurrentProcesses: 1,
        timeout: { block: 15_000 },
      }).version()
      return true
    } catch {
      logger.warn('System Git is unavailable')
      return false
    }
  }

  private async listBranches(root: string): Promise<string[]> {
    const output = await this.run(
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
      root,
    )
    return [
      ...new Set(
        output
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ]
      .filter((value) => !value.endsWith('/HEAD'))
      .sort((left, right) => left.localeCompare(right))
  }

  private async detectBaseBranch(root: string, branches: string[]): Promise<string | null> {
    const remoteHead = await this.optional(
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      root,
    )
    if (remoteHead && branches.includes(remoteHead)) {
      return remoteHead
    }

    for (const candidate of ['main', 'origin/main', 'master', 'origin/master']) {
      if (branches.includes(candidate)) {
        return candidate
      }
    }
    return branches[0] ?? null
  }

  private async collectChanges(
    root: string,
    baseBranch: string | null,
    headSha: string | null,
  ): Promise<FileChange[]> {
    const changes = new Map<string, FileChange>()
    const addEntries = (entries: NameStatusEntry[], source: ChangeSource): void => {
      for (const entry of entries) {
        const current = changes.get(entry.path)
        if (current) {
          current.status = mergeStatus(current.status, entry.status)
          if (!current.sources.includes(source)) {
            current.sources.push(source)
          }
          current.previousPath ??= entry.previousPath
        } else {
          changes.set(entry.path, {
            path: entry.path,
            previousPath: entry.previousPath,
            sources: [source],
            status: entry.status,
          })
        }
      }
    }

    if (baseBranch && headSha) {
      const mergeBase = await this.optional(['merge-base', baseBranch, 'HEAD'], root)
      if (mergeBase) {
        const output = await this.run(
          ['diff', '--name-status', '-z', '--find-renames', `${mergeBase}..HEAD`],
          root,
        )
        addEntries(parseNameStatus(output), 'branch')
      }
    }

    addEntries(
      parseNameStatus(
        await this.run(['diff', '--cached', '--name-status', '-z', '--find-renames'], root),
      ),
      'staged',
    )
    addEntries(
      parseNameStatus(await this.run(['diff', '--name-status', '-z', '--find-renames'], root)),
      'unstaged',
    )

    const untracked = (await this.run(['ls-files', '--others', '--exclude-standard', '-z'], root))
      .split('\0')
      .filter(Boolean)
    for (const path of untracked) {
      changes.set(path, {
        path,
        previousPath: null,
        sources: ['untracked'],
        status: 'untracked',
      })
    }

    return [...changes.values()].sort((left, right) => left.path.localeCompare(right.path))
  }

  private async findInstructionFiles(root: string): Promise<string[]> {
    const trackedFiles = new Set(
      (await this.run(['ls-files', '-co', '--exclude-standard', '-z'], root))
        .split('\0')
        .filter(Boolean),
    )
    return instructionCandidates.filter((candidate) => trackedFiles.has(candidate))
  }

  private async optional(args: string[], cwd: string): Promise<string | null> {
    try {
      return (await this.run(args, cwd)).trim() || null
    } catch {
      return null
    }
  }

  private async run(args: string[], cwd: string): Promise<string> {
    logger.debug('Running read-only Git operation', { command: args[0], cwd })
    const git = simpleGit({
      baseDir: cwd,
      maxConcurrentProcesses: 1,
      timeout: { block: 15_000 },
      trimmed: false,
    }).env('GIT_OPTIONAL_LOCKS', '0')

    try {
      const output = await git.raw(args)
      if (Buffer.byteLength(output) > 8 * 1024 * 1024) {
        throw new Error('The repository response is too large to inspect safely.')
      }
      return output
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Git could not inspect this repository.'
      throw new Error(message, { cause: error })
    }
  }
}
