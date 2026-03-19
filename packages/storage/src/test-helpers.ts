// ---------------------------------------------------------------------------
// Shared test helpers for storage package
// ---------------------------------------------------------------------------

export interface MockQuery {
  text: string;
  params: unknown[];
}

export function createMockPool(rows: Record<string, unknown>[] = [], rowCount = 0) {
  const queries: MockQuery[] = [];
  const pool = {
    query(text: string, params: unknown[] = []) {
      queries.push({ text, params });
      return Promise.resolve({ rows, rowCount });
    },
    connect() {
      const client = {
        query(text: string, params: unknown[] = []) {
          queries.push({ text, params });
          return Promise.resolve({ rows, rowCount });
        },
        release() {},
      };
      return Promise.resolve(client);
    },
    queries,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pool as any;
}
