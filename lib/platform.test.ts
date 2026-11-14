import { afterEach, describe, expect, it, vi } from "vitest";

// The real plugin calls into the native shell; stub it so the module imports
// cleanly in a plain Node test environment.
const tauriPlatformMock = vi.fn();
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => tauriPlatformMock(),
}));

import { getPlatform, isTauri, normalizePlatform } from "./platform";

afterEach(() => {
  vi.restoreAllMocks();
  tauriPlatformMock.mockReset();
  // Clean up any faked Tauri global between tests.
  delete (globalThis as Record<string, unknown>).window;
});

function fakeTauriWindow() {
  (globalThis as Record<string, unknown>).window = {
    __TAURI_INTERNALS__: {},
  };
}

describe("normalizePlatform", () => {
  it("maps macos to darwin", () => {
    expect(normalizePlatform("macos")).toBe("darwin");
  });

  it("maps windows to win32", () => {
    expect(normalizePlatform("windows")).toBe("win32");
  });

  it("maps linux to linux", () => {
    expect(normalizePlatform("linux")).toBe("linux");
  });

  it("maps unrecognized platforms to unknown", () => {
    expect(normalizePlatform("ios")).toBe("unknown");
    expect(normalizePlatform("android")).toBe("unknown");
    expect(normalizePlatform("")).toBe("unknown");
  });
});

describe("isTauri", () => {
  it("is false when no Tauri global is present", () => {
    expect(isTauri()).toBe(false);
  });

  it("is true when the Tauri internals global is present", () => {
    fakeTauriWindow();
    expect(isTauri()).toBe(true);
  });
});

describe("getPlatform", () => {
  it("returns unknown outside the Tauri shell without calling the plugin", () => {
    expect(getPlatform()).toBe("unknown");
    expect(tauriPlatformMock).not.toHaveBeenCalled();
  });

  it("returns the normalized platform inside the Tauri shell", () => {
    fakeTauriWindow();
    tauriPlatformMock.mockReturnValue("macos");
    expect(getPlatform()).toBe("darwin");
  });

  it("degrades to unknown if the plugin throws", () => {
    fakeTauriWindow();
    tauriPlatformMock.mockImplementation(() => {
      throw new Error("plugin unavailable");
    });
    expect(getPlatform()).toBe("unknown");
  });
});
