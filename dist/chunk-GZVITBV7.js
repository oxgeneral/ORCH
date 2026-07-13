// src/domain/run.ts
function createTokenUsage(input, output, opts) {
  const reasoning = opts?.reasoning ?? 0;
  return {
    input,
    output,
    reasoning,
    total: input + output + reasoning,
    cache_read: opts?.cache_read ?? 0,
    cache_write: opts?.cache_write ?? 0
  };
}

export { createTokenUsage };
//# sourceMappingURL=chunk-GZVITBV7.js.map
//# sourceMappingURL=chunk-GZVITBV7.js.map