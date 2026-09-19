/**
 * sdk — WorkRally 平台能力薄 SDK（协议层）。
 *
 * 只包含「不会变」的东西：HTTP 客户端 + 通用调用入口 + manifest 返回结构类型。
 * 能力的「语义数据」（方法 / 参数 / 描述）运行时从宿主 `capability/manifest` 拉取，
 * 因此拷贝件永远与当前宿主一致，不存在「宿主更新后拷贝件过期」的问题。
 *
 * 用法：
 * ```ts
 * import { workrally } from './sdk';
 *
 * const catalog = await workrally.manifest();          // { capabilities }
 * const { taskIds } = await workrally.call('genImage', 'submit', { prompt, model });
 * const [snap] = await workrally.waitForTask('genImage', taskIds);
 * ```
 */
import { defaultClient } from './client';

export { CapabilityClient, defaultClient } from './client';
export type { CapabilityClientOptions } from './client';

// ─── Manifest 返回结构（描述 capability/manifest 的 JSON 形状，属协议层，几乎不变）────

/** 单个参数的元数据描述（与门面 ContractFieldMeta 同形） */
export interface ParamMeta {
  /** 是否必填 */
  required?: boolean;
  /** 参数中文描述 */
  desc: string;
  /** 参数类型提示 */
  type?: string;
  /** 对象子字段 */
  fields?: Record<string, ParamMeta>;
  /** 数组元素 */
  items?: ParamMeta;
}

/** 单个返回字段的元数据描述 */
export interface ReturnsFieldMeta {
  /** 是否必返回 */
  required?: boolean;
  /** 字段中文描述 */
  desc: string;
  /** 字段类型提示 */
  type?: string;
  /** 对象子字段 */
  fields?: Record<string, ReturnsFieldMeta>;
  /** 数组元素 */
  items?: ReturnsFieldMeta;
}

/** 返回描述的统一形状（desc 整体描述 / fields 字段级描述） */
export interface ReturnsShape {
  desc?: string;
  type?: string;
  fields?: Record<string, ReturnsFieldMeta>;
}

/** 目录树：单个方法（宿主 capability/manifest 返回） */
export interface CatalogAction {
  id: string;
  displayName: string;
  summary: string;
  description?: string;
  params?: Record<string, ParamMeta>;
  returns?: ReturnsShape;
  example?: string;
  /** 调用路径，如 workrally.call('genImage', 'submit') */
  callPath: string;
  stability?: 'stable' | 'deprecated';
  successor?: string;
  deprecatedSince?: string;
  removeAfter?: string;
}

/** 目录树：子模块（扁平能力只有一组，id 为空） */
export interface CatalogGroup {
  id: string;
  displayName: string;
  summary?: string;
  actions: CatalogAction[];
}

/** 目录树：一项平台能力 */
export interface CatalogCapability {
  capability: string;
  displayName: string;
  summary?: string;
  groups: CatalogGroup[];
}

/** 运行时 manifest（协议层） */
export interface CatalogManifest {
  capabilities: CatalogCapability[];
}

function normalizeManifest(raw: unknown): CatalogManifest {
  if (Array.isArray(raw)) {
    return { capabilities: raw as CatalogCapability[] };
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as CatalogManifest).capabilities)) {
    return { capabilities: (raw as CatalogManifest).capabilities };
  }
  return { capabilities: [] };
}

/** 平台能力调用入口（给 MCP 插件 / AI 语义化调用） */
export const workrally = {
  /**
   * 运行时拉取完整能力目录树（能力 → 分组 → 方法，含参数/返回/示例）。
   * 语义永远与宿主一致，无需关心 SDK 版本。
   */
  manifest(): Promise<CatalogManifest> {
    return defaultClient.call<unknown>('capability', 'manifest').then(normalizeManifest);
  },

  /**
   * 通用能力调用。capability / action / 参数结构见 `manifest()` 返回的目录。
   * @param capability 能力名，如 'genImage'；有分组的 action 为点分路径如 'dialog.pickDirectory'、'project.get_filter'
   * @param action action 名，如 'submit'、'uploadAsset' 或 'project.get_filter'
   * @param params 请求参数（可选）
   */
  call<T>(capability: string, action: string, params?: unknown): Promise<T> {
    return defaultClient.call<T>(capability, action, params);
  },

  /**
   * 客户端循环调用 `{capability}/getTasks({ taskIds })`，直到全部 success / failed。不占用能力 HTTP 长连接。
   */
  async waitForTask<T extends { status?: string } = { status?: string }>(
    capability: string,
    taskIds: string[],
    options?: { intervalMs?: number; backend?: string; onProgress?: (snaps: T[]) => void },
  ): Promise<T[]> {
    const ids = (Array.isArray(taskIds) ? taskIds : []).map((id) => String(id || '').trim()).filter(Boolean);
    if (ids.length === 0) {
      throw new Error('taskIds is required');
    }
    const intervalMs = options?.intervalMs && options.intervalMs > 0 ? options.intervalMs : 3000;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    const readTasks = (raw: unknown): T[] => {
      if (Array.isArray(raw)) {
        return raw as T[];
      }
      if (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)) {
        return (raw as { tasks: T[] }).tasks;
      }
      return [];
    };
    const isTerminal = (status?: string) => status === 'success' || status === 'failed';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const snaps = readTasks(
        await defaultClient.call<unknown>(capability, 'getTasks', {
          taskIds: ids,
          ...(options?.backend ? { backend: options.backend } : {}),
        }),
      );
      options?.onProgress?.(snaps);
      if (snaps.length === ids.length && snaps.every((snap) => isTerminal(snap.status))) {
        return snaps;
      }
      await sleep(intervalMs);
    }
  },
};
