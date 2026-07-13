// src/infrastructure/adapters/registry.ts
var AdapterRegistry = class {
  adapters = /* @__PURE__ */ new Map();
  register(adapter) {
    this.adapters.set(adapter.kind, adapter);
  }
  get(kind) {
    return this.adapters.get(kind);
  }
  require(kind) {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`Unknown adapter: "${kind}". Available: ${this.listKinds().join(", ")}`);
    }
    return adapter;
  }
  list() {
    return Array.from(this.adapters.values());
  }
  listKinds() {
    return Array.from(this.adapters.keys());
  }
  has(kind) {
    return this.adapters.has(kind);
  }
};

export { AdapterRegistry };
//# sourceMappingURL=chunk-6DWHQPTE.js.map
//# sourceMappingURL=chunk-6DWHQPTE.js.map