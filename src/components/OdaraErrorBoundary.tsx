import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordOdaraReloadCrashEvent } from '@/lib/page-reload-crash-recorder';

type OdaraErrorBoundaryProps = {
  children: ReactNode;
};

type OdaraErrorBoundaryState = {
  errorMessage: string | null;
};

export class OdaraErrorBoundary extends Component<OdaraErrorBoundaryProps, OdaraErrorBoundaryState> {
  state: OdaraErrorBoundaryState = {
    errorMessage: null,
  };

  static getDerivedStateFromError(error: Error): OdaraErrorBoundaryState {
    return {
      errorMessage: error.message || error.name || 'Odara hit a display error.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordOdaraReloadCrashEvent({
      componentStack: info.componentStack,
      decision: 'render_error_caught',
      errorMessage: error.message,
      errorName: error.name,
      event: 'react_component_error',
      reason: 'error_boundary',
      source: 'error-boundary',
    });
  }

  render() {
    if (!this.state.errorMessage) return this.props.children;

    return (
      <main className="min-h-screen bg-background px-5 py-8 text-foreground">
        <section className="mx-auto flex max-w-md flex-col gap-4 rounded-xl border border-border/50 bg-card/80 p-5 shadow-sm">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Odara display recovery
            </p>
            <h1 className="mt-2 text-xl font-semibold">Something interrupted this view.</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your session is still preserved. The diagnostic panel captured a safe error breadcrumb.
            </p>
          </div>
          <button
            className="w-fit rounded-md border border-border/60 px-3 py-2 text-sm font-medium text-foreground"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload Odara
          </button>
        </section>
      </main>
    );
  }
}
