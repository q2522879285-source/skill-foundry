import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ExportResult } from '@/lib/api';

type Props = {
  report: ExportResult | null;
  title: string;
  hint: string;
  loading: boolean;
  onGenerate: () => void;
  onCopy: () => void;
};

/**
 * 导出页。重点是「拿去就能用」：一键复制，粘到平时用的 AI 里让它改文件。
 */
export function ReportPanel({ report, title, hint, loading, onGenerate, onCopy }: Props) {
  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</p>
        <Button onClick={onGenerate} disabled={loading}>
          {loading ? '生成中…' : '生成清单'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{(report.bytes / 1024).toFixed(1)} KB</Badge>
        <Button variant="outline" size="sm" onClick={onCopy}>
          复制全文
        </Button>
        <Button variant="ghost" size="sm" onClick={onGenerate} disabled={loading}>
          重新生成
        </Button>
        {report.savedPath ? (
          <span
            className="min-w-0 truncate font-mono text-xs text-muted-foreground"
            title={report.savedPath}
          >
            已保存：{report.savedPath}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        复制后粘贴给你的 AI，它就能照着改。清单不会自动修改任何技能文件。
      </p>
      <ScrollArea className="min-h-0 flex-1 rounded-lg border bg-muted/20">
        <pre className="p-3 text-xs leading-relaxed whitespace-pre-wrap">{report.markdown}</pre>
      </ScrollArea>
    </div>
  );
}
