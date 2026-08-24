import { join } from 'node:path'
import log from 'electron-log/main'

const maximumLogSize = 5 * 1024 * 1024
let debugLoggingEnabled = false

export function createLogger(scope: string) {
  return log.scope(scope)
}

export function initializeLogging(logDirectory: string): void {
  log.transports.file.fileName = 'main.log'
  log.transports.file.level = 'info'
  log.transports.file.maxSize = maximumLogSize
  log.transports.file.resolvePathFn = () => join(logDirectory, 'main.log')
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
  log.transports.ipc.level = false
  log.transports.remote.level = false

  log.errorHandler.startCatching({
    onError: ({ error, errorName, processType }) => {
      log.error(`${errorName} ${processType} error`)
      log.debug('Unhandled error details', {
        name: error.name,
        stack: error.stack?.split('\n').slice(1).join('\n'),
      })
      return false
    },
    showDialog: false,
  })
  log.eventLogger.startLogging({
    format: ({ eventName, eventSource }) => [`Electron ${eventSource} event: ${eventName}`],
    level: 'warn',
    scope: 'electron',
  })
  log.info('Revy logging initialized')
}

export function setDebugLogging(enabled: boolean): void {
  debugLoggingEnabled = enabled
  log.transports.file.level = enabled ? 'debug' : 'info'
  log.info(`Debug logging ${enabled ? 'enabled' : 'disabled'}`)
}

export function isDebugLoggingEnabled(): boolean {
  return debugLoggingEnabled
}

export function logError(scope: string, message: string, error: unknown): void {
  const logger = createLogger(scope)
  logger.error(message)
  if (error instanceof Error) {
    logger.debug(`${message} details`, {
      name: error.name,
      stack: error.stack?.split('\n').slice(1).join('\n'),
    })
  }
}
