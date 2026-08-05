import { type DBSchema, type IDBPDatabase, openDB } from "idb";

const DATABASE_NAME = "c-harness-settings";
const DATABASE_VERSION = 1;
const GENERAL_SETTINGS_KEY = "general";

export const SKILL_DISABLED_MESSAGE = "Skill 功能已停用。";

export interface GeneralSettings {
  skillEnabled: boolean;
  reinjectionDelayMinSeconds: number;
  reinjectionDelayMaxSeconds: number;
}

interface SettingsDatabase extends DBSchema {
  settings: {
    key: string;
    value: Partial<GeneralSettings>;
  };
}

let databasePromise: Promise<IDBPDatabase<SettingsDatabase>> | undefined;

/** 打开扩展的通用设置数据库，只保存用户明确配置的全局设置。 */
export function openSettingsDatabase(): Promise<IDBPDatabase<SettingsDatabase>> {
  databasePromise ??= openDB<SettingsDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      database.createObjectStore("settings");
    }
  });
  return databasePromise;
}

/** 读取通用设置，并对旧记录缺失字段补齐默认值。 */
export async function getGeneralSettings(): Promise<GeneralSettings> {
  const database = await openSettingsDatabase();
  return normalizeGeneralSettings(await database.get("settings", GENERAL_SETTINGS_KEY));
}

/** 更新 Skill 功能开关，写入前会完整校验最终设置记录。 */
export async function updateSkillEnabled(skillEnabled: boolean): Promise<GeneralSettings> {
  if (typeof skillEnabled !== "boolean") throw new Error("Skill 功能开关设置无效。");
  const database = await openSettingsDatabase();
  const current = normalizeGeneralSettings(await database.get("settings", GENERAL_SETTINGS_KEY));
  const next = validateGeneralSettings({ ...current, skillEnabled });
  await database.put("settings", next, GENERAL_SETTINGS_KEY);
  return next;
}

/** 原子更新自动回注延迟区间，要求 1 到 60 秒闭区间整数且最小值不大于最大值。 */
export async function updateReinjectionDelay(minSeconds: number, maxSeconds: number): Promise<GeneralSettings> {
  const database = await openSettingsDatabase();
  const current = normalizeGeneralSettings(await database.get("settings", GENERAL_SETTINGS_KEY));
  const next = validateGeneralSettings({
    ...current,
    reinjectionDelayMinSeconds: minSeconds,
    reinjectionDelayMaxSeconds: maxSeconds
  });
  await database.put("settings", next, GENERAL_SETTINGS_KEY);
  return next;
}

/** 关闭并清除设置数据库连接，主要用于确定性测试。 */
export async function resetSettingsDatabaseConnection(): Promise<void> {
  const database = await databasePromise;
  database?.close();
  databasePromise = undefined;
}

function normalizeGeneralSettings(value: Partial<GeneralSettings> | undefined): GeneralSettings {
  return validateGeneralSettings({
    skillEnabled: typeof value?.skillEnabled === "boolean" ? value.skillEnabled : true,
    reinjectionDelayMinSeconds: typeof value?.reinjectionDelayMinSeconds === "number" ? value.reinjectionDelayMinSeconds : 1,
    reinjectionDelayMaxSeconds: typeof value?.reinjectionDelayMaxSeconds === "number" ? value.reinjectionDelayMaxSeconds : 3
  });
}

function validateGeneralSettings(value: GeneralSettings): GeneralSettings {
  if (typeof value.skillEnabled !== "boolean") throw new Error("Skill 功能开关设置无效。");
  if (!Number.isInteger(value.reinjectionDelayMinSeconds) || !Number.isInteger(value.reinjectionDelayMaxSeconds)) {
    throw new Error("自动回注延迟必须是整数秒。");
  }
  if (
    value.reinjectionDelayMinSeconds < 1 ||
    value.reinjectionDelayMinSeconds > 60 ||
    value.reinjectionDelayMaxSeconds < 1 ||
    value.reinjectionDelayMaxSeconds > 60
  ) {
    throw new Error("自动回注延迟必须在 1 到 60 秒之间。");
  }
  if (value.reinjectionDelayMinSeconds > value.reinjectionDelayMaxSeconds) {
    throw new Error("自动回注最小延迟不能大于最大延迟。");
  }
  return value;
}
