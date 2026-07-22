import { Component, type ErrorInfo, type ReactNode } from 'react';
import { newErrorCode, reportError } from '../lib/errorLog';

type Props = { children: ReactNode };
type State = { errorCode: string | null };

/**
 * Last line of defence: without this, any render-time exception unmounts the whole tree and the
 * member is left on a blank white page with no way forward. Shows a reference code instead and
 * records the stack in the admin error log.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { errorCode: null };

  static getDerivedStateFromError(): State {
    return { errorCode: newErrorCode() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // getDerivedStateFromError generated the code; reuse it so screen and log agree.
    const code = this.state.errorCode ?? newErrorCode();
    reportError(
      code,
      'react_render_crash',
      { component_stack: (info.componentStack ?? '').slice(0, 2000) },
      error.message,
    );
  }

  render() {
    if (!this.state.errorCode) return this.props.children;
    return (
      <div className="layout-max" style={{ padding: '48px 16px', maxWidth: 560 }}>
        <h1 style={{ marginTop: 0 }}>Something went wrong</h1>
        <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
          Sorry - this page could not be displayed. Reloading usually fixes it. If it keeps happening,
          contact <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a>.
        </p>
        <p style={{ marginTop: 16, fontSize: 14, color: 'var(--color-text-secondary)' }}>
          Please quote reference{' '}
          <strong style={{ letterSpacing: '0.04em' }}>{this.state.errorCode}</strong> if you contact us.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
          <a className="btn btn-secondary" href="/">
            Back to home
          </a>
        </div>
      </div>
    );
  }
}
