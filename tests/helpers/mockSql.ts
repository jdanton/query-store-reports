import { vi } from 'vitest';
import type * as sql from 'mssql';

export interface MockInput {
  name: string;
  type: unknown;
  value: unknown;
}

export interface MockRequestState {
  inputs: MockInput[];
  querySql: string | null;
}

export function createMockPool(recordset: unknown[] = []) {
  const state: MockRequestState = {
    inputs: [],
    querySql: null,
  };

  const mockRequest = {
    input: vi.fn((name: string, type: unknown, value: unknown) => {
      state.inputs.push({ name, type, value });
      return mockRequest;
    }),
    query: vi.fn(async (querySql: string) => {
      state.querySql = querySql;
      return { recordset };
    }),
  };

  const mockPool = {
    request: vi.fn(() => mockRequest),
  };

  return {
    pool: mockPool as unknown as sql.ConnectionPool,
    state,
    mockRequest,
  };
}
