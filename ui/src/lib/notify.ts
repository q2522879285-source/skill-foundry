import { toast } from '@/components/ui/toast';

/** 统一提示入口。base-ui 的 toast 是 manager，要 add 才出气泡。 */
export function notify(message: string, type: 'info' | 'success' | 'error' = 'info') {
  toast.add({
    title: message,
    type: type === 'info' ? undefined : type,
  });
}

export function notifyError(err: unknown, fallback = '操作失败') {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : fallback;
  notify(message, 'error');
}
