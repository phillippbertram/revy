import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import { z } from 'zod'
import type { InitializeParams } from '../generated/codex-app-server/InitializeParams.js'
import type { GetAccountParams } from '../generated/codex-app-server/v2/GetAccountParams.js'
import type { GetAccountResponse } from '../generated/codex-app-server/v2/GetAccountResponse.js'
import type { ItemCompletedNotification } from '../generated/codex-app-server/v2/ItemCompletedNotification.js'
import type { Model } from '../generated/codex-app-server/v2/Model.js'
import type { ModelListParams } from '../generated/codex-app-server/v2/ModelListParams.js'
import type { ModelListResponse } from '../generated/codex-app-server/v2/ModelListResponse.js'
import type { ReviewStartParams } from '../generated/codex-app-server/v2/ReviewStartParams.js'
import type { ReviewStartResponse } from '../generated/codex-app-server/v2/ReviewStartResponse.js'
import type { ThreadStartParams } from '../generated/codex-app-server/v2/ThreadStartParams.js'
import type { ThreadStartResponse } from '../generated/codex-app-server/v2/ThreadStartResponse.js'
import type { TurnCompletedNotification } from '../generated/codex-app-server/v2/TurnCompletedNotification.js'
import type { TurnInterruptParams } from '../generated/codex-app-server/v2/TurnInterruptParams.js'
import type { TurnStartedNotification } from '../generated/codex-app-server/v2/TurnStartedNotification.js'
import type { AgentActivityEntry, AgentStatus, CodexModel } from '../shared/contracts.js'
import { createLogger, logError } from './logger.js'

const logger = createLogger('codex')

const requestIdSchema = z.union([z.string(), z.number().int()])
const rpcErrorSchema = z.looseObject({
  code: z.number().int(),
  data: z.unknown().optional(),
  message: z.string(),
})
const rpcMessageSchema = z.looseObject({
  error: rpcErrorSchema.optional(),
  id: requestIdSchema.optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
})

const accountSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('apiKey') }),
  z.looseObject({
    email: z.string().nullable(),
    planType: z.string(),
    type: z.literal('chatgpt'),
  }),
  z.looseObject({
    type: z.literal('amazonBedrock'),
    usesCodexManagedCredentials: z.boolean(),
  }),
])
const accountResponseSchema = z.looseObject({
  account: accountSchema.nullable(),
  requiresOpenaiAuth: z.boolean(),
})
const modelResponseSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      defaultReasoningEffort: z.string().min(1),
      displayName: z.string().min(1),
      hidden: z.boolean(),
      id: z.string().min(1),
      isDefault: z.boolean(),
      supportedReasoningEfforts: z.array(
        z.looseObject({ description: z.string(), reasoningEffort: z.string().min(1) }),
      ),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
})
const threadStartResponseSchema = z.looseObject({
  instructionSources: z.array(z.string()).optional(),
  thread: z.looseObject({ id: z.string().min(1) }),
})
const reviewStartResponseSchema = z.looseObject({
  reviewThreadId: z.string().min(1),
  turn: z.looseObject({ id: z.string().min(1) }),
})
const itemCompletedSchema = z.looseObject({
  item: z.looseObject({
    id: z.string(),
    review: z.string(),
    type: z.literal('exitedReviewMode'),
  }),
  threadId: z.string(),
  turnId: z.string(),
})
const itemNotificationSchema = z.looseObject({
  completedAtMs: z.number().optional(),
  item: z.unknown(),
  startedAtMs: z.number().optional(),
  threadId: z.string(),
  turnId: z.string(),
})
const itemBaseSchema = z.looseObject({ id: z.string().min(1), type: z.string().min(1) })
const commandActionSchema = z.looseObject({
  command: z.string(),
  name: z.string().optional(),
  path: z.string().nullable().optional(),
  type: z.enum(['read', 'listFiles', 'search', 'unknown']),
})
const commandItemSchema = z.looseObject({
  commandActions: z.array(commandActionSchema),
  cwd: z.string(),
  durationMs: z.number().int().nonnegative().nullable(),
  exitCode: z.number().int().nullable(),
  id: z.string().min(1),
  status: z.enum(['inProgress', 'completed', 'failed', 'declined']),
  type: z.literal('commandExecution'),
})
const fileChangeItemSchema = z.looseObject({
  changes: z.array(z.looseObject({ path: z.string() })),
  id: z.string().min(1),
  type: z.literal('fileChange'),
})
const mcpToolItemSchema = z.looseObject({
  durationMs: z.number().int().nonnegative().nullable(),
  id: z.string().min(1),
  server: z.string(),
  status: z.enum(['inProgress', 'completed', 'failed']),
  tool: z.string(),
  type: z.literal('mcpToolCall'),
})
const dynamicToolItemSchema = z.looseObject({
  durationMs: z.number().int().nonnegative().nullable(),
  id: z.string().min(1),
  namespace: z.string().nullable(),
  status: z.enum(['inProgress', 'completed', 'failed']),
  tool: z.string(),
  type: z.literal('dynamicToolCall'),
})
const collaborationItemSchema = z.looseObject({
  id: z.string().min(1),
  status: z.enum(['inProgress', 'completed', 'failed']),
  tool: z.enum(['spawnAgent', 'sendInput', 'resumeAgent', 'wait', 'closeAgent']),
  type: z.literal('collabAgentToolCall'),
})
const subagentItemSchema = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(['started', 'interacted', 'interrupted']),
  type: z.literal('subAgentActivity'),
})
const webSearchItemSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal('webSearch'),
})
const errorNotificationSchema = z.looseObject({
  threadId: z.string(),
  turnId: z.string(),
  willRetry: z.boolean(),
})
const turnCompletedSchema = z.looseObject({
  threadId: z.string(),
  turn: z.looseObject({
    completedAt: z.number().nullable().optional(),
    durationMs: z.number().int().nonnegative().nullable().optional(),
    error: z.looseObject({ message: z.string() }).nullable().optional(),
    id: z.string(),
    status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
  }),
})
const turnStartedSchema = z.looseObject({
  threadId: z.string(),
  turn: z.looseObject({ id: z.string().min(1), startedAt: z.number().nullable().optional() }),
})

type AccountResponseProjection = Pick<GetAccountResponse, 'account' | 'requiresOpenaiAuth'>
type ModelProjection = Pick<
  Model,
  | 'defaultReasoningEffort'
  | 'displayName'
  | 'hidden'
  | 'id'
  | 'isDefault'
  | 'supportedReasoningEfforts'
>
type ModelResponseProjection = Pick<ModelListResponse, 'nextCursor'> & { data: ModelProjection[] }
type ThreadResponseProjection = Pick<ThreadStartResponse, 'instructionSources'> & {
  thread: Pick<ThreadStartResponse['thread'], 'id'>
}
type ReviewResponseProjection = Pick<ReviewStartResponse, 'reviewThreadId'> & {
  turn: Pick<ReviewStartResponse['turn'], 'id'>
}
type ItemCompletedProjection = Pick<ItemCompletedNotification, 'threadId' | 'turnId'> & {
  item: { id: string; review: string; type: 'exitedReviewMode' }
}
type TurnCompletedProjection = Pick<TurnCompletedNotification, 'threadId'> & {
  turn: Pick<TurnCompletedNotification['turn'], 'id' | 'status'> & {
    completedAt?: number | null
    durationMs?: number | null
    error?: { message: string } | null
  }
}
type TurnStartedProjection = Pick<TurnStartedNotification, 'threadId'> & {
  turn: Pick<TurnStartedNotification['turn'], 'id'> & { startedAt?: number | null }
}

