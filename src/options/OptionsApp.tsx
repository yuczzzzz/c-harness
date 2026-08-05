import { ChevronLeft, ChevronRight, FileArchive, PlugZap, RefreshCw, Save, Search, Settings2, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { McpServiceRecord } from "@/mcp/contracts";
import {
  createMcpServiceClient,
  createGeneralSettingsClient,
  createSkillLibraryClient,
  type GeneralSettingsClient,
  type McpServiceClient,
  type SkillLibraryClient
} from "@/options/client";
import { SKILL_LIMITS, SkillImportError, type SkillMetadata } from "@/skills/contracts";
import { importSkillZip } from "@/skills/importer";

interface OptionsAppProps {
  client?: SkillLibraryClient;
  mcpClient?: McpServiceClient;
  settingsClient?: GeneralSettingsClient;
}

interface ImportResult {
  fileName: string;
  status: "success" | "error" | "cancelled";
  message: string;
}

const SKILLS_PER_PAGE = 5;
const DESCRIPTION_PREVIEW_CHARS = 96;

type OptionsRoute = "home" | "general" | "skills" | "mcp";

/** 渲染设置页 hash 路由容器。 */
export function OptionsApp({ client: providedClient, mcpClient: providedMcpClient, settingsClient: providedSettingsClient }: OptionsAppProps) {
  const client = useMemo(() => providedClient ?? createSkillLibraryClient(), [providedClient]);
  const mcpClient = useMemo(() => providedMcpClient ?? createMcpServiceClient(), [providedMcpClient]);
  const settingsClient = useMemo(() => providedSettingsClient ?? createGeneralSettingsClient(), [providedSettingsClient]);
  const route = useHashRoute();

  if (route === "general") return <GeneralSettingsPage settingsClient={settingsClient} />;
  if (route === "skills") return <SkillManagementPage client={client} settingsClient={settingsClient} />;
  if (route === "mcp") return <McpManagementPage client={mcpClient} />;
  return <SettingsHome />;
}

function SettingsHome() {
  return (
    <main className="options-page">
      <header className="options-header">
        <p className="product-label">C-HARNESS</p>
        <div className="header-row">
          <div>
            <h1>设置</h1>
            <p className="summary">管理可供网页大模型按需读取和调用的本地能力。</p>
          </div>
        </div>
      </header>

      <section className="settings-grid" aria-label="设置入口">
        <a className="settings-entry" href="#/general">
          <span className="entry-icon"><Settings2 aria-hidden="true" size={22} /></span>
          <span>
            <strong>通用设置</strong>
            <span>调整通用扩展行为</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} />
        </a>
        <a className="settings-entry" href="#/skills">
          <span className="entry-icon"><FileArchive aria-hidden="true" size={22} /></span>
          <span>
            <strong>Skill 管理</strong>
            <span>扩展提供的 Skill 功能，支持导入本地 Skill 压缩包</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} />
        </a>
        <a className="settings-entry" href="#/mcp">
          <span className="entry-icon"><PlugZap aria-hidden="true" size={22} /></span>
          <span>
            <strong>MCP 管理</strong>
            <span>添加和检测 MCP 服务</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} />
        </a>
      </section>
    </main>
  );
}

