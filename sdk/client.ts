/**
 * CapabilityClient — WorkRally 平台能力（Capability Proxy）HTTP 运行时。
 *
 * 仅使用 Node 内置 `http` 模块，零第三方依赖。
 * 自动读取平台注入的环境变量，支持显式覆盖便于测试。
 *
 * 路由格式：POST http://127.0.0.1:{port}/capability/{capability}/{action}
 */
import http from 'node:http';

/** CapabilityClient 构造参数（全部可选，缺省读环境变量） */
export interface CapabilityClientOptions {
  /** 能力代理端口，覆盖 WORKRALLY_CAPABILITY_PORT */
  port?: number;
  /** 认证 Token，覆盖 WORKRALLY_CAPABILITY_TOKEN */
  token?: string;
}

export class CapabilityClient {
  private readonly port: number;

  private readonly token: string;

  constructor(opts?: CapabilityClientOptions) {
    const envPort = process.env.WORKRALLY_CAPABILITY_PORT;
    const envToken = process.env.WORKRALLY_CAPABILITY_TOKEN;

    const port = opts?.port ?? (envPort ? Number(envPort) : NaN);
    if (!Number.isFinite(port) || port <= 0) {
      // 不在这里抛错，延后到 call 时给出更明确的上下文（区分「未配置」与「测试时未注入」）
      this.port = NaN;
    } else {
      this.port = port;
    }

    this.token = opts?.token ?? envToken ?? '';
  }

  /**
   * 调用一个平台能力方法。
   * @param capability 能力名（如 genImage）
   * @param action action 名（如 submit，cgt 为点分路径如 project.get_filter）
   * @param params 请求参数（可选）
   * @returns 服务端返回的业务 JSON
   */
  call<T>(capability: string, action: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!Number.isFinite(this.port) || this.port <= 0) {
        reject(
          new Error(
            '缺少 WORKRALLY_CAPABILITY_PORT：当前进程未注入平台能力代理端口，' +
              '请确认插件通过平台 MCP 运行时启动，或在测试时显式 new CapabilityClient({ port, token })。',
          ),
        );
        return;
      }
      if (!this.token) {
        reject(
          new Error(
            '缺少 WORKRALLY_CAPABILITY_TOKEN：当前进程未注入平台能力认证 Token，' +
              '请确认插件通过平台 MCP 运行时启动，或在测试时显式 new CapabilityClient({ port, token })。',
          ),
        );
        return;
      }

      const body = JSON.stringify(params ?? {});
      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.port,
          method: 'POST',
          path: `/capability/${capability}/${action}`,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let data: unknown;
            try {
              data = raw ? JSON.parse(raw) : undefined;
            } catch {
              data = raw;
            }

            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data as T);
              return;
            }

            // 非 2xx：解析 { error } 或原始文本作为错误信息
            let message: string;
            if (data && typeof data === 'object' && 'error' in data) {
              message = String((data as { error: unknown }).error);
            } else if (typeof data === 'string') {
              message = data;
            } else {
              message = `请求失败（HTTP ${res.statusCode}）`;
            }
            reject(new Error(message));
          });
        },
      );

      req.on('error', (err) => {
        reject(new Error(`调用平台能力 ${capability}.${action} 失败: ${err.message}`));
      });

      req.write(body);
      req.end();
    });
  }
}

/** 默认客户端：从环境变量读取端口与 Token */
export const defaultClient = new CapabilityClient();