interface PendingRequest {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

interface ActiveReview {
  cancelInFlight: boolean
  cancelRequested: boolean
  completed: boolean
  instructionSources: string[]
  interruptTurnId: string | null
  markdown: string | null
  onActivity: (activity: BackendActivity) => void
  repositoryRoot: string
  reject: (error: Error) => void
  resolve: (value: BackendReviewResult) => void
  reviewTurnId: string | null
  threadId: string
}

export interface StartBackendReviewInput {
  model: string
  onActivity: (activity: BackendActivity) => void
  onProgress: (message: string) => void
  prompt: string
  reasoningEffort: string
  repositoryRoot: string
}

export type BackendActivity = Omit<AgentActivityEntry, 'runId' | 'sequence'>

export interface BackendReviewResult {
  instructionSources: string[]
  markdown: string
}

export interface ReviewBackend {
  cancel(): Promise<void>
  listModels(): Promise<CodexModel[]>
  probe(configuredExecutable: string | null): Promise<AgentStatus>
  startReview(input: StartBackendReviewInput): Promise<BackendReviewResult>
  stop(): Promise<void>
}

function protocolError(label: string, error: z.ZodError): Error {
  const detail = error.issues.at(0)?.message ?? 'unexpected response'
  return new Error(`The Codex App Server returned an unsupported ${label}: ${detail}`)
}

function parseProtocol<T>(schema: z.ZodType, value: unknown, label: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw protocolError(label, result.error)
  }
  return result.data as T
}

