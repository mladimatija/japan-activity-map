/**
 * An error the person running a command can act on: it prints as its message, without a stack.
 * Every error class of the tool that is meant to be read extends this; anything else that is
 * thrown is a bug and keeps its stack.
 */
export class JamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JamError';
  }
}

/** What went wrong, as one line, whatever was thrown. */
export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
