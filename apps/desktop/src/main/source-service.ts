import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SourcePreview } from '../shared/contracts.js'

const maximumSourceBytes = 2 * 1024 * 1024
const maximumInstructionBytes = 256 * 1024

function isOutsideRepository(relativePath: string): boolean {
  return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)
}

function validateRelativePath(path: string): void {
  if (
    path.length === 0 ||
    path.includes('\0') ||
    isAbsolute(path) ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    path.split(/[\\/]/).includes('..')
  ) {
    throw new Error('The code reference must use a safe repository-relative path.')
  }
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0)
}

export class SourceService {
  async readPreview(
    repositoryRoot: string,
    path: string,
    line: number,
    requestedEndLine: number | undefined,
    stale: boolean,
  ): Promise<SourcePreview> {
    const filePath = await this.resolveFile(repositoryRoot, path, maximumSourceBytes)
    const content = await readFile(filePath)
    if (looksBinary(content)) {
      throw new Error('Binary files cannot be opened in the source preview.')
    }

    const lines = content.toString('utf8').split(/\r?\n/)
    const targetLine = Math.min(line, Math.max(lines.length, 1))
    const targetEndLine = Math.min(
      Math.max(requestedEndLine ?? targetLine, targetLine),
      Math.max(lines.length, 1),
    )
    const startLine = Math.max(1, targetLine - 60)
    const endLine = Math.min(Math.max(lines.length, 1), targetEndLine + 60)

    return {
      content: lines.slice(startLine - 1, endLine).join('\n'),
      endLine,
      path,
      stale,
      startLine,
      targetEndLine,
      targetLine,
    }
  }

  async readInstruction(repositoryRoot: string, path: string): Promise<string> {
    if (!path.toLowerCase().endsWith('.md')) {
      throw new Error('Review instructions must be a Markdown file.')
    }
    const filePath = await this.resolveFile(repositoryRoot, path, maximumInstructionBytes)
    const content = await readFile(filePath)
    if (looksBinary(content)) {
      throw new Error('Review instructions must be a text file.')
    }
    return content.toString('utf8')
  }

  async toRepositoryRelativeMarkdown(
    repositoryRoot: string,
    selectedPath: string,
  ): Promise<string> {
    const canonicalRoot = await realpath(repositoryRoot)
    const canonicalFile = await realpath(selectedPath)
    const relativePath = relative(canonicalRoot, canonicalFile)
    if (isOutsideRepository(relativePath)) {
      throw new Error('Review instructions must be inside the selected repository.')
    }
    await this.readInstruction(repositoryRoot, relativePath)
    return relativePath.split(sep).join('/')
  }

  private async resolveFile(
    repositoryRoot: string,
    relativePath: string,
    maximumBytes: number,
  ): Promise<string> {
    validateRelativePath(relativePath)
    const canonicalRoot = await realpath(repositoryRoot)
    const candidate = resolve(canonicalRoot, relativePath)
    const candidateRelativePath = relative(canonicalRoot, candidate)
    if (isOutsideRepository(candidateRelativePath)) {
      throw new Error('The requested file is outside the selected repository.')
    }

    let canonicalFile: string
    try {
      canonicalFile = await realpath(candidate)
    } catch {
      throw new Error('The referenced file no longer exists.')
    }
    if (isOutsideRepository(relative(canonicalRoot, canonicalFile))) {
      throw new Error('The referenced symlink leaves the selected repository.')
    }

    const fileStats = await stat(canonicalFile)
    if (!fileStats.isFile()) {
      throw new Error('The code reference does not point to a file.')
    }
    if (fileStats.size > maximumBytes) {
      throw new Error('The referenced file is too large to open safely.')
    }
    return canonicalFile
  }
}
