// SPDX-License-Identifier: MIT
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (line: string, level: LogLevel) => void;
export interface Logger {
  debug(event: string, message?: unknown, context?: unknown): void;
  info(event: string, message?: unknown, context?: unknown): void;
  warn(event: string, message?: unknown, context?: unknown): void;
  error(event: string, message?: unknown, context?: unknown): void;
}
export interface LoggerOptions { sink?: LogSink; clock?: () => string; }
export function createLogger(component: string, options?: LoggerOptions): Logger;
/** Write a machine-readable command result without a diagnostic envelope. */
export function writeData(text: string): void;
