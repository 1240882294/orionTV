jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
  },
}));

// 用内存实现替掉真正的凭据管理，避免把 storage.ts 里的 API 层一起拉进来
jest.mock("../storage", () => {
  let credentials: { username: string; password: string } | null = null;
  let settings: { apiBaseUrl: string } = { apiBaseUrl: "http://tv.local:8080" };
  return {
    __esModule: true,
    LoginCredentialsManager: {
      get: jest.fn(async () => credentials),
      save: jest.fn(async (value: { username: string; password: string }) => {
        credentials = value;
      }),
      clear: jest.fn(async () => {
        credentials = null;
      }),
      __set: (value: { username: string; password: string } | null) => {
        credentials = value;
      },
    },
    SettingsManager: {
      get: jest.fn(async () => settings),
      __setBaseUrl: (url: string) => {
        settings = { apiBaseUrl: url };
      },
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { LoginCredentialsManager, SettingsManager } from "../storage";
import { AccountProfileManager } from "../accountProfiles";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => memory.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    memory.set(key, value);
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    memory.delete(key);
  });
  (LoginCredentialsManager as any).__set(null);
  (SettingsManager as any).__setBaseUrl("http://tv.local:8080");
});

describe("AccountProfileManager", () => {
  it("把旧版本的单账号凭据迁移成一条档案", async () => {
    (LoginCredentialsManager as any).__set({ username: "alice", password: "p1" });

    const profiles = await AccountProfileManager.getAll();

    expect(profiles).toHaveLength(1);
    expect(profiles[0].username).toBe("alice");
    expect(profiles[0].server).toBe("http://tv.local:8080");
    expect(await AccountProfileManager.getActiveId()).toBe("alice");
    // 迁移只做一次，第二次读取直接走列表
    expect(await AccountProfileManager.getAll()).toHaveLength(1);
  });

  it("新增账号会同时写入档案列表与当前凭据", async () => {
    await AccountProfileManager.upsert("alice", "p1");
    await AccountProfileManager.upsert("bob", "p2");

    const profiles = await AccountProfileManager.getAll();
    expect(profiles.map((item) => item.username)).toEqual(["alice", "bob"]);
    expect(await AccountProfileManager.getActiveId()).toBe("bob");
    await expect(LoginCredentialsManager.get()).resolves.toEqual({ username: "bob", password: "p2" });
  });

  it("同名账号重复登录只更新密码，不产生重复档案", async () => {
    await AccountProfileManager.upsert("alice", "old");
    await AccountProfileManager.upsert("Alice", "new");

    const profiles = await AccountProfileManager.getAll();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe("alice");
    expect(profiles[0].password).toBe("new");
  });

  it("切换到已有账号会把当前凭据换成目标账号", async () => {
    await AccountProfileManager.upsert("alice", "p1");
    await AccountProfileManager.upsert("bob", "p2");

    const profile = await AccountProfileManager.setActive("alice");

    expect(profile?.username).toBe("alice");
    expect(await AccountProfileManager.getActiveId()).toBe("alice");
    await expect(LoginCredentialsManager.get()).resolves.toEqual({ username: "alice", password: "p1" });
  });

  it("退出当前账号会把它从列表移除并清空凭据", async () => {
    await AccountProfileManager.upsert("alice", "p1");
    await AccountProfileManager.upsert("bob", "p2");

    await AccountProfileManager.clearActive();

    const profiles = await AccountProfileManager.getAll();
    expect(profiles.map((item) => item.username)).toEqual(["alice"]);
    expect(await AccountProfileManager.getActiveId()).toBeNull();
    await expect(LoginCredentialsManager.get()).resolves.toBeNull();
  });

  it("不同服务器的账号各自带 server 标记，便于界面按服务器过滤", async () => {
    await AccountProfileManager.upsert("alice", "p1");
    (SettingsManager as any).__setBaseUrl("http://other.local:9000/");
    await AccountProfileManager.upsert("carol", "p3");

    const profiles = await AccountProfileManager.getAll();
    const carol = profiles.find((item) => item.username === "carol");
    expect(carol?.server).toBe("http://other.local:9000");
  });
});
