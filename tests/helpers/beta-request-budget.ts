const BETA_REQUEST_BUDGET = 10;
const BETA_REQUEST_WINDOW_MS = 65_000;

// Tests share the proxy's socket IP. Leave room within the real 15/min limit
// for retries and the delay between code issuance and browser redemption.
export class BetaRequestBudget {
  private reservations: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  reserve(): Promise<void> {
    const reservation = this.queue.then(() => this.waitForSlot());
    this.queue = reservation.catch(() => undefined);
    return reservation;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = performance.now();
      this.reservations = this.reservations.filter(
        (time) => now - time < BETA_REQUEST_WINDOW_MS,
      );
      if (this.reservations.length < BETA_REQUEST_BUDGET) {
        this.reservations.push(now);
        return;
      }
      const delay = this.reservations[0]! + BETA_REQUEST_WINDOW_MS - now;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}
