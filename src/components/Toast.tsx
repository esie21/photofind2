import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  onClose: (id: string) => void;
}

const toastConfig = {
  success: {
    icon: CheckCircle,
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    iconColor: 'text-green-500',
    titleColor: 'text-green-800',
    messageColor: 'text-green-700',
  },
  error: {
    icon: XCircle,
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    iconColor: 'text-red-500',
    titleColor: 'text-red-800',
    messageColor: 'text-red-700',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    iconColor: 'text-yellow-500',
    titleColor: 'text-yellow-800',
    messageColor: 'text-yellow-700',
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    iconColor: 'text-blue-500',
    titleColor: 'text-blue-800',
    messageColor: 'text-blue-700',
  },
};

export function Toast({ id, type, title, message, duration = 5000, onClose }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const config = toastConfig[type];
  const Icon = config.icon;

  useEffect(() => {
    if (duration <= 0) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        handleClose();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onClose(id), 300);
  };

  return (
    <div
      className={`
        relative overflow-hidden rounded-lg border shadow-lg
        ${config.bgColor} ${config.borderColor}
        transform transition-all duration-300 ease-out
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
      `}
      role="alert"
    >
      <div className="p-4 pr-10">
        <div className="flex items-start gap-3">
          <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${config.iconColor}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${config.titleColor}`}>{title}</p>
            {message && (
              <p className={`text-sm mt-1 ${config.messageColor}`}>{message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-3 right-3 p-1 rounded-lg hover:bg-black/5 transition-colors"
        aria-label="Close notification"
      >
        <X className="w-4 h-4 text-gray-500" />
      </button>

      {/* Progress bar */}
      {duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/5">
          <div
            className={`h-full transition-all duration-100 ease-linear ${
              type === 'success' ? 'bg-green-500' :
              type === 'error' ? 'bg-red-500' :
              type === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default Toast;
