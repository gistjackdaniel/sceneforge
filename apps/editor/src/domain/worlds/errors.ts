/** Domain failure that callers can branch on. The message is safe to show in the editor. */
export class WorldDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorldDomainError";
    this.code = code;
  }
}