function GeneralSettingsPage({ settingsClient }: { settingsClient: GeneralSettingsClient }) {
  const [minSeconds, setMinSeconds] = useState("1");
  const [maxSeconds, setMaxSeconds] = useState("3");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const refreshSettings = useCallback(async () => {
    try {
      const settings = await settingsClient.get();
      setMinSeconds(String(settings.reinjectionDelayMinSeconds));
      setMaxSeconds(String(settings.reinjectionDelayMaxSeconds));
      setError("");
    } catch (loadError) {
      setError(messageFrom(loadError));
    }
  }, [settingsClient]);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const handleSave = async () => {
    if (saving) return;
    const parsedMin = Number(minSeconds);
    const parsedMax = Number(maxSeconds);
    const validationError = validateDelayInput(parsedMin, parsedMax);
    if (validationError) {
      setError(validationError);
      setSaved(false);
      return;
    }
    setSaving(true);
    try {
      const settings = await settingsClient.updateReinjectionDelay(parsedMin, parsedMax);
      setMinSeconds(String(settings.reinjectionDelayMinSeconds));
      setMaxSeconds(String(settings.reinjectionDelayMaxSeconds));
      setError("");
      setSaved(true);
    } catch (saveError) {
      setError(messageFrom(saveError));
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="options-page">
      <header className="options-header">
        <p className="product-label">C-HARNESS</p>
        <div className="header-row">
          <div>
            <h1>通用设置</h1>
            <p className="summary">配置增强任务的全局行为。</p>
          </div>
          <a className="back-link" href="#/">
            <ChevronLeft aria-hidden="true" size={17} />
            返回设置
          </a>
        </div>
      </header>

      <section className="general-form" aria-label="通用设置表单">
        <div className="form-row">
          <div>
            <h2>自动回注时间</h2>
            <p className="privacy-note">每次自动回注发送前，从闭区间内独立抽样整数秒。</p>
          </div>
        </div>
        <div className="form-row">
          <label>
            <span>最小自动回注延迟（秒）</span>
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              value={minSeconds}
              onChange={(event) => setMinSeconds(event.target.value)}
            />
          </label>
          <label>
            <span>最大自动回注延迟（秒）</span>
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              value={maxSeconds}
              onChange={(event) => setMaxSeconds(event.target.value)}
            />
          </label>
        </div>
        {error && <p className="global-error" role="alert">{error}</p>}
        {saved && !error && <p className="global-success" role="status">已保存。</p>}
        <div className="form-actions">
          <button type="button" className="primary-button" disabled={saving} onClick={() => void handleSave()}>
            <Save aria-hidden="true" size={17} />
            保存
          </button>
        </div>
      </section>
    </main>
  );
}

function SkillManagementPage({ client, settingsClient }: { client: SkillLibraryClient; settingsClient: GeneralSettingsClient }) {
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [skillEnabled, setSkillEnabled] = useState(true);
  const [savingSkillEnabled, setSavingSkillEnabled] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setSkills(await client.getCatalog());
      setError("");
    } catch (loadError) {
      setError(messageFrom(loadError));
    }
  }, [client]);

  const refreshSettings = useCallback(async () => {
    try {
      const settings = await settingsClient.get();
      setSkillEnabled(settings.skillEnabled);
      setError("");
    } catch (loadError) {
      setError(messageFrom(loadError));
    }
  }, [settingsClient]);

  useEffect(() => {
    void refresh();
    void refreshSettings();
  }, [refresh, refreshSettings]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const importFiles = useCallback(async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    const nextResults: ImportResult[] = [];

    // 步骤 1：请求持久化前，分别校验每个包。
    for (const file of files) {
      try {
        const skillPackage = await importSkillZip(file);
        const existing = skills.some((skill) => skill.name === skillPackage.metadata.name);

        // 步骤 2：覆盖稳定标识前，要求用户明确确认。
        if (existing && !window.confirm(`已存在同名 Skill「${skillPackage.metadata.name}」，是否整体覆盖？`)) {
          nextResults.push({ fileName: file.name, status: "cancelled", message: "已取消覆盖，原 Skill 保持不变。" });
          continue;
        }

        // 步骤 3：仅持久化已完整校验的包，并报告结果。
        await client.replace(skillPackage);
        nextResults.push({
          fileName: file.name,
          status: "success",
          message: `已导入 ${skillPackage.metadata.name}，${skillPackage.metadata.referenceCount} 个 Reference。`
        });
      } catch (importError) {
        nextResults.push({
          fileName: file.name,
          status: "error",
          message: messageFrom(importError)
        });
      }
    }
    setResults(nextResults);
    await refresh();
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  }, [busy, client, refresh, skills]);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    void importFiles(Array.from(event.target.files ?? []));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void importFiles(Array.from(event.dataTransfer.files));
  };

  const handleDelete = async (skill: SkillMetadata) => {
    if (!window.confirm(`确定删除 Skill「${skill.name}」及其全部 Reference？`)) return;
    try {
      await client.delete(skill.name);
      await refresh();
    } catch (deleteError) {
      setError(messageFrom(deleteError));
    }
  };

  const handleSkillEnabledChange = async (nextEnabled: boolean) => {
    if (savingSkillEnabled) return;
    const previous = skillEnabled;
    setSkillEnabled(nextEnabled);
    setSavingSkillEnabled(true);
    try {
      const settings = await settingsClient.updateSkillEnabled(nextEnabled);
      setSkillEnabled(settings.skillEnabled);
      setError("");
    } catch (saveError) {
      setSkillEnabled(previous);
      setError(messageFrom(saveError));
    } finally {
      setSavingSkillEnabled(false);
    }
  };

  const savedBytes = skills.reduce((total, skill) => total + skill.savedBytes, 0);
  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => matchesSkillQuery(skill, query));
  }, [query, skills]);
  const pageCount = Math.max(1, Math.ceil(filteredSkills.length / SKILLS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pagedSkills = filteredSkills.slice(
    (currentPage - 1) * SKILLS_PER_PAGE,
    currentPage * SKILLS_PER_PAGE
  );

  return (
    <main className="options-page">
      <header className="options-header">
        <p className="product-label">C-HARNESS</p>
        <div className="header-row">
          <div>
            <h1>Skill 管理</h1>
            <p className="summary">{skills.length}/{SKILL_LIMITS.maxSkills} 个 Skill · {formatBytes(savedBytes)} 已保存</p>
          </div>
          <a className="back-link" href="#/">
            <ChevronLeft aria-hidden="true" size={17} />
            返回设置
          </a>
        </div>
      </header>

      <section className="feature-toggle-section" aria-label="Skill 功能">
        <div>
          <h2>Skill 功能</h2>
          <p className="privacy-note">关闭后，聊天页 Harness 不再提供 Skill 和 Reference 读取。</p>
        </div>
        <label className="toggle-control">
          <input
            type="checkbox"
            checked={skillEnabled}
            disabled={savingSkillEnabled}
            onChange={(event) => void handleSkillEnabledChange(event.target.checked)}
          />
          <span>{skillEnabled ? "已启用" : "已停用"}</span>
        </label>
      </section>

      <section className="import-section" aria-labelledby="import-title">
        <div>
          <h2 id="import-title">导入 Skill 包</h2>
          <p className="privacy-note">被请求的 Skill 内容会发送给当前网页大模型。</p>
        </div>
        <div
          className={`drop-zone${busy ? " is-busy" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <Upload aria-hidden="true" size={22} />
          <span>拖入一个或多个 ZIP</span>
          <button type="button" className="primary-button" disabled={busy} onClick={() => fileInput.current?.click()}>
            <FileArchive aria-hidden="true" size={17} />
            选择 ZIP
          </button>
          <input ref={fileInput} className="visually-hidden" aria-label="选择 ZIP" type="file" accept=".zip,application/zip" multiple onChange={handleFiles} />
        </div>
      </section>

      {error && <p className="global-error" role="alert">{error}</p>}

      {results.length > 0 && (
        <section className="results-section" aria-labelledby="result-title">
          <h2 id="result-title">导入结果</h2>
          <ul className="result-list">
            {results.map((result) => (
              <li key={`${result.fileName}-${result.status}`} data-status={result.status}>
                <strong>{result.fileName}</strong>
                <span>{result.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="library-section" aria-labelledby="library-title">
        <div className="library-heading">
          <h2 id="library-title">Skill 库</h2>
          {skills.length > 0 && (
            <label className="search-box">
              <Search aria-hidden="true" size={17} />
              <span className="visually-hidden">搜索 Skill</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题或描述"
              />
            </label>
          )}
        </div>
        {skills.length === 0 ? (
          <div className="empty-state">
            <h3>尚未导入 Skill</h3>
            <p>导入 ZIP 后会在这里显示名称、描述和 Reference 数量。</p>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="empty-state">
            <h3>没有匹配的 Skill</h3>
            <p>换一个标题或描述关键词再试。</p>
          </div>
        ) : (
          <>
            <div className="skill-table-wrap">
              <table className="skill-table">
                <thead>
                  <tr><th>Skill</th><th>Reference</th><th>包大小</th><th>导入时间</th><th><span className="visually-hidden">操作</span></th></tr>
                </thead>
                <tbody>
                  {pagedSkills.map((skill) => (
                    <tr key={skill.name}>
                      <td data-label="Skill">
                        <strong title={skill.name}>{skill.name}</strong>
                        <span title={skill.description}>{previewDescription(skill.description)}</span>
                      </td>
                      <td data-label="Reference">{skill.referenceCount}</td>
                      <td data-label="包大小">{formatBytes(skill.packageBytes)}</td>
                      <td data-label="导入时间">{formatDate(skill.importedAt)}</td>
                      <td data-label="操作">
                        <button type="button" className="icon-button" aria-label={`删除 ${skill.name}`} title={`删除 ${skill.name}`} onClick={() => void handleDelete(skill)}>
                          <Trash2 aria-hidden="true" size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination" aria-label="Skill 分页">
              <span>{filteredSkills.length} 个匹配 · 第 {currentPage}/{pageCount} 页</span>
              <div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="上一页"
                  title="上一页"
                  disabled={currentPage === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft aria-hidden="true" size={17} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="下一页"
                  title="下一页"
                  disabled={currentPage === pageCount}
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                >
                  <ChevronRight aria-hidden="true" size={17} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function McpManagementPage({ client }: { client: McpServiceClient }) {
  const [services, setServices] = useState<McpServiceRecord[]>([]);
  const [endpoint, setEndpoint] = useState("");
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [detectingServiceId, setDetectingServiceId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setServices(await client.list());
      setError("");
    } catch (loadError) {
      setError(messageFrom(loadError));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = async () => {
    if (adding) return;
    setAdding(true);
    try {
      await client.add(endpoint);
      setEndpoint("");
      await refresh();
    } catch (addError) {
      setError(messageFrom(addError));
    } finally {
      setAdding(false);
    }
  };

  const handleRedetect = async (service: McpServiceRecord) => {
    if (busyServiceId) return;
    setBusyServiceId(service.serviceId);
    setDetectingServiceId(service.serviceId);
    try {
      await client.redetect(service);
      await refresh();
    } catch (redetectError) {
      await refresh();
      setError(messageFrom(redetectError));
    } finally {
      setDetectingServiceId(null);
      setBusyServiceId(null);
    }
  };

  const handleDelete = async (service: McpServiceRecord) => {
    if (!window.confirm(`确定删除 MCP 服务「${service.serviceId}」？`)) return;
    setBusyServiceId(service.serviceId);
    try {
      await client.delete(service.serviceId);
      await refresh();
    } catch (deleteError) {
      setError(messageFrom(deleteError));
    } finally {
      setBusyServiceId(null);
    }
  };

  return (
    <main className="options-page">
      <header className="options-header">
        <p className="product-label">C-HARNESS</p>
        <div className="header-row">
          <div>
            <h1>MCP 管理</h1>
            <p className="summary">{services.length} 个 MCP 服务已保存</p>
          </div>
          <a className="back-link" href="#/">
            <ChevronLeft aria-hidden="true" size={17} />
            返回设置
          </a>
        </div>
      </header>

      <section className="mcp-add-section" aria-labelledby="mcp-add-title">
        <div>
          <h2 id="mcp-add-title">添加 MCP 服务</h2>
          <p className="privacy-note">只支持无鉴权 Streamable HTTP，权限会在点击添加或重新检测时请求。</p>
        </div>
        <div className="mcp-add-form">
          <label>
            <span className="visually-hidden">MCP 地址</span>
            <input
              type="text"
              value={endpoint}
              placeholder="https://example.com/mcp 或 127.0.0.1:3000"
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          <button type="button" className="primary-button" disabled={adding || !endpoint.trim()} onClick={() => void handleAdd()}>
            <PlugZap aria-hidden="true" size={17} />
            {adding ? "添加中" : "添加"}
          </button>
        </div>
      </section>

      {error && <p className="global-error" role="alert">{error}</p>}

      <section className="library-section" aria-labelledby="mcp-library-title">
        <h2 id="mcp-library-title">MCP 服务</h2>
        {services.length === 0 ? (
          <div className="empty-state">
            <h3>尚未添加 MCP 服务</h3>
            <p>添加成功后会在这里显示服务名称、地址、Tool 数量和最近检测时间。</p>
          </div>
        ) : (
          <div className="skill-table-wrap">
            <table className="skill-table mcp-table">
              <thead>
                <tr><th>服务</th><th>Endpoint</th><th>Tool</th><th>状态</th><th>最近检测</th><th><span className="visually-hidden">操作</span></th></tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.serviceId}>
                    <td data-label="服务">
                      <strong title={service.serviceId}>{service.serviceId}</strong>
                      <span title={service.description}>{previewDescription(service.description)}</span>
                    </td>
                    <td data-label="Endpoint"><span title={service.endpoint}>{service.endpoint}</span></td>
                    <td data-label="Tool">{service.toolCount}</td>
                    <td data-label="状态">
                      <span
                        className="mcp-status"
                        data-status={detectingServiceId === service.serviceId ? "checking" : service.detectionStatus ?? "available"}
                      >
                        {detectingServiceId === service.serviceId
                          ? "检测中"
                          : service.detectionStatus !== "unavailable" ? "可用" : "不可用"}
                      </span>
                    </td>
                    <td data-label="最近检测" className="mcp-detected-at">{formatDate(service.lastDetectionAt ?? service.lastVerifiedAt)}</td>
                    <td data-label="操作">
                      <div className="table-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`重新检测 ${service.serviceId}`}
                          title={`重新检测 ${service.serviceId}`}
                          disabled={busyServiceId === service.serviceId}
                          onClick={() => void handleRedetect(service)}
                        >
                          <RefreshCw aria-hidden="true" size={17} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`删除 ${service.serviceId}`}
                          title={`删除 ${service.serviceId}`}
                          disabled={busyServiceId === service.serviceId}
                          onClick={() => void handleDelete(service)}
                        >
                          <Trash2 aria-hidden="true" size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function useHashRoute(): OptionsRoute {
  const [route, setRoute] = useState<OptionsRoute>(() => routeFromHash(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return route;
}

function routeFromHash(hash: string): OptionsRoute {
  if (hash === "#/general") return "general";
  if (hash === "#/skills") return "skills";
  if (hash === "#/mcp") return "mcp";
  return "home";
}

function messageFrom(error: unknown): string {
  if (error instanceof SkillImportError) return error.message;
  return error instanceof Error ? error.message : "操作失败。";
}

function validateDelayInput(minSeconds: number, maxSeconds: number): string {
  if (!Number.isInteger(minSeconds) || !Number.isInteger(maxSeconds)) return "自动回注延迟必须是整数秒。";
  if (minSeconds < 1 || minSeconds > 60 || maxSeconds < 1 || maxSeconds > 60) {
    return "自动回注延迟必须在 1 到 60 秒之间。";
  }
  if (minSeconds > maxSeconds) return "自动回注最小延迟不能大于最大延迟。";
  return "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatDate(value: string | undefined): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function previewDescription(description: string): string {
  if (description.length <= DESCRIPTION_PREVIEW_CHARS) return description;
  return `${description.slice(0, DESCRIPTION_PREVIEW_CHARS)}...`;
}

function matchesSkillQuery(skill: SkillMetadata, query: string): boolean {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeSearchText(`${skill.name} ${skill.description}`);
  return terms.every((term) => haystack.includes(term));
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}
