import { cn } from "./utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-gray-200 animate-pulse rounded-md", className)}
      {...props}
    />
  );
}

// Provider/Service card skeleton
function ProviderCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
      <Skeleton className="w-full h-48" />
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex justify-between items-center pt-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-20 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// Booking card skeleton
function BookingCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <div className="flex items-start gap-4">
        <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center gap-4 pt-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
        <Skeleton className="h-9 w-24 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
    </div>
  );
}

// Stats card skeleton
function StatsCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="w-12 h-12 rounded-xl" />
      </div>
    </div>
  );
}

// Service/Package skeleton
function ServiceCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
      <div className="space-y-3">
        <div className="flex justify-between items-start">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex justify-between items-center pt-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// Notification skeleton
function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-3 p-3">
      <Skeleton className="w-9 h-9 rounded-lg flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

// Table row skeleton
function TableRowSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <tr className="border-b border-gray-100">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full max-w-[120px]" />
        </td>
      ))}
    </tr>
  );
}

export {
  Skeleton,
  ProviderCardSkeleton,
  BookingCardSkeleton,
  StatsCardSkeleton,
  ServiceCardSkeleton,
  NotificationSkeleton,
  TableRowSkeleton
};
