import { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorState } from './ErrorState';

interface Props {
  children: ReactNode;
  /** Full-height centred card (whole app died) vs. inline (one view died, header still usable). */
  variant?: 'page' | 'inline';
  /** Extra escape hatch offered alongside "Try Again" - e.g. "Back to home". */
  onGoHome?: () => void;
}

interface State {
  error: Error | null;
}

// A failed dynamic import() is by far the most likely error here, and it is not a bug:
// chunk filenames carry a content hash, so a deploy that happens while someone has the
// site open leaves their loaded page asking for filenames that no longer exist. Nothing
// in the app can recover from that - only re-fetching index.html can - so it gets its own
// copy telling the user to reload, instead of the generic "try again" that cannot work.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError/i;

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // console.error, not console.log: this survives the production build's log stripping,
    // because an error that reached this point is the one thing worth keeping in the
    // console of a user who is about to describe the problem to support.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  private reload = () => window.location.reload();

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isStale = CHUNK_ERROR.test(error.message);

    const body = (
      <>
        <ErrorState
          type={isStale ? 'network' : 'generic'}
          title={isStale ? 'A new version is available' : undefined}
          message={
            isStale
              ? 'This page was loaded before the site was updated. Reload to get the latest version.'
              : undefined
          }
          // A stale chunk cannot be re-resolved in place, so the only honest action is a
          // reload. Anything else is offering a button that is guaranteed not to work.
          onRetry={isStale ? this.reload : this.reset}
        />

        {/* Dev only: in production this is noise the user cannot act on, and the real
            detail is already in the console via componentDidCatch. */}
        {import.meta.env.DEV && (
          <p className="max-w-md w-full mx-auto mb-4 p-3 bg-gray-100 rounded-lg text-left text-xs font-mono break-all text-gray-600">
            {error.message}
          </p>
        )}

        {!isStale && this.props.onGoHome && (
          <div className="text-center">
            <button
              onClick={() => {
                this.reset();
                this.props.onGoHome!();
              }}
              className="text-sm text-gray-500 underline hover:text-gray-700"
            >
              Back to home
            </button>
          </div>
        )}
      </>
    );

    if (this.props.variant === 'inline') return body;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full">{body}</div>
      </div>
    );
  }
}

export default ErrorBoundary;