function timestampFromMilliseconds(value: number | undefined): string {
  const date = value && Number.isFinite(value) ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function timestampFromSeconds(value: number | null | undefined): string {
  const date = value && Number.isFinite(value) ? new Date(value * 1_000) : new Date()
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function safeName(value: string): string | null {
  const trimmed = value.trim().slice(0, 128)
  return trimmed || null
}

function commandName(command: string): string | null {
  const token = command.trim().match(/^[a-zA-Z0-9_./+-]+/)?.[0]
  return token ? safeName(basename(token)) : null
}

function repositoryPath(repositoryRoot: string, cwd: string, value: string): string | null {
  const absolute = isAbsolute(value) ? value : resolve(cwd, value)
  const candidate = relative(repositoryRoot, absolute)
  if (candidate === '') {
    return '.'
  }
  if (candidate === '..' || candidate.startsWith(`..${sep}`) || isAbsolute(candidate)) {
    return null
  }
  return candidate.split(sep).join('/')
}

function activityStatus(
  status: 'inProgress' | 'completed' | 'failed' | 'declined',
): AgentActivityEntry['status'] {
  if (status === 'inProgress') {
    return 'in-progress'
  }
  return status === 'completed' ? 'completed' : 'failed'
}

function commandTitle(actions: Array<z.infer<typeof commandActionSchema>>): string {
  const types = new Set(actions.map((action) => action.type))
  if (types.size > 1) {
    return 'Ran repository inspection.'
  }
  if (types.has('read')) {
    return 'Read a repository file.'
  }
  if (types.has('listFiles')) {
    return 'Listed repository files.'
  }
  if (types.has('search')) {
    return 'Searched the repository.'
  }
  return 'Ran a shell command.'
}

function activityFromItem(
  value: unknown,
  phase: 'started' | 'completed',
  occurredAt: string,
  repositoryRoot: string,
): BackendActivity | null {
  const base = itemBaseSchema.safeParse(value)
  if (!base.success) {
    logger.warn('Ignored an invalid Codex activity item')
    return null
  }

  if (base.data.type === 'commandExecution') {
    const parsed = commandItemSchema.safeParse(value)
    if (!parsed.success) {
      logger.warn('Ignored an invalid command activity item')
      return null
    }
    const names = [
      ...new Set(parsed.data.commandActions.map((action) => commandName(action.command))),
    ].filter((name): name is string => name !== null)
    const paths = [
      ...new Set(
        parsed.data.commandActions
          .map((action) =>
            action.path ? repositoryPath(repositoryRoot, parsed.data.cwd, action.path) : null,
          )
          .filter((path): path is string => path !== null),
      ),
    ].slice(0, 32)
    return {
      durationMs: parsed.data.durationMs,
      exitCode: parsed.data.exitCode,
      id: parsed.data.id,
      kind: 'command',
      name: safeName(names.join(', ')),
      occurredAt,
      paths,
      status: activityStatus(parsed.data.status),
      title: commandTitle(parsed.data.commandActions),
    }
  }

  if (base.data.type === 'fileChange') {
    const parsed = fileChangeItemSchema.safeParse(value)
    if (!parsed.success) {
      logger.warn('Ignored an invalid file-change activity item')
      return null
    }
    return {
      durationMs: null,
      exitCode: null,
      id: parsed.data.id,
      kind: 'warning',
      name: null,
      occurredAt,
      paths: parsed.data.changes
        .map((change) => repositoryPath(repositoryRoot, repositoryRoot, change.path))
        .filter((path): path is string => path !== null)
        .slice(0, 32),
      status: 'warning',
      title: 'Codex reported an unexpected file-change attempt.',
    }
  }

  if (base.data.type === 'mcpToolCall') {
    const parsed = mcpToolItemSchema.safeParse(value)
    if (!parsed.success) {
      logger.warn('Ignored an invalid MCP tool activity item')
      return null
    }
    return {
      durationMs: parsed.data.durationMs,
      exitCode: null,
      id: parsed.data.id,
      kind: 'tool',
      name: safeName(`${parsed.data.server}/${parsed.data.tool}`),
      occurredAt,
      paths: [],
      status: activityStatus(parsed.data.status),
      title: 'Used an external tool.',
    }
  }

  if (base.data.type === 'dynamicToolCall') {
    const parsed = dynamicToolItemSchema.safeParse(value)
    if (!parsed.success) {
      logger.warn('Ignored an invalid dynamic tool activity item')
      return null
    }
    const name = parsed.data.namespace
      ? `${parsed.data.namespace}/${parsed.data.tool}`
      : parsed.data.tool
    return {
      durationMs: parsed.data.durationMs,
      exitCode: null,
      id: parsed.data.id,
      kind: 'tool',
      name: safeName(name),
      occurredAt,
      paths: [],
      status: activityStatus(parsed.data.status),
      title: 'Used an agent tool.',
    }
  }

  if (base.data.type === 'collabAgentToolCall') {
    const parsed = collaborationItemSchema.safeParse(value)
    if (!parsed.success) {
      logger.warn('Ignored an invalid collaboration activity item')
      return null
    }
    return {
      durationMs: null,
      exitCode: null,
      id: parsed.data.id,
      kind: 'subagent',
      name: parsed.data.tool,
      occurredAt,
      paths: [],
      status: activityStatus(parsed.data.status),
      title: 'Coordinated agent work.',
    }
  }

  if (base.data.type === 'subAgentActivity') {
    const parsed = subagentItemSchema.safeParse(value)
    if (!parsed.success) {
      logger.warn('Ignored an invalid subagent activity item')
      return null
    }
    return {
      durationMs: null,
      exitCode: null,
      id: parsed.data.id,
      kind: 'subagent',
      name: null,
      occurredAt,
      paths: [],
      status:
        phase === 'started'
          ? 'in-progress'
          : parsed.data.kind === 'interrupted'
            ? 'interrupted'
            : 'completed',
      title:
        parsed.data.kind === 'started'
          ? 'Subagent started.'
          : parsed.data.kind === 'interacted'
            ? 'Subagent activity received.'
            : 'Subagent interrupted.',
    }
  }

  if (base.data.type === 'webSearch') {
    const parsed = webSearchItemSchema.safeParse(value)
    if (!parsed.success) {
      logger.warn('Ignored an invalid web-search activity item')
      return null
    }
    return {
      durationMs: null,
      exitCode: null,
      id: parsed.data.id,
      kind: 'web-search',
      name: null,
      occurredAt,
      paths: [],
      status: phase === 'started' ? 'in-progress' : 'completed',
      title: 'Searched the web.',
    }
  }

  logger.debug('Ignored unsupported Codex activity item', { itemType: base.data.type })
  return null
}

function accountLabel(account: z.infer<typeof accountSchema> | null | undefined): string | null {
  if (!account) {
    return null
  }
  if (account.type === 'apiKey') {
    return 'API key'
  }
  if (account.type === 'amazonBedrock') {
    return 'Amazon Bedrock'
  }
  return account.email ?? `ChatGPT ${account.planType}`
}

export class CodexAppServerBackend implements ReviewBackend {
  private activeReview: ActiveReview | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private executable: string | null = null
  private nextRequestId = 1
  private pending = new Map<number | string, PendingRequest>()
  private reader: Interface | null = null
  private stderrTail = ''
  private stopping = false
  private version: string | null = null

  async probe(configuredExecutable: string | null): Promise<AgentStatus> {
    const executable = await this.findExecutable(configuredExecutable)
    if (!executable) {
      return {
        accountLabel: null,
        error:
          'Codex was not found. Install and sign in with the Codex CLI, or choose its executable.',
        executable: configuredExecutable,
        models: [],
        state: 'unavailable',
        version: null,
      }
    }

    try {
      if (this.executable !== executable || !this.child) {
        await this.stop()
        this.executable = executable
        logger.debug('Using Codex executable', { executable })
        this.version = await this.readVersion(executable)
        await this.startServer(executable)
      }

      const accountParams: GetAccountParams = { refreshToken: false }
      const accountResult = parseProtocol<AccountResponseProjection>(
        accountResponseSchema,
        await this.request('account/read', accountParams),
        'account response',
      )
      const models = await this.listModels()
      const unauthenticated = accountResult.requiresOpenaiAuth && !accountResult.account
      const status: AgentStatus = {
        accountLabel: accountLabel(accountResult.account),
        error: unauthenticated
          ? 'Codex is not signed in. Run `codex login` in a terminal and retry.'
          : null,
        executable,
        models,
        state: unauthenticated ? 'unauthenticated' : 'ready',
        version: this.version,
      }
      logger.info('Codex connection ready', { modelCount: models.length })
      return status
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex could not be reached.'
      await this.stop()
      logError('codex', 'Codex probe failed', error)
      return {
        accountLabel: null,
        error: message,
        executable,
        models: [],
        state: 'error',
        version: this.version,
      }
    }
  }

  async listModels(): Promise<CodexModel[]> {
    const models: CodexModel[] = []
    let cursor: string | null = null
    do {
      const params: ModelListParams = { cursor, includeHidden: false, limit: 100 }
      const result = parseProtocol<ModelResponseProjection>(
        modelResponseSchema,
        await this.request('model/list', params),
        'model response',
      )
      models.push(
        ...result.data
          .filter((model) => !model.hidden)
          .map((model) => ({
            defaultReasoningEffort: model.defaultReasoningEffort,
            displayName: model.displayName,
            id: model.id,
            isDefault: model.isDefault,
            supportedReasoningEfforts: model.supportedReasoningEfforts.map((effort) => ({
              description: effort.description,
              reasoningEffort: effort.reasoningEffort,
            })),
          })),
      )
      cursor = result.nextCursor ?? null
    } while (cursor)
    return models
  }

  async startReview(input: StartBackendReviewInput): Promise<BackendReviewResult> {
    if (!this.child) {
      throw new Error('Codex is unavailable. Retry the connection from Settings.')
    }
    if (this.activeReview) {
      throw new Error('A review is already running.')
    }

    input.onProgress('Opening a read-only Codex review session…')
    logger.info('Starting Codex review session')
    logger.debug('Codex review repository', { repositoryRoot: input.repositoryRoot })
    const threadParams: ThreadStartParams = {
      approvalPolicy: 'never',
      config: { model_reasoning_effort: input.reasoningEffort },
      cwd: input.repositoryRoot,
      ephemeral: true,
      experimentalRawEvents: false,
      model: input.model,
      runtimeWorkspaceRoots: [input.repositoryRoot],
      sandbox: 'read-only',
      serviceName: 'revy',
    }
    const threadResult = parseProtocol<ThreadResponseProjection>(
      threadStartResponseSchema,
      await this.request('thread/start', threadParams),
      'thread response',
    )

    let resolveReview!: (value: BackendReviewResult) => void
    let rejectReview!: (error: Error) => void
    const resultPromise = new Promise<BackendReviewResult>((resolve, reject) => {
      resolveReview = resolve
      rejectReview = reject
    })
    this.activeReview = {
      cancelInFlight: false,
      cancelRequested: false,
      completed: false,
      instructionSources: threadResult.instructionSources,
      interruptTurnId: null,
      markdown: null,
      onActivity: input.onActivity,
      repositoryRoot: input.repositoryRoot,
      reject: rejectReview,
      resolve: resolveReview,
      reviewTurnId: null,
      threadId: threadResult.thread.id,
    }

    try {
      input.onProgress('Reviewing the branch and working tree…')
      const reviewParams: ReviewStartParams = {
        delivery: 'inline',
        target: { instructions: input.prompt, type: 'custom' },
        threadId: threadResult.thread.id,
      }
      const reviewResult = parseProtocol<ReviewResponseProjection>(
        reviewStartResponseSchema,
        await this.request('review/start', reviewParams),
        'review response',
      )
      if (!this.activeReview) {
        throw new Error('The review ended before Codex returned its run identifier.')
      }
      this.activeReview.threadId = reviewResult.reviewThreadId
      this.activeReview.reviewTurnId = reviewResult.turn.id
      if (this.activeReview.cancelRequested) {
        await this.cancelActiveReviewIfReady()
      }
      this.finishActiveReviewIfReady()
      return await resultPromise
    } catch (error) {
      this.rejectActiveReview(error instanceof Error ? error : new Error('The review failed.'))
      return await resultPromise
    }
  }

  async cancel(): Promise<void> {
    if (!this.activeReview) {
      throw new Error('No review is currently running.')
    }
    this.activeReview.cancelRequested = true
    await this.cancelActiveReviewIfReady()
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.rejectActiveReview(new Error('The Codex App Server stopped.'))
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('The Codex App Server stopped.'))
    }
    this.pending.clear()
    this.reader?.close()
    this.reader = null
    const child = this.child
    this.child = null
    if (child && child.exitCode === null) {
      child.kill()
    }
    this.executable = null
    this.stopping = false
    logger.info('Codex App Server stopped')
  }

  private async startServer(executable: string): Promise<void> {
    this.stderrTail = ''
    const child = spawn(executable, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    logger.info('Codex App Server started')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4_000)
    })
    child.once('error', (error) => this.handleProcessExit(error))
    child.once('exit', (code, signal) => {
      if (!this.stopping && this.child === child) {
        const detail = this.stderrTail.trim()
        this.handleProcessExit(
          new Error(
            detail ||
              `Codex App Server exited unexpectedly (${signal ?? `code ${code ?? 'unknown'}`}).`,
          ),
        )
      }
    })
    this.reader = createInterface({ input: child.stdout })
    this.reader.on('line', (line) => this.handleLine(line))

    const initializeParams: InitializeParams = {
      capabilities: { experimentalApi: true, requestAttestation: false },
      clientInfo: { name: 'revy', title: 'Revy', version: '0.0.0' },
    }
    await this.request('initialize', initializeParams)
    this.notify('initialized', {})
  }

  private handleLine(line: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(line) as unknown
    } catch {
      logger.warn('Ignored non-JSON output from Codex App Server')
      return
    }
    const parsed = rpcMessageSchema.safeParse(raw)
    if (!parsed.success) {
      logger.warn('Ignored an unsupported Codex App Server message')
      return
    }
    const message = parsed.data

    if (message.id !== undefined && (message.error || Object.hasOwn(message, 'result'))) {
      const pending = this.pending.get(message.id)
      if (!pending) {
        return
      }
      this.pending.delete(message.id)
      clearTimeout(pending.timeout)
      if (message.error) {
        const prefix =
          message.error.code === -32_601 ? 'Unsupported Codex App Server method' : 'Codex error'
        pending.reject(new Error(`${prefix}: ${message.error.message}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.id !== undefined && message.method) {
      this.write({
        error: { code: -32_601, message: 'Revy does not support server-initiated requests.' },
        id: message.id,
      })
      return
    }

    if (message.method) {
      this.handleNotification(message.method, message.params)
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === 'turn/started') {
      const validated = turnStartedSchema.safeParse(params)
      const parsed = validated.success ? (validated.data as TurnStartedProjection) : null
      if (parsed && this.activeReview && parsed.threadId === this.activeReview.threadId) {
        this.activeReview.interruptTurnId = parsed.turn.id
        this.activeReview.onActivity({
          durationMs: null,
          exitCode: null,
          id: parsed.turn.id,
          kind: 'lifecycle',
          name: null,
          occurredAt: timestampFromSeconds(parsed.turn.startedAt),
          paths: [],
          status: 'in-progress',
          title: 'Codex review turn started.',
        })
        if (this.activeReview.cancelRequested) {
          void this.cancelActiveReviewIfReady().catch((error: unknown) => {
            this.rejectActiveReview(
              error instanceof Error ? error : new Error('The review could not be cancelled.'),
            )
          })
        }
      }
      return
    }

    if (method === 'item/started' || method === 'item/completed') {
      const notification = itemNotificationSchema.safeParse(params)
      if (!notification.success) {
        logger.warn(`Ignored an invalid ${method} notification`)
        return
      }
      const review = this.activeReview
      if (
        !review ||
        notification.data.threadId !== review.threadId ||
        (review.reviewTurnId && notification.data.turnId !== review.reviewTurnId)
      ) {
        return
      }
      const phase = method === 'item/started' ? 'started' : 'completed'
      const activity = activityFromItem(
        notification.data.item,
        phase,
        timestampFromMilliseconds(
          phase === 'started' ? notification.data.startedAtMs : notification.data.completedAtMs,
        ),
        review.repositoryRoot,
      )
      if (activity) {
        review.onActivity(activity)
      }

      if (method === 'item/completed') {
        const validated = itemCompletedSchema.safeParse(params)
        const parsed = validated.success ? (validated.data as ItemCompletedProjection) : null
        if (parsed) {
          review.markdown = parsed.item.review
          this.finishActiveReviewIfReady()
        }
      }
      return
    }

    if (method === 'turn/completed') {
      const validated = turnCompletedSchema.safeParse(params)
      const parsed = validated.success ? (validated.data as TurnCompletedProjection) : null
      if (
        !parsed ||
        !this.activeReview ||
        parsed.threadId !== this.activeReview.threadId ||
        (this.activeReview.reviewTurnId && parsed.turn.id !== this.activeReview.reviewTurnId)
      ) {
        return
      }
      const status: AgentActivityEntry['status'] =
        parsed.turn.status === 'completed'
          ? 'completed'
          : parsed.turn.status === 'interrupted'
            ? 'interrupted'
            : parsed.turn.status === 'failed'
              ? 'failed'
              : 'in-progress'
      this.activeReview.onActivity({
        durationMs: parsed.turn.durationMs ?? null,
        exitCode: null,
        id: parsed.turn.id,
        kind: 'lifecycle',
        name: null,
        occurredAt: timestampFromSeconds(parsed.turn.completedAt),
        paths: [],
        status,
        title:
          status === 'completed'
            ? 'Codex review turn completed.'
            : status === 'interrupted'
              ? 'Codex review turn interrupted.'
              : status === 'failed'
                ? 'Codex review turn failed.'
                : 'Codex review turn is running.',
      })
      if (parsed.turn.status === 'failed') {
        this.rejectActiveReview(
          new Error(parsed.turn.error?.message ?? 'Codex could not complete the review.'),
        )
      } else if (parsed.turn.status === 'interrupted') {
        this.rejectActiveReview(new Error('The review was cancelled.'))
      } else if (parsed.turn.status === 'completed') {
        this.activeReview.completed = true
        if (this.activeReview.markdown === null) {
          this.rejectActiveReview(
            new Error(
              'Codex completed without returning a Markdown review. The version may be unsupported.',
            ),
          )
        } else {
          this.finishActiveReviewIfReady()
        }
      }
      return
    }

    if (method === 'error') {
      const parsed = errorNotificationSchema.safeParse(params)
      if (
        parsed.success &&
        this.activeReview &&
        parsed.data.threadId === this.activeReview.threadId &&
        (!this.activeReview.reviewTurnId || parsed.data.turnId === this.activeReview.reviewTurnId)
      ) {
        this.activeReview.onActivity({
          durationMs: null,
          exitCode: null,
          id: `error:${parsed.data.turnId}:${Date.now()}`,
          kind: 'warning',
          name: null,
          occurredAt: new Date().toISOString(),
          paths: [],
          status: 'warning',
          title: parsed.data.willRetry
            ? 'Codex reported an error and will retry.'
            : 'Codex reported an error.',
        })
      } else if (!parsed.success) {
        logger.warn('Ignored an invalid Codex error notification')
      }
    }
  }

  private finishActiveReviewIfReady(): void {
    const review = this.activeReview
    if (!review?.completed || review.markdown === null) {
      return
    }
    this.activeReview = null
    review.resolve({ instructionSources: review.instructionSources, markdown: review.markdown })
  }

  private rejectActiveReview(error: Error): void {
    const review = this.activeReview
    this.activeReview = null
    review?.reject(error)
  }

  private async cancelActiveReviewIfReady(): Promise<void> {
    const review = this.activeReview
    if (!review?.cancelRequested || !review.interruptTurnId || review.cancelInFlight) {
      return
    }
    review.cancelInFlight = true
    const params: TurnInterruptParams = {
      threadId: review.threadId,
      turnId: review.interruptTurnId,
    }
    try {
      await this.request('turn/interrupt', params)
      if (this.activeReview === review) {
        this.rejectActiveReview(new Error('The review was cancelled.'))
      }
    } catch (error) {
      review.cancelInFlight = false
      throw error
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex did not respond to ${method} in time.`))
      }, 30_000)
      this.pending.set(id, { reject, resolve, timeout })
      try {
        this.write({ id, method, params })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timeout)
        reject(error instanceof Error ? error : new Error('Codex could not receive the request.'))
      }
    })
  }

  private notify(method: string, params: unknown): void {
    this.write({ method, params })
  }

  private write(message: unknown): void {
    if (!this.child?.stdin.writable) {
      throw new Error('The Codex App Server connection is closed.')
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleProcessExit(error: Error): void {
    logger.error('Codex App Server exited unexpectedly')
    this.child = null
    this.reader?.close()
    this.reader = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    this.rejectActiveReview(error)
  }

  private async findExecutable(configuredExecutable: string | null): Promise<string | null> {
    const executableName = process.platform === 'win32' ? 'codex.exe' : 'codex'
    const candidates = configuredExecutable
      ? [configuredExecutable]
      : [
          ...(process.env.PATH ?? '').split(delimiter).map((path) => join(path, executableName)),
          join(homedir(), '.local', 'bin', executableName),
          join(homedir(), '.codex', 'bin', executableName),
          join('/opt/homebrew/bin', executableName),
          join('/usr/local/bin', executableName),
        ]

    for (const candidate of [...new Set(candidates.filter(Boolean))]) {
      try {
        await access(candidate, constants.X_OK)
        return await realpath(candidate)
      } catch {
        // Try the next known installation location.
      }
    }
    return null
  }

  private readVersion(executable: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('Codex did not report its version in time.'))
      }, 5_000)
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timeout)
        if (code === 0) {
          resolve(Buffer.concat(stdout).toString('utf8').trim())
        } else {
          reject(
            new Error(Buffer.concat(stderr).toString('utf8').trim() || 'Codex is unavailable.'),
          )
        }
      })
    })
  }
}
