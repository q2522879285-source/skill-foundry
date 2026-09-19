/**
 * DEV-only：给业务 JSX 打 data-source="ui/src/File.tsx:行号"。
 * 不处理 components/ui（组件库内部），避免点选映射到错误文件。
 * 不匹配 TypeScript 泛型（Promise<void>、Record<string, unknown>）。
 */
import type { Plugin } from 'vite';

const TAG_RE = /(^|[^A-Za-z0-9_$.])<([A-Za-z][A-Za-z0-9.]*)(?=[\s/>])/g;

function looksLikeGeneric(rest: string): boolean {
  return /^\s*,/.test(rest) || /^\s+extends\b/.test(rest);
}

export function sourceLocPlugin(enabled: boolean): Plugin {
  return {
    name: 'mcp-app-source-loc',
    enforce: 'pre',
    transform(code, id) {
      if (!enabled) {
        return null;
      }
      if (!id.endsWith('.tsx') && !id.endsWith('.jsx')) {
        return null;
      }
      const norm = id.replaceAll('\\', '/');
      if (norm.includes('/node_modules/') || norm.includes('/components/ui/')) {
        return null;
      }
      const srcIdx = norm.lastIndexOf('/src/');
      if (srcIdx < 0) {
        return null;
      }
      const rel = `ui/src/${norm.slice(srcIdx + 5)}`;
      TAG_RE.lastIndex = 0;
      const next = code.replace(TAG_RE, (full, prefix: string, tag: string, offset: number) => {
        const rest = code.slice(offset + full.length, offset + full.length + 48);
        if (looksLikeGeneric(rest)) {
          return full;
        }
        if (/^\s*data-source=/.test(rest) || rest.includes(' data-source=')) {
          return full;
        }
        const line = code.slice(0, offset).split('\n').length;
        return `${prefix}<${tag} data-source="${rel}:${line}"`;
      });
      if (next === code) {
        return null;
      }
      return { code: next, map: null };
    },
  };
}
