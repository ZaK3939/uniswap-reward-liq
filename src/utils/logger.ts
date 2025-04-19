/**
 * Logger utility for Uniswap v4 Unichain integration
 */
import fs from 'fs';
import path from 'path';
import { format } from 'util';

// Log levels
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// Configure log level from environment or default to INFO
const currentLogLevel = (process.env.LOG_LEVEL?.toUpperCase() as keyof typeof LogLevel) || 'INFO';
const LOG_LEVEL = LogLevel[currentLogLevel] ?? LogLevel.INFO;

// Configure log file from environment or default to logs directory
const LOG_DIR = process.env.LOG_DIR || 'logs';
const LOG_FILE = process.env.LOG_FILE || 'app.log';
const LOG_PATH = path.join(LOG_DIR, LOG_FILE);

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Format a log message with timestamp
 * @param level Log level
 * @param message Message to log
 * @param args Additional arguments
 * @returns Formatted log message
 */
function formatLogMessage(level: string, message: string, ...args: any[]): string {
  const timestamp = new Date().toISOString();
  const formattedMessage = args.length > 0 ? format(message, ...args) : message;
  return `[${timestamp}] [${level}] ${formattedMessage}`;
}

/**
 * Write a message to the log file
 * @param message Message to log
 */
function writeToFile(message: string): void {
  fs.appendFileSync(LOG_PATH, message + '\n');
}

/**
 * Log a debug message
 * @param message Message to log
 * @param args Additional arguments
 */
export function debug(message: string, ...args: any[]): void {
  if (LOG_LEVEL <= LogLevel.DEBUG) {
    const formattedMessage = formatLogMessage('DEBUG', message, ...args);
    console.debug(formattedMessage);
    writeToFile(formattedMessage);
  }
}

/**
 * Log an info message
 * @param message Message to log
 * @param args Additional arguments
 */
export function info(message: string, ...args: any[]): void {
  if (LOG_LEVEL <= LogLevel.INFO) {
    const formattedMessage = formatLogMessage('INFO', message, ...args);
    console.info(formattedMessage);
    writeToFile(formattedMessage);
  }
}

/**
 * Log a warning message
 * @param message Message to log
 * @param args Additional arguments
 */
export function warn(message: string, ...args: any[]): void {
  if (LOG_LEVEL <= LogLevel.WARN) {
    const formattedMessage = formatLogMessage('WARN', message, ...args);
    console.warn(formattedMessage);
    writeToFile(formattedMessage);
  }
}

/**
 * Log an error message
 * @param message Message to log
 * @param args Additional arguments
 */
export function error(message: string, ...args: any[]): void {
  if (LOG_LEVEL <= LogLevel.ERROR) {
    const formattedMessage = formatLogMessage('ERROR', message, ...args);
    console.error(formattedMessage);
    writeToFile(formattedMessage);
  }
}

/**
 * Log an error with stack trace
 * @param err Error object
 * @param message Optional message prefix
 */
export function logError(err: Error, message?: string): void {
  const prefix = message ? `${message}: ` : '';
  error(`${prefix}${err.message}`);
  if (err.stack) {
    error(err.stack);
  }
}

// Export the logger as a single object
export const logger = {
  debug,
  info,
  warn,
  error,
  logError,
};

export default logger;
