export class InactiveOrganizationError extends Error {
  constructor() {
    super("Die Organisation ist nicht aktiv.");
    this.name = "InactiveOrganizationError";
  }
}
