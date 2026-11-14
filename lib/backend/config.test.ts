import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Unit tests for the Backend_Endpoint config round-trip (Req 9.3, 9.4).
 *
 * The real config store is backed by the Tauri persistent store plugin
 * (`@tauri-apps/plugin-store`), which writes to a JSON file in the OS app-data
 * directory. In a plain Node test environment that native layer is unavailable,
 * so we mock `LazyStore` with an in-memory key/value map that mirrors the
 * plugin's `get`/`set`/`save` semantics (set persists immediately; get reads
 * the last persisted value). This lets us exercise the full round-trip:
 *   - a valid endpoint set via `setBackendEndpoint` is read back by `loadConfig`
 *     without re-prompting (Req 9.4);
 *   - when nothing has been persisted, `loadConfig` reports `backendEndpoint:
 *     null`, the signal the UI uses to render the Backend Setup prompt (Req 9.3).
 */

// In-memory backing store shared with the mock below. Reset between tests so
// each case starts from the "unset" (no endpoint persisted) state.
const backing = new Map<string, unknown>();

vi.mock("@tauri-apps/plugin-store", () => ({
  // Mirror the subset of the LazyStore API that config.ts uses.
  LazyStore: class {
    // The real LazyStore takes a file path; we ignore it and share one map.
    constructor(_path: string) {}

    async get<T>(key: string): Promise<T | undefined> {
      return backing.has(key) ? (backing.get(key) as T) : undefined;
    }

    async set(key: string, value: unknown): Promise<void> {
      backing.set(key, value);
    }

    async save(): Promise<void> {
      // No-op: the in-memory map already reflects every `set` immediately,
      // matching the plugin's autoSave-persisted behavior.
    }
  },
}));

import {
  ConfigValidationError,
  loadConfig,
  setBackendEndpoint,
} from "./config";

beforeEach(() => {
  backing.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("config round-trip (Req 9.3, 9.4)", () => {
  it("returns a valid endpoint from loadConfig after it is set", async () => {
    await setBackendEndpoint("https://pb.example.com");

    const config = await loadConfig();

    // Persisted and read back without re-prompting (Req 9.4).
    expect(config.backendEndpoint).toBe("https://pb.example.com");
  });

  it("persists the trimmed endpoint so a later launch reads it back", async () => {
    await setBackendEndpoint("  http://localhost:8090  ");

    // A fresh loadConfig models a subsequent launch reading the config file.
    const config = await loadConfig();

    expect(config.backendEndpoint).toBe("http://localhost:8090");
  });

  it("reports a null endpoint when none is persisted, signaling the setup prompt (Req 9.3)", async () => {
    const config = await loadConfig();

    // No endpoint persisted -> null, which drives the Backend Setup prompt and
    // the blocking of authenticated operations.
    expect(config.backendEndpoint).toBeNull();
  });

  it("retains the previously persisted endpoint when a later invalid value is rejected", async () => {
    await setBackendEndpoint("https://pb.example.com");

    await expect(setBackendEndpoint("not-a-url")).rejects.toBeInstanceOf(
      ConfigValidationError,
    );

    const config = await loadConfig();
    expect(config.backendEndpoint).toBe("https://pb.example.com");
  });

  it("defaults themePreference to system when nothing is persisted", async () => {
    const config = await loadConfig();

    expect(config.themePreference).toBe("system");
  });
});
