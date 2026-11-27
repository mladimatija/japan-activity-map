import { appendFileSync, chmodSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /**
   * How far a long step has got: a bar in a terminal, a bar on the setup page, nothing in a pipe
   * or the log file. `done` reaching `total` ends it.
   */
  progress(done: number, total: number, what: string): void;
  /** Absolute path of today's log file. */
  readonly logFile: string;
}

interface LoggerOptions {
  /** Show debug lines in the terminal. The log file always gets them. */
  verbose: boolean;
  logDir: string;
  /** Command name, written on every log-file line. */
  command: string;
}

const localDate = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * A second place for every line a logger writes, besides the terminal and the log file: the setup
 * wizard shows a command's output in its own panel. One sink for the process; undefined removes it.
 */
export type LogSink = (level: LogLevel | 'progress', message: string) => void;

/** A line a command run by the setup wizard prints for its progress, read back by the wizard. */
export const PROGRESS_MARK = '@@jam-progress ';

/** Reads such a line; undefined for any other. */
export const parseProgress = (
  line: string,
): { done: number; total: number; what: string } | undefined => {
  if (!line.startsWith(PROGRESS_MARK)) return undefined;
  const [done, total, ...what] = line.slice(PROGRESS_MARK.length).split(' ');
  return { done: Number(done), total: Number(total), what: what.join(' ') };
};
let sink: LogSink | undefined;
export const setLogSink = (next: LogSink | undefined): void => {
  sink = next;
};

/** Dated log files older than this are deleted when a command starts. */
const KEEP_DAYS = 30;

const pruneLogs = (logDir: string) => {
  const oldest = localDate(new Date(Date.now() - KEEP_DAYS * 86_400_000));
  for (const file of readdirSync(logDir)) {
    const day = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(file)?.[1];
    if (!day) continue;
    try {
      if (day < oldest) unlinkSync(join(logDir, file));
      // Files from before this rule were readable by others on the machine.
      else chmodSync(join(logDir, file), 0o600);
    } catch {
      // Not ours to change: leave it.
    }
  }
};

/** Writes to the terminal and appends every line to a dated log file in the data folder. */
export const createLogger = ({ verbose, logDir, command }: LoggerOptions): Logger => {
  const logFile = join(logDir, `${localDate(new Date())}.log`);
  let fileWritable = true;
  try {
    // Private to the owner: the log names activities, places and paths.
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    chmodSync(logDir, 0o700);
    pruneLogs(logDir);
  } catch {
    fileWritable = false;
  }

  // A bar is one line of the terminal, drawn over itself; any other line clears it first.
  let barShown = false;
  const clearBar = () => {
    if (barShown) process.stdout.write('\r\x1b[2K');
    barShown = false;
  };
  const progress = (done: number, total: number, what: string) => {
    if (!(total > 0)) return;
    const reached = Math.max(0, Math.min(done, total));
    sink?.('progress', JSON.stringify({ done: reached, total, what }));
    if (process.env.JAM_PROGRESS === '1') {
      process.stdout.write(`${PROGRESS_MARK}${reached} ${total} ${what}\n`);
      return;
    }
    if (!process.stdout.isTTY) return;
    const width = 24;
    const filled = Math.round((reached / total) * width);
    process.stdout.write(
      `\r\x1b[2K  [${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${reached}/${total} ${what}`,
    );
    barShown = true;
    if (reached >= total) clearBar();
  };

  const write = (level: LogLevel, message: string) => {
    if (fileWritable) {
      try {
        appendFileSync(
          logFile,
          `${new Date().toISOString()} [${level}] [${command}] ${message}\n`,
          { mode: 0o600 },
        );
      } catch {
        // A full disk or permission problem must never stop a command; the terminal still gets the line.
        fileWritable = false;
      }
    }
    if (level === 'debug' && !verbose) return;
    sink?.(level, message);
    clearBar();
    const line = level === 'info' ? message : `${level}: ${message}`;
    (level === 'warn' || level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  };

  return {
    debug: (message) => write('debug', message),
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
    progress,
    logFile,
  };
};
