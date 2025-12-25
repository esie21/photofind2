import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react';

type ErrorType = 'network' | 'server' | 'notFound' | 'generic';

interface ErrorStateProps {
  type?: ErrorType;
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

const errorConfig: Record<ErrorType, { icon: any; title: string; message: string }> = {
  network: {
    icon: WifiOff,
    title: 'Connection Error',
    message: 'Please check your internet connection and try again.',
  },
  server: {
    icon: AlertCircle,
    title: 'Server Error',
    message: 'Something went wrong on our end. Please try again later.',
  },
  notFound: {
    icon: AlertCircle,
    title: 'Not Found',
    message: 'The requested resource could not be found.',
  },
  generic: {
    icon: AlertCircle,
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again.',
  },
};

export function ErrorState({
  type = 'generic',
  title,
  message,
  onRetry,
  retrying = false,
}: ErrorStateProps) {
  const config = errorConfig[type];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="relative mb-6">
        <div className="absolute -inset-4 bg-red-50 rounded-full opacity-50 blur-xl" />
        <div className="relative w-20 h-20 bg-red-50 rounded-full flex items-center justify-center ring-8 ring-red-100">
          <Icon className="w-10 h-10 text-red-400" strokeWidth={1.5} />
        </div>
      </div>

      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        {title || config.title}
      </h3>
      <p className="text-sm text-gray-500 max-w-sm mb-6">
        {message || config.message}
      </p>

      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-purple-400"
        >
          <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Retrying...' : 'Try Again'}
        </button>
      )}
    </div>
  );
}

// Inline error for smaller areas
export function InlineError({
  message = 'Failed to load',
  onRetry,
  retrying = false,
}: {
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mb-3">
        <AlertCircle className="w-5 h-5 text-red-500" />
      </div>
      <p className="text-sm text-gray-600 mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Retrying...' : 'Retry'}
        </button>
      )}
    </div>
  );
}

export default ErrorState;
