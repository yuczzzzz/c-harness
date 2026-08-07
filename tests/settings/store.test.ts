import {
  getGeneralSettings,
  openSettingsDatabase,
  resetSettingsDatabaseConnection,
  updateReinjectionDelay,
  updateSkillEnabled
} from "@/settings/store";

const DATABASE_NAME = "c-harness-settings";

describe("general settings store", () => {
  beforeEach(async () => {
    await resetSettingsDatabaseConnection();
    await deleteDatabase(DATABASE_NAME);
  });

  afterEach(async () => {
    await resetSettingsDatabaseConnection();
  });

  it("returns default settings for a fresh install", async () => {
    await expect(getGeneralSettings()).resolves.toEqual({
      skillEnabled: false,
      reinjectionDelayMinSeconds: 1,
      reinjectionDelayMaxSeconds: 3
    });
  });

  it("persists the Skill feature switch", async () => {
    await expect(updateSkillEnabled(false)).resolves.toEqual({
      skillEnabled: false,
      reinjectionDelayMinSeconds: 1,
      reinjectionDelayMaxSeconds: 3
    });

    await resetSettingsDatabaseConnection();

    await expect(getGeneralSettings()).resolves.toEqual({
      skillEnabled: false,
      reinjectionDelayMinSeconds: 1,
      reinjectionDelayMaxSeconds: 3
    });
  });

  it("normalizes missing fields from an older settings record", async () => {
    const database = await openSettingsDatabase();
    await database.put("settings", { skillEnabled: false }, "general");

    await expect(getGeneralSettings()).resolves.toEqual({
      skillEnabled: false,
      reinjectionDelayMinSeconds: 1,
      reinjectionDelayMaxSeconds: 3
    });
  });

  it("atomically persists a valid reinjection delay range", async () => {
    await updateSkillEnabled(false);

    await expect(updateReinjectionDelay(2, 5)).resolves.toEqual({
      skillEnabled: false,
      reinjectionDelayMinSeconds: 2,
      reinjectionDelayMaxSeconds: 5
    });

    await expect(getGeneralSettings()).resolves.toEqual({
      skillEnabled: false,
      reinjectionDelayMinSeconds: 2,
      reinjectionDelayMaxSeconds: 5
    });
  });

  it.each([
    [0, 3, "自动回注延迟必须在 1 到 60 秒之间。"],
    [1, 61, "自动回注延迟必须在 1 到 60 秒之间。"],
    [4, 2, "自动回注最小延迟不能大于最大延迟。"],
    [1.5, 3, "自动回注延迟必须是整数秒。"]
  ])("rejects invalid reinjection delay range %s-%s", async (minSeconds, maxSeconds, message) => {
    await updateReinjectionDelay(2, 5);

    await expect(updateReinjectionDelay(minSeconds, maxSeconds)).rejects.toThrow(message);
    await expect(getGeneralSettings()).resolves.toEqual({
      skillEnabled: false,
      reinjectionDelayMinSeconds: 2,
      reinjectionDelayMaxSeconds: 5
    });
  });
});

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
