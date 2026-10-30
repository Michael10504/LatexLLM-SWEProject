/** Docker CLI missing, daemon down, image missing, or the container keeps vanishing → SANDBOX_UNAVAILABLE. */
export class SandboxUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SandboxUnavailableError';
  }
}

/** main.tex missing, unsupported path, not a folder → FAILED with one log entry (decision C11). */
export class ProjectInvalidError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ProjectInvalidError';
  }
}

/** The container disappeared between ensureRunning and exec. CompileService retries ensureRunning once. */
export class ContainerGoneError extends Error {
  constructor(detail: string) {
    super(`Sandbox container is gone: ${detail.trim()}`);
    this.name = 'ContainerGoneError';
  }
}
