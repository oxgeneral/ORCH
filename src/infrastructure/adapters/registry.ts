/**
 * Adapter registry.
 *
 * Maps adapter kind strings to adapter instances.
 * Pre-populated at startup in the container.
 */

import type { IAgentAdapter } from './interface.js';

export class AdapterRegistry {
  private readonly adapters = new Map<string, IAgentAdapter>();

  register(adapter: IAgentAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  get(kind: string): IAgentAdapter | undefined {
    return this.adapters.get(kind);
  }

  require(kind: string): IAgentAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`Unknown adapter: "${kind}". Available: ${this.listKinds().join(', ')}`);
    }
    return adapter;
  }

  list(): IAgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  listKinds(): string[] {
    return Array.from(this.adapters.keys());
  }

  has(kind: string): boolean {
    return this.adapters.has(kind);
  }
}
