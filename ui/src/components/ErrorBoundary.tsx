import React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(error, info?.componentStack || '');
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>应用出错了</AlertTitle>
            <AlertDescription>{this.state.error.message || String(this.state.error)}</AlertDescription>
          </Alert>
        </div>
      );
    }
    return this.props.children;
  }
}
