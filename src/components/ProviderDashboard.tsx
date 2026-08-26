import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Upload, Calendar, PhilippinePeso, Star, TrendingUp, CheckCircle, XCircle, MessageSquare, Users, Camera, Edit, Plus, Trash2, Wallet, Tag, RefreshCw, AlertCircle, ShieldCheck, FileText, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { CATEGORY_OPTIONS } from '../constants/categories';
import { PLATFORM_COMMISSION_PERCENT } from '../constants/payment';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { PortfolioThumbnail, PortfolioPlayer } from './PortfolioMedia';
import { useModal } from '../hooks/useModal';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { BookingCardSkeleton, ServiceCardSkeleton, StatsCardSkeleton } from './ui/skeleton';
import { EmptyState } from './EmptyState';
import { ErrorState, InlineError } from './ErrorState';
import userService from '../api/services/userService';
import serviceService from '../api/services/serviceService';
import bookingService from '../api/services/bookingService';
import availabilityService from '../api/services/availabilityService';
import reviewService, { Review, ReviewStats } from '../api/services/reviewService';
import { getUploadUrl, getStoredPath } from '../api/config';
import type { PortfolioMeta } from '../api/services/authService';
import {
  IMAGE_MIME_TYPES,
  MEDIA_MIME_TYPES,
  isVideoFile,
  isVideoPath,
  formatDuration,
  generatePoster,
  generateThumbnail,
} from '../utils/media';
import { ChatInterface } from './ChatInterface';
import { WalletDashboard } from './WalletDashboard';
import { RescheduleModal } from './RescheduleModal';
import { CompleteBookingModal } from './CompleteBookingModal';
import { DisputeResponsePanel } from './DisputeResponsePanel';
import { BookingDetailsModal } from './BookingDetailsModal';

type ProviderTab = 'overview' | 'profile' | 'availability' | 'bookings' | 'wallet' | 'reviews';

/**
 * A service row as the API returns it, in the shape the pricing editor works with.
 * Three copies of this mapping had drifted apart - one of them disagreed with the other
 * two about whether pricing_type 'both' enables the hourly rate.
 */
const toPackage = (s: any) => ({
  id: s.id,
  title: s.title || '',
  description: s.description || '',
  price: parseFloat(s.price) || 0,
  category: s.category || '',
  // Support both new and legacy pricing fields
  hourly_rate: s.hourly_rate || (s.pricing_type === 'hourly' ? parseFloat(s.price) : null),
  package_price: s.package_price || (s.pricing_type === 'package' ? parseFloat(s.price) : null),
  duration_minutes: s.duration_minutes || null,
  accepts_cash: s.accepts_cash === true,
  // Enable flags for UI
  enable_hourly: !!(s.hourly_rate || s.pricing_type === 'hourly' || s.pricing_type === 'both'),
  enable_package: !!(s.package_price || s.pricing_type === 'package' || s.pricing_type === 'both'),
});

interface ClientTrust {
  completed_count: number;
  cancelled_count: number;
  total_count: number;
  member_since: string | null;
}

// Platform-wide history (not just with this provider), so a "new" client to this
// provider who's actually booked and completed jobs elsewhere still reads as trustworthy.
function getClientTrustBadge(trust: ClientTrust | null | undefined): { label: string; className: string } {
  if (!trust || trust.total_count === 0) {
    return { label: 'New client', className: 'bg-gray-100 text-gray-600' };
  }

  const resolved = trust.completed_count + trust.cancelled_count;
  const completionRate = resolved > 0 ? trust.completed_count / resolved : 0;

  if (trust.completed_count >= 3 && completionRate >= 0.8) {
    return {
      label: `Reliable · ${trust.completed_count} completed`,
      className: 'bg-green-100 text-green-700',
    };
  }
  if (resolved >= 2 && completionRate < 0.5) {
    return {
      label: `${trust.cancelled_count} cancelled booking${trust.cancelled_count === 1 ? '' : 's'}`,
      className: 'bg-amber-100 text-amber-700',
    };
  }
  return {
    label: `${trust.completed_count} completed booking${trust.completed_count === 1 ? '' : 's'}`,
    className: 'bg-blue-100 text-blue-700',
  };
}

interface ProviderDashboardProps {
  initialTab?: ProviderTab;
  tabRequestId?: number;
}

export function ProviderDashboard({ initialTab, tabRequestId }: ProviderDashboardProps = {}) {
  const BASE_URL = ((import.meta as any).env?.VITE_API_URL as string) || 'http://localhost:3001/api';
  const [activeTab, setActiveTab] = useState<ProviderTab>(initialTab || 'overview');

  // Jump to a specific tab whenever the account menu requests one, even if
  // this dashboard is already mounted (tabRequestId changes on every request).
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabRequestId]);
  const [showChat, setShowChat] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [detailsBooking, setDetailsBooking] = useState<any>(null);
  const { user, refreshUser, applyUser } = useAuth();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const portfolioFileRef = useRef<HTMLInputElement | null>(null);
  const verificationFileRef = useRef<HTMLInputElement | null>(null);
  const [uploadingVerification, setUploadingVerification] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [uploadingPortfolio, setUploadingPortfolio] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  // Uploading a video is several steps - capture a poster, send the file, send the
  // poster - and a bare percentage would sit at 0 through the first of them.
  const [uploadStage, setUploadStage] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false);
  // Index of the image the provider has asked to remove, awaiting confirmation.
  // Deleting is irreversible - the backend unlinks the file - so one stray click on a
  // small icon used to be enough to lose a photo for good.
  const [portfolioPendingDelete, setPortfolioPendingDelete] = useState<number | null>(null);
  // Any portfolio write (remove / reorder / caption) in flight, so nothing fires twice.
  const [portfolioBusy, setPortfolioBusy] = useState(false);
  const [portfolioPreview, setPortfolioPreview] = useState<number | null>(null);
  // A rearrangement the provider is still working on. Held locally so that dragging ten
  // photos into place is one save at the end, not ten round trips - and so it can be
  // abandoned wholesale with Cancel.
  const [portfolioDraft, setPortfolioDraft] = useState<string[] | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Bulk selection, by stored path rather than index, so it survives a reorder.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [bulkAlbum, setBulkAlbum] = useState('');
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  // Caption/album being edited in the image detail dialog.
  const [detailDraft, setDetailDraft] = useState<{ caption: string; album: string }>({ caption: '', album: '' });
  const [packages, setPackages] = useState<any[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(false);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [providerBookings, setProviderBookings] = useState<any[]>([]);
  const [isLoadingBookings, setIsLoadingBookings] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);
  const [blockedDates, setBlockedDates] = useState<any[]>([]);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [newBlockDate, setNewBlockDate] = useState('');
  const [newBlockReason, setNewBlockReason] = useState('');
  const [isSavingBlock, setIsSavingBlock] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStats>({ totalReviews: 0, averageRating: '0.0' });
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleBooking, setRescheduleBooking] = useState<any>(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeBookingData, setCompleteBookingData] = useState<any>(null);
  const [recentBookingFilter, setRecentBookingFilter] = useState<'all' | 'upcoming' | 'completed' | 'cancelled'>('all');
  const [allBookingFilter, setAllBookingFilter] = useState<'all' | 'upcoming' | 'completed' | 'cancelled'>('all');
  const [recentBookingPage, setRecentBookingPage] = useState(1);
  const [allBookingPage, setAllBookingPage] = useState(1);
  const recentBookingItemsPerPage = 5;
  const allBookingItemsPerPage = 10;
  // Seed the form from what the provider actually has. This used to fall back to
  // 'Sarah Johnson', 10 years and 'Photography', which were then written to the
  // account on the first Save - inventing data the provider never entered. Real
  // values only; the sample text lives in each input's placeholder instead.
  const seedFormState = (u: any) => ({
    name: u?.name ?? '',
    title: u?.title ?? '',
    bio: u?.bio ?? '',
    location: u?.location ?? '',
    category: u?.category ?? '',
    // '' rather than 0 so an unset value stays unset instead of claiming zero years.
    years_experience: u?.years_experience ?? '',
    // Hold the RAW stored paths, not display URLs. Save posts these fields straight
    // back, so seeding them with getUploadUrl() meant every save wrote the display URL
    // into the database - each one prepending another "/uploads/" to the stored path
    // until the image 404'd. Display URLs are built at render time instead.
    profile_image: u?.profile_image ?? '',
    portfolio_images: (u?.portfolio_images || []) as string[],
    portfolio_meta: (u?.portfolio_meta || {}) as PortfolioMeta,
  });

  // These mirror the server's own rules (uploadService.MAX_FILE_SIZE, MAX_VIDEO_SIZE,
  // MEDIA_MIME_TYPES and users.ts MAX_PORTFOLIO_FILES). Checking here first means a
  // provider who picks thirty photos, a 25MB RAW export or a ten-minute clip is told
  // immediately, instead of waiting out a long upload only for the backend to reject
  // the entire batch.
  const MAX_PORTFOLIO_IMAGES = 24;
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
  const MAX_BATCH_BYTES = 250 * 1024 * 1024;
  // Nothing enforces this server-side - the file is whatever length it is - but a
  // portfolio is a showreel, not a feature. Capping it keeps both the upload and the
  // client's eventual download honest, since nothing here transcodes.
  const MAX_VIDEO_SECONDS = 60;
  const ALLOWED_IMAGE_TYPES = IMAGE_MIME_TYPES;
  const ALLOWED_MEDIA_TYPES = MEDIA_MIME_TYPES;

  /**
   * Returns an error message if these files can't be uploaded, or null if they can.
   *
   * `slotsLeft` is only meaningful for the portfolio; pass null for single uploads.
   * `allowVideo` is false for the profile photo, which is an image and nothing else.
   */
  const validateMediaFiles = (
    files: File[],
    slotsLeft: number | null,
    allowVideo = true
  ): string | null => {
    if (slotsLeft !== null && files.length > slotsLeft) {
      return slotsLeft === 0
        ? `You've reached the ${MAX_PORTFOLIO_IMAGES}-item limit. Remove one to add another.`
        : `You can add ${slotsLeft} more item${slotsLeft === 1 ? '' : 's'} - you selected ${files.length}.`;
    }

    const allowed = allowVideo ? ALLOWED_MEDIA_TYPES : ALLOWED_IMAGE_TYPES;
    const wrongType = files.find((f) => !allowed.includes(f.type) && !(allowVideo && isVideoFile(f)));
    if (wrongType) {
      return allowVideo
        ? `"${wrongType.name}" isn't a supported file. Use JPEG, PNG, GIF, WEBP, MP4, WEBM or MOV.`
        : `"${wrongType.name}" isn't a supported image. Use JPEG, PNG, GIF or WEBP.`;
    }

    const tooBig = files.find((f) => f.size > (isVideoFile(f) ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES));
    if (tooBig) {
      const limit = isVideoFile(tooBig) ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
      return `"${tooBig.name}" is larger than ${limit / 1024 / 1024}MB.`;
    }

    // Matches uploadService.MAX_REQUEST_SIZE - the server rejects the whole batch past
    // this, so catching it here saves sending the bytes first.
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_BATCH_BYTES) {
      return `That's ${Math.round(total / 1024 / 1024)}MB at once. Upload up to ${MAX_BATCH_BYTES / 1024 / 1024}MB per batch.`;
    }
    return null;
  };

  const [formState, setFormState] = useState<any>(() => seedFormState(user));

  // Mirrors the limits PUT /api/users/:id enforces (which in turn mirror the column
  // widths). Catching it here means the common mistakes never round-trip.
  // A service priced at 0 isn't just odd: booking price validation and the payment
  // underpayment check are both guarded by `servicePrice > 0`, so a free service skips
  // price validation entirely and can be booked for any amount. The backend rejects it
  // too; this stops the provider getting there in the first place.
  const validatePackages = (pkgs: any[]): string | null => {
    for (const pkg of pkgs) {
      const label = pkg.title?.trim() || 'Untitled service';
      if (!pkg.title || !String(pkg.title).trim()) return 'Every service needs a name.';
      if (!pkg.enable_hourly && !pkg.enable_package) {
        return `"${label}" needs either an hourly rate or a package price.`;
      }
      if (pkg.enable_hourly && !(Number(pkg.hourly_rate) > 0)) {
        return `"${label}" needs an hourly rate greater than zero.`;
      }
      if (pkg.enable_package && !(Number(pkg.package_price) > 0)) {
        return `"${label}" needs a package price greater than zero.`;
      }
      // A new service used to start pre-filled with 'Photography' and save that way
      // if the picker was never touched, so a videographer's or makeup artist's first
      // service silently landed under the wrong category - invisible to them and
      // unfindable by clients filtering on their actual specialty.
      if (!pkg.category || !String(pkg.category).trim()) {
        return `"${label}" needs a category.`;
      }
    }
    return null;
  };

  const validateProfile = (f: any): string | null => {
    if (!f.name || !String(f.name).trim()) return 'Name is required.';
    if (String(f.name).trim().length > 100) return 'Name must be 100 characters or fewer.';
    if (String(f.title || '').trim().length > 255) return 'Title must be 255 characters or fewer.';
    if (String(f.location || '').trim().length > 255) return 'Location must be 255 characters or fewer.';
    if (String(f.bio || '').trim().length > 5000) return 'Bio must be 5000 characters or fewer.';
    if (f.years_experience !== '' && f.years_experience !== null && f.years_experience !== undefined) {
      const y = Number(f.years_experience);
      if (!Number.isInteger(y) || y < 0 || y > 80) return 'Years of experience must be a whole number between 0 and 80.';
    }
    return null;
  };


  /**
   * Writes a new portfolio arrangement and/or its captions to the server, then to the
   * form.
   *
   * Server first, deliberately: updating local state up front made a failed request
   * look like it had worked, and the change silently reverted on the next refresh.
   *
   * The image list always goes with the request even when only captions changed. The
   * backend prunes portfolio_meta against it, so sending both is what keeps a removed
   * photo's caption from lingering in the column.
   */
  const persistPortfolio = async (
    next: { images?: string[]; meta?: PortfolioMeta },
    success: { title: string; body: string }
  ) => {
    if (!user || portfolioBusy) return false;

    const images = next.images ?? (formState.portfolio_images || []);
    const keys = new Set(images.map((img: string) => getStoredPath(img)));
    // Mirror the server's pruning locally, so the form doesn't hold captions for images
    // that no longer exist until the next refresh.
    const sourceMeta: PortfolioMeta = next.meta ?? (formState.portfolio_meta || {});
    const meta: PortfolioMeta = {};
    for (const [path, value] of Object.entries(sourceMeta)) {
      if (keys.has(getStoredPath(path))) meta[getStoredPath(path)] = value;
    }

    setPortfolioBusy(true);
    try {
      // The PUT returns the full updated row, so the signed-in user is refreshed from
      // that rather than by a second call to /auth/me - which is what every reorder,
      // caption edit and deletion used to cost.
      const updated = await userService.updateUser(user.id, {
        portfolio_images: images,
        portfolio_meta: meta,
      });
      setFormState((s: any) => ({
        ...s,
        portfolio_images: (updated.portfolio_images || images) as string[],
        portfolio_meta: (updated.portfolio_meta || meta) as PortfolioMeta,
      }));
      applyUser(updated);
      toast.success(success.title, success.body);
      return true;
    } catch (err: any) {
      console.error('Portfolio update failed', err);
      toast.error('Could not update your portfolio', err?.message || 'Please try again.');
      return false;
    } finally {
      setPortfolioBusy(false);
    }
  };

  /** Uploads a batch of photos and videos, shared by the file picker and the drop zone. */
  const uploadPortfolioFiles = async (files: File[], slotsLeft: number) => {
    if (!user || files.length === 0) return;

    // Check before uploading, not after. The backend rejects the whole batch if it would
    // breach the limit, so without this a provider could sit through a 20-file upload
    // and end up with none of them.
    const problem = validateMediaFiles(files, slotsLeft);
    if (problem) {
      toast.error('Cannot add those files', problem);
      return;
    }

    setUploadingPortfolio(true);
    setUploadProgress(0);
    try {
      // Every item gets a small derived image before anything is sent: videos a poster
      // frame, photos a gallery-sized thumbnail. The grids render these instead of the
      // originals - a 24-photo portfolio was fetching tens of megabytes to draw tiles a
      // few hundred pixels wide.
      //
      // Doing it first also means a clip that turns out to be too long is caught before
      // its bytes go over the wire, since the browser is the only thing here that can
      // decode video.
      setUploadStage(`Preparing ${files.length} file${files.length === 1 ? '' : 's'}...`);
      const previews: Array<{ file: File; poster?: File; thumb?: File; duration?: number; width?: number; height?: number } | null> = [];

      for (const file of files) {
        if (isVideoFile(file)) {
          const result = await generatePoster(file);
          if (result && result.duration > MAX_VIDEO_SECONDS + 1) {
            toast.error(
              'That video is too long',
              `"${file.name}" runs ${formatDuration(result.duration)}. Portfolio videos can be up to ${MAX_VIDEO_SECONDS} seconds.`
            );
            return;
          }
          // A null result just means this browser couldn't decode the file (Chrome and
          // Firefox generally refuse .mov). The upload still goes ahead; the thumbnail
          // falls back to whatever first frame the viewer's own browser can show.
          previews.push(
            result
              ? {
                  file,
                  poster: result.poster,
                  duration: result.duration,
                  width: result.width,
                  height: result.height,
                }
              : null
          );
        } else {
          const result = await generateThumbnail(file);
          previews.push(
            result ? { file, thumb: result.thumb, width: result.width, height: result.height } : null
          );
        }
      }

      setUploadStage('Uploading...');
      const previous = new Set(
        ((formState.portfolio_images || []) as string[]).map((img) => getStoredPath(img))
      );
      const resp = await userService.uploadPortfolioImages(user.id, files, setUploadProgress);

      // The server appends in request order and rejects the whole batch if any file
      // fails its checks, so the new paths line up one-for-one with what was sent.
      const added = ((resp.portfolio_images || []) as string[]).filter(
        (img) => !previous.has(getStoredPath(img))
      );

      const withPreviews = added
        .map((path, index) => ({ path, preview: previews[index] }))
        .filter((pair) => pair.preview);

      if (withPreviews.length > 0) {
        setUploadStage(`Saving ${withPreviews.length} thumbnail${withPreviews.length === 1 ? '' : 's'}...`);
        // In parallel: these are small and independent, and sending them one at a time
        // made a twenty-photo upload wait out twenty consecutive round trips. Failures
        // are tolerated individually - the originals are already safely stored, and a
        // missing thumbnail only means that tile loads the full-size file.
        await Promise.allSettled(
          withPreviews.map(({ path, preview }) =>
            userService
              .uploadPortfolioPreview(user.id, getStoredPath(path), {
                kind: preview!.poster ? 'poster' : 'thumb',
                file: (preview!.poster || preview!.thumb)!,
                duration: preview!.duration,
                width: preview!.width,
                height: preview!.height,
              })
              .catch((e) => {
                console.error('Preview upload failed for', path, e);
                throw e;
              })
          )
        );
      }

      // One read at the end settles what all those parallel writes produced, and doubles
      // as the refresh the signed-in user needs. The form is set directly because the
      // resync effect is deliberately paused while editing, so new items would otherwise
      // not appear until the edit ended.
      const fresh = (await refreshUser()) || resp;
      setFormState((s: any) => ({
        ...s,
        portfolio_images: (fresh.portfolio_images || []) as string[],
        portfolio_meta: (fresh.portfolio_meta || {}) as PortfolioMeta,
      }));
      toast.success(
        'Added to your portfolio',
        `${files.length} file${files.length > 1 ? 's' : ''} uploaded.`
      );
    } catch (err: any) {
      console.error('Portfolio upload failed', err);
      toast.error('Upload failed', err?.message || 'Could not upload those files.');
    } finally {
      setUploadingPortfolio(false);
      setUploadProgress(0);
      setUploadStage('');
    }
  };

  // Calculate real stats from bookings
  const stats = (() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const upcomingBookings = providerBookings.filter(b =>
      ['pending', 'accepted', 'confirmed'].includes(b.status) &&
      new Date(b.date) >= now
    ).length;

    const completedBookings = providerBookings.filter(b => b.status === 'completed').length;

    const recentEarnings = providerBookings
      .filter(b => b.status === 'completed' && new Date(b.date) >= thirtyDaysAgo)
      .reduce((sum, b) => sum + (b.amount || 0), 0);

    const pendingBookings = providerBookings.filter(b => b.status === 'pending').length;

    return [
      { label: 'Upcoming Bookings', value: String(upcomingBookings), change: `${pendingBookings} pending`, icon: Calendar, color: 'purple' },
      { label: 'Earnings (30d)', value: `₱${recentEarnings.toLocaleString()}`, change: 'Last 30 days', icon: PhilippinePeso, color: 'green' },
      { label: 'Completed Bookings', value: String(completedBookings), change: 'All time', icon: TrendingUp, color: 'blue' },
      { label: 'Total Bookings', value: String(providerBookings.length), change: 'All statuses', icon: Star, color: 'yellow' },
    ];
  })();

  // Re-seed the form when the signed-in user changes - but never while they are
  // editing. refreshUser() runs after portfolio uploads, portfolio deletes and
  // verification uploads, and this effect would fire on the resulting `user` change
  // and silently throw away everything typed but not yet saved.
  useEffect(() => {
    if (!user || editMode) return;
    setFormState(seedFormState(user));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, editMode]);

  // Leaving edit mode - by saving or by cancelling - abandons any portfolio work that
  // was still only staged locally, so it can't reappear the next time editing starts.
  useEffect(() => {
    if (editMode) return;
    setPortfolioDraft(null);
    setPortfolioPendingDelete(null);
    setDragIndex(null);
    setSelectMode(false);
    setSelectedPaths([]);
    setBulkAlbum('');
    setBulkDeleteConfirm(false);
  }, [editMode]);

  /**
   * The provider's own services, in the shape the pricing editor works with.
   *
   * This used to call getAllServices() - every service on the platform - and filter by
   * provider id in the browser, in three separate places. The per-provider endpoint has
   * always existed and the backend already resolves the users-vs-providers foreign key
   * for it, so the whole list was being fetched and thrown away.
   */
  const loadPackages = useCallback(async () => {
    if (!user || user.role !== 'provider') return;

    setIsLoadingPackages(true);
    setPackagesError(null);
    try {
      const providerServices = await serviceService.getServicesByProvider(user.id);
      // Start empty when there are none. This used to seed three placeholder packages
      // with id: null - which looked like real services in the editor, so the next
      // profile save (even one that only changed the bio) created all three as genuine
      // bookable services at prices the provider never chose.
      setPackages((providerServices || []).map(toPackage));
    } catch (error: any) {
      // Same reasoning as above - never invent services the provider didn't create,
      // least of all when we don't even know what they already have.
      console.error('Failed to load packages:', error);
      setPackagesError(error?.message || 'Could not load your services.');
      setPackages([]);
    } finally {
      setIsLoadingPackages(false);
    }
  }, [user]);

  // Load on sign-in, and again whenever edit mode ends, since services may have been
  // saved. Two near-identical effects used to do this, each fetching the full service
  // list independently.
  useEffect(() => {
    loadPackages();
  }, [loadPackages, editMode]);

  const fetchBookings = async () => {
    if (!user || (user.role !== 'provider' && user.role !== 'admin')) return;
    setIsLoadingBookings(true);
    setBookingsError(null);
    try {
      const data = await bookingService.getMyProviderBookings();
      const mapped = (data || []).map((b: any) => {
        const start = b.start_date ? new Date(b.start_date) : b.startDate ? new Date(b.startDate) : null;
        // Always render in Manila time so bookings show consistently regardless
        // of the viewer's device timezone.
        const date = start ? start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : '';
        const time = start ? start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : '';

        // Handle client image URL
        let clientImage = b.client_image;
        if (clientImage) {
          clientImage = getUploadUrl(clientImage);
        } else {
          clientImage = `https://ui-avatars.com/api/?name=${encodeURIComponent(b.client_name || 'Client')}&background=7c3aed&color=fff`;
        }

        return {
          id: b.id,
          client_id: b.client_user_id || b.client_id,
          client: b.client_name || b.client_email || 'Client',
          clientEmail: b.client_email,
          service: b.service_title || b.service_name || 'Service',
          date,
          time,
          start_date: b.start_date,
          end_date: b.end_date,
          amount: Number(b.total_price || b.totalPrice || 0),
          status: b.status,
          payment_status: b.payment_status,
          image: clientImage,
          reschedule_pending_approval: b.reschedule_pending_approval,
          rescheduled_by: b.rescheduled_by,
          client_trust: b.client_trust as ClientTrust | null,
          // Everything below exists on the raw response (BookingsPage's mapping already
          // reads all of it) but was dropped here, so BookingDetailsModal had nothing to
          // render and the dispute banner below could never show the client's actual
          // reason - dispute_reason was referenced but never populated.
          service_description: b.service_description,
          service_category: b.service_category,
          service_duration_minutes: b.service_duration_minutes,
          payment_due_at: b.payment_due_at,
          payment_method: b.payment_method || 'online',
          cash_confirmed_at: b.cash_confirmed_at,
          created_at: b.created_at,
          accepted_at: b.accepted_at,
          rejected_at: b.rejected_at,
          cancelled_at: b.cancelled_at,
          completed_at: b.completed_at,
          cancellation_reason: b.cancellation_reason,
          dispute_reason: b.dispute_reason,
          dispute_response: b.dispute_response,
          dispute_response_at: b.dispute_response_at,
          dispute_resolution: b.dispute_resolution,
          dispute_resolved_at: b.dispute_resolved_at,
          provider_completed_at: b.provider_completed_at,
          client_confirmed_at: b.client_confirmed_at,
          completion_notes: b.completion_notes,
          rescheduled_at: b.rescheduled_at,
          reschedule_reason: b.reschedule_reason,
          reschedule_count: b.reschedule_count,
          original_start_date: b.original_start_date,
          original_end_date: b.original_end_date,
        };
      });
      setProviderBookings(mapped);
    } catch (e: any) {
      setBookingsError(e?.message || 'Failed to load bookings');
      setProviderBookings([]);
    } finally {
      setIsLoadingBookings(false);
    }
  };

  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  const handleApproveReschedule = async (bookingId: string) => {
    setReschedulingId(bookingId);
    try {
      await bookingService.approveReschedule(String(bookingId));
      toast.success('New time confirmed', 'The proposed time is now the confirmed booking time.');
      fetchBookings();
    } catch (e: any) {
      toast.error('Failed to confirm', e?.message || 'Could not confirm the new time.');
    } finally {
      setReschedulingId(null);
    }
  };

  const handleRejectReschedule = async (bookingId: string) => {
    setReschedulingId(bookingId);
    try {
      await bookingService.rejectReschedule(String(bookingId));
      toast.info('Reverted to original time', 'The proposed time was declined.');
      fetchBookings();
    } catch (e: any) {
      toast.error('Failed to decline', e?.message || 'Could not decline the new time.');
    } finally {
      setReschedulingId(null);
    }
  };

  const fetchAvailability = async () => {
    if (!user || (user.role !== 'provider' && user.role !== 'admin')) return;
    setIsLoadingAvailability(true);
    setAvailabilityError(null);
    try {
      // Fetch blocked dates (overrides where is_available = false)
      const from = new Date().toISOString().split('T')[0];
      const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const data = await availabilityService.getOverrides(String(user.id), from, to);
      // Filter only blocked dates
      const blocked = (data || []).filter((o: any) => !o.is_available);
      setBlockedDates(blocked);
    } catch (e: any) {
      setAvailabilityError(e?.message || 'Failed to load availability');
      setBlockedDates([]);
    } finally {
      setIsLoadingAvailability(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, [user]);

  useEffect(() => {
    fetchAvailability();
  }, [user]);

  const fetchReviews = async () => {
    if (!user || (user.role !== 'provider' && user.role !== 'admin')) return;
    setIsLoadingReviews(true);
    setReviewsError(null);
    try {
      const data = await reviewService.getReceivedReviews();
      setReviews(data.reviews || []);
      setReviewStats(data.stats || { totalReviews: 0, averageRating: '0.0' });
    } catch (e: any) {
      setReviewsError(e?.message || 'Failed to load reviews');
      setReviews([]);
    } finally {
      setIsLoadingReviews(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [user]);

  const bookingRequests = providerBookings;

  // Clients now pay only after the provider accepts, so an accepted booking can sit
  // unpaid for a while. Surface that instead of letting the provider assume the money
  // is already in escrow. payment_status is 'unpaid' until an intent exists and
  // 'pending' while one is in flight - only 'paid' means it actually landed.
  const renderPaymentPill = (booking: any) => {
    if (!['accepted', 'confirmed'].includes(booking.status)) return null;
    const paid = booking.payment_status === 'paid';
    return (
      <span className={`px-3 py-1 rounded-full text-sm ${paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
        {paid ? 'Paid' : 'Unpaid'}
      </span>
    );
  };

  // Distinct clients this provider has actually served (a booking that never went
  // anywhere doesn't count).
  const distinctClientCount = useMemo(() => {
    const ids = new Set(
      providerBookings
        .filter((b: any) => !['cancelled', 'rejected'].includes(b.status))
        .map((b: any) => String(b.client_id ?? b.client))
        .filter((id: string) => id && id !== 'undefined')
    );
    return ids.size;
  }, [providerBookings]);

  const getBookingCategory = (status: string) => {
    if (status === 'completed') return 'completed';
    if (['cancelled', 'rejected', 'disputed'].includes(status)) return 'cancelled';
    return 'upcoming';
  };

  const recentFilteredBookings = useMemo(() => {
    const sorted = [...bookingRequests].sort((a, b) => {
      const aDate = new Date(a.start_date || a.date).getTime();
      const bDate = new Date(b.start_date || b.date).getTime();
      return bDate - aDate;
    });
    if (recentBookingFilter === 'all') return sorted;
    return sorted.filter((booking) => getBookingCategory(booking.status) === recentBookingFilter);
  }, [bookingRequests, recentBookingFilter]);

  const recentTotalPages = Math.max(1, Math.ceil(recentFilteredBookings.length / recentBookingItemsPerPage));
  const safeRecentPage = Math.min(recentBookingPage, recentTotalPages);
  const recentPaginatedBookings = useMemo(() => {
    const start = (safeRecentPage - 1) * recentBookingItemsPerPage;
    return recentFilteredBookings.slice(start, start + recentBookingItemsPerPage);
  }, [recentFilteredBookings, safeRecentPage]);

  const allFilteredBookings = useMemo(() => {
    if (allBookingFilter === 'all') return bookingRequests;
    return bookingRequests.filter((booking) => getBookingCategory(booking.status) === allBookingFilter);
  }, [bookingRequests, allBookingFilter]);

  const allTotalPages = Math.max(1, Math.ceil(allFilteredBookings.length / allBookingItemsPerPage));
  const safeAllPage = Math.min(allBookingPage, allTotalPages);
  const allPaginatedBookings = useMemo(() => {
    const start = (safeAllPage - 1) * allBookingItemsPerPage;
    return allFilteredBookings.slice(start, start + allBookingItemsPerPage);
  }, [allFilteredBookings, safeAllPage]);

  useEffect(() => {
    setRecentBookingPage(1);
  }, [recentBookingFilter]);

  useEffect(() => {
    setAllBookingPage(1);
  }, [allBookingFilter]);

  const portfolioImages: string[] = formState.portfolio_images || [];
  const portfolioMeta: PortfolioMeta = formState.portfolio_meta || {};
  const portfolioSlotsLeft = Math.max(0, MAX_PORTFOLIO_IMAGES - portfolioImages.length);

  // What the grid renders: the unsaved arrangement while one is in progress, otherwise
  // the saved order.
  const displayOrder = portfolioDraft ?? portfolioImages;
  const orderDirty = useMemo(
    () =>
      portfolioDraft !== null &&
      (portfolioDraft.length !== portfolioImages.length ||
        portfolioDraft.some((img, i) => img !== portfolioImages[i])),
    [portfolioDraft, portfolioImages]
  );

  // Dragging fires a state update on every dragenter, so the whole dashboard re-renders
  // dozens of times over one gesture. These are the values the grid reads on each of
  // those renders; recomputing them every time is the difference between a smooth drag
  // and a stuttering one on a full 24-item portfolio.
  const metaFor = useCallback(
    (image: string) => portfolioMeta[getStoredPath(image)] || {},
    [portfolioMeta]
  );

  /** Opens the detail dialog for one image, seeded with its current caption and album. */
  const openImageDetail = (index: number) => {
    const meta = metaFor((portfolioDraft ?? (formState.portfolio_images || []))[index] || '');
    setDetailDraft({ caption: meta.caption || '', album: meta.album || '' });
    setPortfolioPreview(index);
  };

  // Albums are whatever the provider has actually typed - there is no fixed list to
  // maintain, and the datalist below turns previous answers into suggestions.
  const albumNames = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(portfolioMeta)
            .map((m) => (m?.album || '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [portfolioMeta]
  );

  /** Moves an image within the working order. */
  const moveImage = (from: number, to: number) => {
    const list = [...displayOrder];
    if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    setPortfolioDraft(list);
  };

  const toggleSelected = (image: string) => {
    const path = getStoredPath(image);
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };
  const isSelected = (image: string) => selectedPaths.includes(getStoredPath(image));

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedPaths([]);
    setBulkAlbum('');
    setBulkDeleteConfirm(false);
  };

  const previewOpen =
    portfolioPreview !== null && portfolioPreview >= 0 && portfolioPreview < displayOrder.length;
  const previewImage = previewOpen ? displayOrder[portfolioPreview!] : '';

  // Providers could only ever see their portfolio as small thumbnails here - there was
  // no way to check a photo at full size, let alone label it, without opening their own
  // public profile.
  const { overlayProps: previewOverlayProps, cardProps: previewCardProps } = useModal(
    () => setPortfolioPreview(null),
    { enabled: previewOpen, closeOnEscape: !portfolioBusy, label: 'Portfolio image details' }
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm p-2 mb-6 flex gap-2 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'profile', label: 'Profile' },
            { id: 'availability', label: 'Availability' },
            { id: 'bookings', label: 'Bookings' },
            { id: 'wallet', label: 'Wallet' },
            { id: 'reviews', label: 'Reviews' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-6 py-3 rounded-xl whitespace-nowrap transition-all ${activeTab === tab.id
                ? 'bg-purple-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {stats.map((stat: any, index: number) => {
                const Icon = stat.icon;
                return (
                  <div key={index} className="bg-white rounded-2xl p-6 shadow-sm">
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-12 h-12 rounded-xl bg-${stat.color}-100 flex items-center justify-center`}>
                        <Icon className={`w-6 h-6 text-${stat.color}-600`} />
                      </div>
                      <span className="text-sm text-green-600">{stat.change}</span>
                    </div>
                    <div className="text-2xl text-gray-900 mb-1">{stat.value}</div>
                    <div className="text-sm text-gray-600">{stat.label}</div>
                  </div>
                );
              })}
            </div>

            {/* Booking Requests */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <h2 className="text-gray-900">Recent Booking Requests</h2>
                <div className="flex items-center gap-2">
                  {(['all', 'upcoming', 'completed', 'cancelled'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setRecentBookingFilter(filter)}
                      className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                        recentBookingFilter === filter
                          ? 'bg-purple-600 text-white'
                          : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                {isLoadingBookings ? (
                  <>
                    {Array.from({ length: 2 }).map((_, i) => (
                      <BookingCardSkeleton key={i} />
                    ))}
                  </>
                ) : bookingsError ? (
                  <InlineError
                    message={bookingsError}
                    onRetry={fetchBookings}
                    retrying={isLoadingBookings}
                  />
                ) : recentFilteredBookings.length === 0 ? (
                  <EmptyState
                    type="bookings"
                    title="No booking requests"
                    description="New booking requests from clients will appear here."
                  />
                ) : recentPaginatedBookings.map((booking) => (
                  <div key={booking.id} className="p-4 border border-gray-200 rounded-xl hover:border-purple-300 transition-colors">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <ImageWithFallback
                        src={booking.image}
                        alt={booking.client}
                        className="w-full sm:w-20 h-20 object-cover rounded-lg"
                      />
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-gray-900">{booking.client}</h3>
                              {(() => {
                                const badge = getClientTrustBadge(booking.client_trust);
                                return (
                                  <span
                                    title="Based on this client's booking history across the whole platform"
                                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                                  >
                                    {badge.label}
                                  </span>
                                );
                              })()}
                            </div>
                            <p className="text-sm text-gray-600">{booking.service || 'Service'}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-purple-600">₱{booking.amount}</div>
                            {/* Whether this one is cash is a material fact *before*
                                accepting, not after: the provider collects it themselves
                                and is billed the commission out of their wallet. Nothing
                                on this card said so, and this is the page they accept from. */}
                            {booking.payment_method === 'cash' && (
                              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                                <PhilippinePeso className="w-3 h-3" />
                                {booking.payment_status === 'paid' ? 'Cash received' : 'Cash on the day'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mb-3">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            <span>{booking.date}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span>{booking.time}</span>
                          </div>
                        </div>
                        {booking.status === 'pending' ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={async () => {
                                try {
                                  await bookingService.updateBooking(String(booking.id), { status: 'accepted' } as any);
                                  setProviderBookings((prev) => prev.map((b: any) => b.id === booking.id ? { ...b, status: 'accepted' } : b));
                                  toast.success('Booking accepted', `Booking with ${booking.client} has been confirmed.`);
                                } catch (e) {
                                  console.error('Failed to accept booking', e);
                                  toast.error('Failed to accept', 'Please try again.');
                                }
                              }}
                              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-2"
                            >
                              <CheckCircle className="w-4 h-4" />
                              Accept
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  await bookingService.updateBooking(String(booking.id), { status: 'rejected' } as any);
                                  setProviderBookings((prev) => prev.map((b: any) => b.id === booking.id ? { ...b, status: 'rejected' } : b));
                                  toast.info('Booking declined', 'The client has been notified.');
                                } catch (e) {
                                  console.error('Failed to reject booking', e);
                                  toast.error('Failed to decline', 'Please try again.');
                                }
                              }}
                              className="px-4 py-2 border border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm flex items-center gap-2"
                            >
                              <XCircle className="w-4 h-4" />
                              Decline
                            </button>
                            <button
                              onClick={() => {
                                setSelectedBookingId(booking.id);
                                setShowChat(true);
                              }}
                              className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                            >
                              <MessageSquare className="w-4 h-4" />
                              Message
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                              {booking.status === 'awaiting_confirmation' ? 'Awaiting Confirmation' :
                                booking.status === 'disputed' ? 'Disputed' :
                                  booking.status === 'completed' ? 'Completed' : 'Confirmed'}
                            </span>
                            {renderPaymentPill(booking)}
                            {/* Paid only - the server refuses to complete an unpaid
                                booking, and offering the button anyway just produces a
                                rejection after the evidence has been picked. */}
                            {['accepted', 'confirmed'].includes(booking.status) &&
                              booking.payment_status === 'paid' &&
                              new Date(booking.start_date || booking.date) <= new Date() && (
                                <button
                                  onClick={() => {
                                    setCompleteBookingData({
                                      id: String(booking.id),
                                      service_title: booking.service || 'Service',
                                      client_name: booking.client || 'Client',
                                      start_date: booking.start_date || booking.date,
                                    });
                                    setShowCompleteModal(true);
                                  }}
                                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm flex items-center gap-2"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                  Mark Complete
                                </button>
                              )}
                            {booking.reschedule_pending_approval ? (
                              String(booking.rescheduled_by) === String(user?.id) ? (
                                <span className="px-3 py-2 text-orange-600 text-sm flex items-center gap-1">
                                  <RefreshCw className="w-4 h-4" />
                                  Awaiting client confirmation
                                </span>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleApproveReschedule(String(booking.id))}
                                    disabled={reschedulingId === String(booking.id)}
                                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                    Confirm New Time
                                  </button>
                                  <button
                                    onClick={() => handleRejectReschedule(String(booking.id))}
                                    disabled={reschedulingId === String(booking.id)}
                                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
                                  >
                                    Keep Original Time
                                  </button>
                                </>
                              )
                            ) : ['pending', 'accepted', 'confirmed'].includes(booking.status) && (
                              <button
                                onClick={() => {
                                  setRescheduleBooking({
                                    id: booking.id,
                                    service: booking.service,
                                    client: booking.client,
                                    date: booking.date,
                                    time: booking.time,
                                    start_date: booking.start_date,
                                    end_date: booking.end_date,
                                  });
                                  setShowRescheduleModal(true);
                                }}
                                className="px-4 py-2 border border-orange-500 text-orange-600 rounded-lg hover:bg-orange-50 transition-colors text-sm flex items-center gap-2"
                              >
                                <RefreshCw className="w-4 h-4" />
                                Reschedule
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedBookingId(booking.id);
                                setShowChat(true);
                              }}
                              className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                            >
                              <MessageSquare className="w-4 h-4" />
                              Message
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {!isLoadingBookings && !bookingsError && recentFilteredBookings.length > 0 && (
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <p className="text-sm text-gray-600">
                    Showing {(safeRecentPage - 1) * recentBookingItemsPerPage + 1}-
                    {(safeRecentPage - 1) * recentBookingItemsPerPage + recentPaginatedBookings.length} of {recentFilteredBookings.length}
                  </p>
                  {recentTotalPages > 1 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setRecentBookingPage((p) => Math.max(1, p - 1))}
                        disabled={safeRecentPage === 1}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        Previous
                      </button>
                      {Array.from({ length: recentTotalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          onClick={() => setRecentBookingPage(page)}
                          className={`w-9 h-9 rounded-lg text-sm ${
                            safeRecentPage === page
                              ? 'bg-purple-600 text-white'
                              : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        onClick={() => setRecentBookingPage((p) => Math.min(recentTotalPages, p + 1))}
                        disabled={safeRecentPage === recentTotalPages}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'availability' && (
          <div className="space-y-6">
            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
              <h3 className="text-blue-900 font-medium mb-2">How Booking Works</h3>
              <p className="text-blue-700 text-sm">
                Clients can request bookings for any date and time. You'll receive a notification to accept or decline each request.
                Use this page to block dates when you're not available (vacations, holidays, etc.).
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Block Date Form */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h3 className="text-gray-900 font-medium mb-4">Block a Date</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Block dates when you're unavailable. Clients won't be able to book on these dates.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Date to Block</label>
                    <input
                      type="date"
                      value={newBlockDate}
                      onChange={(e) => setNewBlockDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Reason (optional)</label>
                    <input
                      type="text"
                      value={newBlockReason}
                      onChange={(e) => setNewBlockReason(e.target.value)}
                      placeholder="e.g., Vacation, Personal day..."
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    />
                    {/* This used to be a private note, so say plainly that it is not. */}
                    <p className="text-xs text-gray-500 mt-1">
                      Clients see this on the booking calendar, so keep it brief and public-friendly.
                    </p>
                  </div>

                  <button
                    onClick={async () => {
                      if (!newBlockDate) {
                        toast.error('Please select a date', 'Choose a date to block.');
                        return;
                      }
                      setIsSavingBlock(true);
                      try {
                        const created = await availabilityService.saveOverride({
                          override_date: newBlockDate,
                          is_available: false,
                          reason: newBlockReason || undefined,
                        });
                        setBlockedDates((prev) => [...prev, created].sort((a: any, b: any) =>
                          new Date(a.override_date).getTime() - new Date(b.override_date).getTime()
                        ));
                        setNewBlockDate('');
                        setNewBlockReason('');
                        toast.success('Date blocked', `${new Date(newBlockDate).toLocaleDateString()} has been blocked.`);
                      } catch (e: any) {
                        console.error('Failed to block date', e);
                        toast.error('Failed to block date', e?.message || 'Please try again.');
                      } finally {
                        setIsSavingBlock(false);
                      }
                    }}
                    disabled={isSavingBlock || !newBlockDate}
                    className="w-full py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <XCircle className="w-4 h-4" />
                    {isSavingBlock ? 'Blocking...' : 'Block This Date'}
                  </button>
                </div>
              </div>

              {/* Blocked Dates List */}
              <div className="bg-white rounded-2xl p-6 shadow-sm">
                <h3 className="text-gray-900 font-medium mb-4">Blocked Dates</h3>

                {isLoadingAvailability ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl">
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-200 animate-pulse rounded w-32" />
                          <div className="h-3 bg-gray-200 animate-pulse rounded w-24" />
                        </div>
                        <div className="h-9 bg-gray-200 animate-pulse rounded-lg w-20" />
                      </div>
                    ))}
                  </div>
                ) : availabilityError ? (
                  <InlineError
                    message={availabilityError}
                    onRetry={fetchAvailability}
                    retrying={isLoadingAvailability}
                  />
                ) : blockedDates.length === 0 ? (
                  <EmptyState
                    type="generic"
                    title="No blocked dates"
                    description="You haven't blocked any dates. Block dates when you're not available."
                  />
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {blockedDates.map((block: any) => (
                      <div key={block.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:border-red-200 transition-colors">
                        <div>
                          <div className="text-sm text-gray-900 font-medium">
                            {new Date(block.override_date + 'T00:00:00').toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'long',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </div>
                          {block.reason && (
                            <div className="text-xs text-gray-500 mt-1">{block.reason}</div>
                          )}
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await availabilityService.deleteOverride(block.id);
                              setBlockedDates((prev) => prev.filter((b: any) => String(b.id) !== String(block.id)));
                              toast.success('Date unblocked', 'Clients can now book on this date.');
                            } catch (e) {
                              console.error('Failed to unblock date', e);
                              toast.error('Failed to unblock', 'Please try again.');
                            }
                          }}
                          className="px-3 py-2 border border-green-600 text-green-600 rounded-lg hover:bg-green-50 transition-colors text-sm flex items-center gap-1"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming Bookings Reference */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h3 className="text-gray-900 font-medium mb-4">Upcoming Bookings</h3>
              <p className="text-sm text-gray-600 mb-4">
                These dates already have confirmed bookings.
              </p>

              {isLoadingBookings ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-10 bg-gray-100 animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : (() => {
                // Compared against the start of today in Manila, using the raw start_date.
                //
                // This used to re-parse `b.date`, which is a formatted display string
                // ("Tue, Aug 18, 2026"), and compare it to `new Date()`. Parsing it back
                // yields midnight, so every booking scheduled for today dropped out of
                // this list the moment the clock passed midnight - a 6:30am booking was
                // hidden at 5:41am, hours before it started. Re-parsing a localised string
                // is also fragile in its own right: if that format ever changes the result
                // is Invalid Date and the comparison hides every booking instead.
                const startOfTodayManila = new Date(
                  `${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })}T00:00:00+08:00`
                );
                const upcomingBookings = providerBookings.filter(b => {
                  if (!['accepted', 'confirmed', 'pending'].includes(b.status)) return false;
                  const start = new Date(b.start_date || b.date);
                  if (isNaN(start.getTime())) return false;
                  return start >= startOfTodayManila;
                });

                if (upcomingBookings.length === 0) {
                  return (
                    <p className="text-sm text-gray-500 italic">No upcoming bookings</p>
                  );
                }

                return (
                  <div className="flex flex-wrap gap-2">
                    {upcomingBookings.slice(0, 10).map((booking) => (
                      <span
                        key={booking.id}
                        className={`px-3 py-2 rounded-lg text-sm ${booking.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-purple-100 text-purple-700'
                          }`}
                      >
                        {booking.date} - {booking.client}
                      </span>
                    ))}
                    {upcomingBookings.length > 10 && (
                      <span className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm">
                        +{upcomingBookings.length - 10} more
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-gray-900">Profile Information</h2>
                {!editMode ? (
                  <button
                    onClick={() => setEditMode(true)}
                    className="px-4 py-2 border border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 transition-colors text-sm flex items-center gap-2"
                    disabled={!user || (user.role !== 'provider' && user.role !== 'admin')}
                  >
                    <Edit className="w-4 h-4" />
                    Edit Profile
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      disabled={isSavingProfile}
                      onClick={async () => {
                        if (!user || isSavingProfile) return;

                        const validationError = validateProfile(formState) || validatePackages(packages);
                        if (validationError) {
                          setProfileSaveError(validationError);
                          toast.error('Check your profile', validationError);
                          return;
                        }

                        setIsSavingProfile(true);
                        setProfileSaveError(null);
                        try {
                          // Save profile information
                          const payload: any = {
                            name: formState.name,
                            title: formState.title,
                            bio: formState.bio,
                            years_experience: formState.years_experience === '' ? null : Number(formState.years_experience),
                            location: formState.location,
                            category: formState.category,
                            profile_image: formState.profile_image,
                            portfolio_images: formState.portfolio_images,
                            portfolio_meta: formState.portfolio_meta,
                          };
                          await userService.updateUser(user.id, payload);

                          // Save packages/services
                          if (packages.length > 0) {
                            try {
                              await Promise.all(
                                packages.map(async (pkg) => {
                                  // Determine pricing type based on enabled options.
                                  // Annotated rather than inferred: without it TS widens
                                  // the ternary to `string`, which doesn't satisfy the
                                  // union on CreateServiceData.pricing_type.
                                  const pricingType: 'package' | 'hourly' | 'both' =
                                    pkg.enable_hourly && pkg.enable_package ? 'both'
                                      : pkg.enable_hourly ? 'hourly'
                                        : 'package';

                                  // Use package_price as primary price for backward compatibility
                                  const primaryPrice = pkg.enable_package ? pkg.package_price : pkg.hourly_rate;

                                  // null, not undefined, when a mode is off: updateService sends a
                                  // partial update, and the backend only touches a column when the
                                  // field is present at all - undefined would leave a stale rate from
                                  // before the toggle was switched off sitting in the row, which
                                  // would make the toggle look re-enabled the next time this loads.
                                  const serviceData = {
                                    title: pkg.title,
                                    description: pkg.description,
                                    price: primaryPrice || 0,
                                    // validatePackages already blocks Save until every
                                    // package has an explicit category - no more
                                    // silent 'Photography' fallback here.
                                    category: pkg.category,
                                    pricing_type: pricingType,
                                    hourly_rate: pkg.enable_hourly ? pkg.hourly_rate : null,
                                    package_price: pkg.enable_package ? pkg.package_price : null,
                                    duration_minutes: pkg.enable_package ? (pkg.duration_minutes || null) : null,
                                    accepts_cash: pkg.accepts_cash === true,
                                  };

                                  if (pkg.id) {
                                    // Update existing service
                                    return serviceService.updateService(pkg.id, serviceData);
                                  } else {
                                    // Create new service
                                    return serviceService.createService(serviceData);
                                  }
                                })
                              );

                              // Reload packages to get IDs for newly created ones
                              const providerServices =
                                await serviceService.getServicesByProvider(user.id);
                              setPackages((providerServices || []).map(toPackage));
                            } catch (packageError: any) {
                              // This used to be swallowed with "continue even if packages
                              // fail to save", so the profile reported success while the
                              // services silently didn't persist.
                              console.error('Failed to save packages:', packageError);
                              throw new Error(packageError?.message || 'Your profile saved, but the services could not be saved.');
                            }
                          }

                          await refreshUser();
                          setEditMode(false);
                          toast.success('Profile saved', 'Your changes are live.');
                        } catch (err: any) {
                          // Previously just a console.error - the save failed, edit mode
                          // stayed on, and nothing told the provider why.
                          const message = err?.message || 'Could not save your profile. Please try again.';
                          console.error('Failed to save profile', err);
                          setProfileSaveError(message);
                          toast.error('Save failed', message);
                        } finally {
                          setIsSavingProfile(false);
                        }
                      }}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingProfile ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      disabled={isSavingProfile}
                      onClick={() => {
                        // Reseed straight from the server copy. The old version restored
                        // with `user?.field || s.field`, so a field the provider had
                        // *cleared* fell back to the edited (empty) value and Cancel
                        // silently kept the change.
                        setFormState(seedFormState(user));
                        setProfileSaveError(null);
                        setEditMode(false);
                      }}
                      className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {profileSaveError && (
                <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800">{profileSaveError}</p>
                </div>
              )}

              <div className="space-y-6">
                <div className="flex items-start gap-6">
                  <div className="relative">
                    {formState.profile_image ? (
                      <ImageWithFallback
                        src={getUploadUrl(formState.profile_image)}
                        alt="Your profile photo"
                        className="w-24 h-24 object-cover rounded-2xl"
                      />
                    ) : (
                      // Initials, matching what clients see on the public profile. The
                      // old fallback pointed at a truncated Unsplash URL that could never
                      // load, so "no photo yet" rendered as a broken image.
                      <div className="w-24 h-24 rounded-2xl bg-purple-100 flex items-center justify-center">
                        <span className="text-3xl text-purple-600 font-medium">
                          {(formState.name || user?.name || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <input
                      type="file"
                      ref={fileInputRef}
                      name="profile"
                      accept={ALLOWED_IMAGE_TYPES.join(',')}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !user) return;

                        // allowVideo is false: a profile photo is a photo.
                        const problem = validateMediaFiles([file], null, false);
                        if (problem) {
                          toast.error('Cannot use that image', problem);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                          return;
                        }

                        setUploadingProfileImage(true);
                        try {
                          const response = await userService.uploadProfileImage(user.id, file);
                          setFormState((s: any) => ({ ...s, profile_image: response.profile_image }));
                          await refreshUser();
                          toast.success('Photo updated', 'Your new profile photo is live.');
                        } catch (err: any) {
                          // This was a bare console.error: the upload could fail for any
                          // reason - too large, wrong type, offline - and the provider
                          // was told nothing at all, just an unchanged photo.
                          console.error('Profile image upload failed', err);
                          toast.error('Upload failed', err?.message || 'Could not upload that photo.');
                        } finally {
                          setUploadingProfileImage(false);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }
                      }}
                    />
                    <button
                      onClick={() => { if (editMode) fileInputRef.current?.click(); }}
                      disabled={!editMode || uploadingProfileImage}
                      className="absolute -bottom-2 -right-2 w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={editMode ? 'Change profile photo' : 'Click "Edit Profile" to change your photo'}
                      aria-label="Change profile photo"
                    >
                      {uploadingProfileImage
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : <Camera className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex-1">
                    {editMode ? (
                      <input
                        id="profile-name"
                        name="name"
                        value={formState.name}
                        maxLength={100}
                        placeholder="Your name"
                        onChange={(e) => setFormState((s: any) => ({ ...s, name: e.target.value }))}
                        className="text-xl text-gray-900 font-semibold border border-gray-200 rounded-md px-2 py-1"
                      />
                    ) : (
                      <h3 className="text-gray-900 mb-2">{formState.name}</h3>
                    )}
                    {editMode ? (
                      <input
                        id="profile-title"
                        name="title"
                        value={formState.title}
                        maxLength={255}
                        placeholder="e.g. Wedding Photographer"
                        onChange={(e) => setFormState((s: any) => ({ ...s, title: e.target.value }))}
                        className="text-sm text-gray-600 border border-gray-200 rounded-md px-2 py-1 mb-2"
                      />
                    ) : (
                      <p className="text-gray-600 mb-4">{formState.title}</p>
                    )}
                    {/* These were hardcoded to "4.9 (127 reviews)" and "156 clients" for
                        every provider, including brand-new ones with no history at all.
                        reviewStats is already fetched by fetchReviews() above, and the
                        client count comes from the bookings this dashboard already has. */}
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                        <span>
                          {reviewStats.totalReviews > 0
                            ? `${reviewStats.averageRating} (${reviewStats.totalReviews} review${reviewStats.totalReviews === 1 ? '' : 's'})`
                            : 'No reviews yet'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        <span>
                          {distinctClientCount} client{distinctClientCount === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="profile-bio" className="block text-sm text-gray-700 mb-2">Bio</label>
                  <textarea
                    id="profile-bio"
                    name="bio"
                    value={formState.bio}
                    onChange={(e) => setFormState((s: any) => ({ ...s, bio: e.target.value }))}
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    readOnly={!editMode}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="profile-years-experience" className="block text-sm text-gray-700 mb-2">Years of Experience</label>
                    <input
                      id="profile-years-experience"
                      name="years_experience"
                      type="number"
                      min={0}
                      max={80}
                      placeholder="e.g. 5"
                      value={formState.years_experience}
                      onChange={(e) => setFormState((s: any) => ({
                        ...s,
                        // Keep '' as "not set" - Number('') is 0, which turned a cleared
                        // field into a claim of zero years.
                        years_experience: e.target.value === '' ? '' : Number(e.target.value),
                      }))}
                      readOnly={!editMode}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-location" className="block text-sm text-gray-700 mb-2">Location</label>
                    <input
                      id="profile-location"
                      name="location"
                      type="text"
                      value={formState.location}
                      maxLength={255}
                      placeholder="City, Province"
                      onChange={(e) => setFormState((s: any) => ({ ...s, location: e.target.value }))}
                      readOnly={!editMode}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>

                {/* Category Selection */}
                <div>
                  <label htmlFor="profile-category" className="block text-sm text-gray-700 mb-2">
                    <Tag className="w-4 h-4 inline mr-1" />
                    Primary Category
                  </label>
                  {editMode ? (
                    <select
                      id="profile-category"
                      name="category"
                      value={formState.category}
                      onChange={(e) => setFormState((s: any) => ({ ...s, category: e.target.value }))}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                    >
                      <option value="">Select a category</option>
                      {CATEGORY_OPTIONS.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-700">
                      {formState.category || 'Not selected'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Verification */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-gray-900 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-purple-600" />
                  Verification
                </h2>
                {(() => {
                  const status = (user as any)?.verification_status || 'unsubmitted';
                  const badge: Record<string, { label: string; className: string }> = {
                    unsubmitted: { label: 'Not submitted', className: 'bg-gray-100 text-gray-600' },
                    pending: { label: 'Pending review', className: 'bg-yellow-100 text-yellow-700' },
                    approved: { label: 'Verified', className: 'bg-green-100 text-green-700' },
                    rejected: { label: 'Rejected', className: 'bg-red-100 text-red-700' },
                  };
                  const { label, className } = badge[status] || { label: status, className: 'bg-gray-100 text-gray-600' };
                  return (
                    <span className={`px-3 py-1 text-xs font-medium rounded-full ${className}`}>
                      {label}
                    </span>
                  );
                })()}
              </div>

              <p className="text-sm text-gray-500 mb-4">
                {(user as any)?.verification_status === 'approved'
                  ? 'Your account is verified. Clients see a Verified badge on your profile.'
                  : (user as any)?.verification_status === 'pending'
                    ? 'Your documents are under review. This usually takes 1-2 business days.'
                    : (user as any)?.verification_status === 'rejected'
                      ? 'Your last submission was not approved. Upload updated documents to submit again.'
                      : 'Submit a government ID or business permit to get a Verified badge clients can see on your profile.'}
              </p>

              {Array.isArray((user as any)?.verification_documents) && (user as any).verification_documents.length > 0 && (
                <div className="mb-4 space-y-2">
                  {(user as any).verification_documents.map((doc: { path: string; original_name: string; uploaded_at: string }, index: number) => (
                    <a
                      key={index}
                      href={getUploadUrl(doc.path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="truncate">{doc.original_name}</span>
                    </a>
                  ))}
                </div>
              )}

              <input
                type="file"
                ref={verificationFileRef}
                name="documents"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (!user || files.length === 0) return;
                  setUploadingVerification(true);
                  try {
                    await userService.uploadVerificationDocuments(user.id, files);
                    await refreshUser();
                    toast.success('Documents submitted', 'Your verification documents have been submitted for review.');
                  } catch (err: any) {
                    console.error('Verification document upload failed', err);
                    toast.error('Upload failed', err?.message || 'Failed to upload verification documents');
                  } finally {
                    setUploadingVerification(false);
                    if (verificationFileRef.current) verificationFileRef.current.value = '';
                  }
                }}
              />
              <button
                onClick={() => { if (editMode) verificationFileRef.current?.click(); }}
                disabled={!editMode || uploadingVerification}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload className="w-4 h-4" />
                {uploadingVerification ? 'Uploading...' : 'Upload Documents'}
              </button>
              {!editMode && (
                <p className="text-xs text-gray-400 mt-2">Click "Edit Profile" above to upload documents.</p>
              )}
            </div>

            {/* Portfolio */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-gray-900">Portfolio</h2>
                  {/* The 24-image cap and the fact that the first image doubles as the
                      public cover photo were both invisible here until an upload failed. */}
                  <p className="text-xs text-gray-500 mt-1">
                    {portfolioImages.length} of {MAX_PORTFOLIO_IMAGES} photos and videos
                    {portfolioImages.length > 0 && ' - drag to rearrange; the first one is your cover'}
                  </p>
                </div>

                <input
                  type="file"
                  accept={ALLOWED_MEDIA_TYPES.join(',')}
                  ref={portfolioFileRef}
                  name="images"
                  id="profile-portfolio"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    // Clear the input before awaiting, so picking the same file twice in
                    // a row still fires a change event.
                    if (portfolioFileRef.current) portfolioFileRef.current.value = '';
                    await uploadPortfolioFiles(files, portfolioSlotsLeft);
                  }}
                />

                {editMode && (
                  <div className="flex items-center gap-2">
                    {portfolioImages.length > 0 && (
                      <button
                        onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                        className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                      >
                        {selectMode ? 'Done' : 'Select'}
                      </button>
                    )}
                    <button
                      onClick={() => portfolioFileRef.current?.click()}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={uploadingPortfolio || portfolioSlotsLeft === 0}
                      title={portfolioSlotsLeft === 0 ? `Limit of ${MAX_PORTFOLIO_IMAGES} images reached` : undefined}
                    >
                      <Plus className="w-4 h-4" />
                      {uploadingPortfolio ? 'Uploading...' : 'Add Media'}
                    </button>
                  </div>
                )}
              </div>

              {/* Real progress, straight from the request. "Uploading..." on its own gave
                  no sign of whether a slow batch was still moving. */}
              {uploadingPortfolio && (
                <div className="mb-4">
                  <div className="portfolio-progress">
                    <div
                      className="portfolio-progress-bar"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {uploadStage || 'Uploading...'}{uploadProgress > 0 ? ` ${uploadProgress}%` : ''}
                  </p>
                </div>
              )}

              {/* Rearranging is staged locally and saved once, rather than one request
                  per nudge - dragging ten photos into place is a single write. */}
              {orderDirty && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                  <p className="text-sm text-purple-900">
                    New arrangement not saved yet. The first image becomes your cover photo.
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={portfolioBusy}
                      onClick={async () => {
                        const ok = await persistPortfolio(
                          { images: portfolioDraft || [] },
                          { title: 'Order saved', body: 'Your portfolio now appears in this order.' }
                        );
                        if (ok) setPortfolioDraft(null);
                      }}
                      className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
                    >
                      {portfolioBusy ? 'Saving...' : 'Save order'}
                    </button>
                    <button
                      disabled={portfolioBusy}
                      onClick={() => setPortfolioDraft(null)}
                      className="px-3 py-1.5 bg-white border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {editMode && selectMode && (
                <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-gray-700">{selectedPaths.length} selected</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        list="portfolio-albums"
                        value={bulkAlbum}
                        onChange={(e) => setBulkAlbum(e.target.value)}
                        placeholder="Album name"
                        maxLength={60}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                      />
                      <button
                        disabled={portfolioBusy || selectedPaths.length === 0}
                        onClick={async () => {
                          const album = bulkAlbum.trim();
                          const nextMeta: PortfolioMeta = { ...portfolioMeta };
                          for (const path of selectedPaths) {
                            const current = nextMeta[path] || {};
                            if (album) {
                              nextMeta[path] = { ...current, album };
                            } else {
                              // An empty album name is how images come back out of one.
                              const { album: _removed, ...rest } = current;
                              nextMeta[path] = rest;
                            }
                          }
                          const ok = await persistPortfolio(
                            { images: displayOrder, meta: nextMeta },
                            {
                              title: album ? `Moved to ${album}` : 'Removed from album',
                              body: `${selectedPaths.length} image${selectedPaths.length === 1 ? '' : 's'} updated.`,
                            }
                          );
                          if (ok) {
                            setPortfolioDraft(null);
                            exitSelectMode();
                          }
                        }}
                        className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
                      >
                        {bulkAlbum.trim() ? 'Move to album' : 'Clear album'}
                      </button>
                      <button
                        disabled={portfolioBusy || selectedPaths.length === 0}
                        onClick={() => setBulkDeleteConfirm(true)}
                        className="px-3 py-1.5 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                      <button
                        onClick={exitSelectMode}
                        className="px-3 py-1.5 border border-gray-200 text-sm rounded-lg hover:bg-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>

                  {bulkDeleteConfirm && (
                    <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-800">
                        Remove {selectedPaths.length} image{selectedPaths.length === 1 ? '' : 's'}? This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <button
                          disabled={portfolioBusy}
                          onClick={async () => {
                            const removing = new Set(selectedPaths);
                            const next = displayOrder.filter((img) => !removing.has(getStoredPath(img)));
                            const ok = await persistPortfolio(
                              { images: next },
                              {
                                title: 'Images removed',
                                body: `${selectedPaths.length} image${selectedPaths.length === 1 ? '' : 's'} deleted.`,
                              }
                            );
                            if (ok) {
                              setPortfolioDraft(null);
                              exitSelectMode();
                            }
                          }}
                          className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                        >
                          {portfolioBusy ? 'Removing...' : 'Remove them'}
                        </button>
                        <button
                          disabled={portfolioBusy}
                          onClick={() => setBulkDeleteConfirm(false)}
                          className="px-3 py-1.5 bg-white border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                        >
                          Keep them
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Previously used album names become suggestions, so "Weddings" doesn't end
                  up alongside "weddings" and "Wedding". */}
              <datalist id="portfolio-albums">
                {albumNames.map((album) => (
                  <option key={album} value={album} />
                ))}
              </datalist>

              <div
                onDragOver={(e) => {
                  // Only react to files coming in from outside; a tile being dragged
                  // within the grid carries no Files entry.
                  if (!editMode || uploadingPortfolio) return;
                  if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
                  e.preventDefault();
                  setIsDraggingFiles(true);
                }}
                onDragLeave={(e) => {
                  // Moving between two tiles fires dragleave on the container; ignore it
                  // unless the pointer has genuinely left the grid.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setIsDraggingFiles(false);
                }}
                onDrop={async (e) => {
                  if (!editMode || uploadingPortfolio) return;
                  const files = Array.from(e.dataTransfer.files || []);
                  if (files.length === 0) return;
                  e.preventDefault();
                  setIsDraggingFiles(false);
                  await uploadPortfolioFiles(files, portfolioSlotsLeft);
                }}
                className={`portfolio-grid ${isDraggingFiles ? 'portfolio-grid--dropping' : ''}`}
              >
                {displayOrder.map((image: string, index: number) => {
                  const meta = metaFor(image);
                  const selected = isSelected(image);
                  return (
                    <div
                      // Keyed by path, not position: during a drag the positions change on
                      // every dragenter, and an index key would tear down the very element
                      // being dragged.
                      key={getStoredPath(image)}
                      className={`portfolio-tile ${dragIndex === index ? 'portfolio-tile--dragging' : ''} ${
                        selected ? 'portfolio-tile--selected' : ''
                      }`}
                      draggable={editMode && !selectMode && !portfolioBusy}
                      onDragStart={(e) => {
                        setDragIndex(index);
                        e.dataTransfer.effectAllowed = 'move';
                        // Firefox ignores a drag that carries no data at all.
                        e.dataTransfer.setData('text/plain', String(index));
                      }}
                      onDragEnter={() => {
                        // Reorder as the pointer passes over each tile, so the grid shows
                        // the result before the drop rather than after it.
                        if (dragIndex === null || dragIndex === index) return;
                        moveImage(dragIndex, index);
                        setDragIndex(index);
                      }}
                      onDragOver={(e) => {
                        if (dragIndex !== null) e.preventDefault();
                      }}
                      onDragEnd={() => setDragIndex(null)}
                      onDrop={() => setDragIndex(null)}
                    >
                      <button
                        type="button"
                        onClick={() => (selectMode ? toggleSelected(image) : openImageDetail(index))}
                        className="portfolio-tile-image"
                        title={selectMode ? 'Select this item' : 'View and label this item'}
                      >
                        <PortfolioThumbnail
                          path={image}
                          meta={meta}
                          alt={meta.caption || `Portfolio item ${index + 1}`}
                        />
                      </button>

                      {selectMode && (
                        <span
                          className={`portfolio-check ${selected ? 'portfolio-check--on' : ''}`}
                        >
                          {selected && <CheckCircle className="w-4 h-4" />}
                        </span>
                      )}

                      {!selectMode && index === 0 && (
                        <span className="portfolio-badge portfolio-badge--cover">
                          Cover
                        </span>
                      )}

                      {!selectMode && meta.album && (
                        <span className="portfolio-badge portfolio-badge--album">
                          {meta.album}
                        </span>
                      )}

                      {/* Removal is confirmed in place. The old single-click X was both
                          irreversible and, because a full-size hover overlay was painted
                          over it, usually unclickable anyway. */}
                      {editMode && !selectMode && portfolioPendingDelete === index ? (
                        <div className="portfolio-confirm">
                          <p className="text-white text-xs">Remove this image?</p>
                          <div className="flex gap-2">
                            <button
                              disabled={portfolioBusy}
                              onClick={async () => {
                                const next = displayOrder.filter((_, i) => i !== index);
                                const ok = await persistPortfolio(
                                  { images: next },
                                  {
                                    title: 'Image removed',
                                    body: 'It no longer appears on your public profile.',
                                  }
                                );
                                if (ok) {
                                  setPortfolioDraft(null);
                                  setPortfolioPendingDelete(null);
                                }
                              }}
                              className="px-2 py-1 bg-red-600 text-white text-xs rounded-md hover:bg-red-700 disabled:opacity-50"
                            >
                              {portfolioBusy ? 'Removing...' : 'Remove'}
                            </button>
                            <button
                              disabled={portfolioBusy}
                              onClick={() => setPortfolioPendingDelete(null)}
                              className="px-2 py-1 bg-white text-gray-700 text-xs rounded-md hover:bg-gray-100 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : editMode && !selectMode && (
                        // A bar along the bottom edge only - it can't cover the image or
                        // the badges above it, and it stays visible while focused so every
                        // action is reachable by keyboard as well as by mouse.
                        <div className="portfolio-actions">
                          <button
                            disabled={portfolioBusy || index === 0}
                            onClick={() => moveImage(index, index - 1)}
                            className="portfolio-action"
                            title="Move earlier"
                            aria-label={`Move image ${index + 1} earlier`}
                          >
                            <ChevronLeft className="w-4 h-4 text-gray-700" />
                          </button>
                          <button
                            disabled={portfolioBusy || index === displayOrder.length - 1}
                            onClick={() => moveImage(index, index + 1)}
                            className="portfolio-action"
                            title="Move later"
                            aria-label={`Move image ${index + 1} later`}
                          >
                            <ChevronRight className="w-4 h-4 text-gray-700" />
                          </button>
                          <button
                            disabled={portfolioBusy}
                            onClick={() => openImageDetail(index)}
                            className="portfolio-action"
                            title="Caption and album"
                            aria-label={`Edit details for image ${index + 1}`}
                          >
                            <Edit className="w-4 h-4 text-gray-700" />
                          </button>
                          <button
                            disabled={portfolioBusy}
                            onClick={() => setPortfolioPendingDelete(index)}
                            className="portfolio-action"
                            title="Remove image"
                            aria-label={`Remove portfolio image ${index + 1}`}
                          >
                            <XCircle className="w-4 h-4 text-red-600" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {portfolioSlotsLeft > 0 && !selectMode && (
                  <button
                    onClick={() => { if (editMode) portfolioFileRef.current?.click(); }}
                    disabled={!editMode || uploadingPortfolio}
                    title={editMode ? 'Add images' : 'Click "Edit Profile" to add images'}
                    className="aspect-square border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all flex flex-col items-center justify-center gap-1 px-2 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-8 h-8 text-gray-400" />
                    <span className="text-xs text-gray-400">
                      {editMode ? 'Drop photos or video' : `${portfolioSlotsLeft} left`}
                    </span>
                  </button>
                )}
              </div>

              {portfolioImages.length === 0 && (
                <p className="text-sm text-gray-500 mt-4">
                  Clients browse your portfolio before they book. Add a few of your best
                  shots - the first one becomes the cover photo on your public profile, and
                  you can group the rest into albums.
                </p>
              )}
            </div>

            {/* Pricing & Packages */}
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-gray-900">Pricing & Packages</h2>
                {editMode && (
                  <button
                    onClick={() => {
                      setPackages([...packages, {
                        id: null,
                        title: 'New Service',
                        description: 'Description of service features and benefits...',
                        // Left unset deliberately - see validatePackages. Pre-filling
                        // this let a first service save as 'Photography' without the
                        // picker ever being touched.
                        category: '',
                        hourly_rate: 500,
                        package_price: 2000,
                        duration_minutes: 240,
                        enable_hourly: true,
                        enable_package: true,
                      }]);
                    }}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Service
                  </button>
                )}
              </div>
              {isLoadingPackages ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <ServiceCardSkeleton key={i} />
                  ))}
                </div>
              ) : packagesError ? (
                <InlineError message={packagesError} onRetry={loadPackages} />
              ) : packages.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-gray-200 rounded-xl text-center">
                  <Tag className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-900 font-medium mb-1">No services yet</p>
                  <p className="text-sm text-gray-500">
                    {editMode
                      ? 'Use "Add Service" above to create your first one.'
                      : 'Click "Edit Profile" above, then "Add Service", to create your first one.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {packages.map((pkg, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-xl">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1">
                          {editMode ? (
                            <input
                              type="text"
                              value={pkg.title}
                              onChange={(e) => {
                                const updated = [...packages];
                                updated[index].title = e.target.value;
                                setPackages(updated);
                              }}
                              className="text-gray-900 border border-gray-200 rounded-md px-3 py-2 w-full focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                              placeholder="Package name"
                            />
                          ) : (
                            <h3 className="text-gray-900">{pkg.title}</h3>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Price display - show both if available */}
                          <div className="flex items-center gap-2">
                            {pkg.enable_hourly && pkg.hourly_rate && (
                              <span className="text-blue-600 font-semibold">
                                ₱{pkg.hourly_rate.toLocaleString()}/hr
                              </span>
                            )}
                            {pkg.enable_hourly && pkg.hourly_rate && pkg.enable_package && pkg.package_price && (
                              <span className="text-gray-400">|</span>
                            )}
                            {pkg.enable_package && pkg.package_price && (
                              <span className="text-green-600 font-semibold">
                                ₱{pkg.package_price.toLocaleString()}
                              </span>
                            )}
                          </div>
                          {editMode && (
                            <button
                              onClick={async () => {
                                // Deleting a saved service is immediate and permanent - it also
                                // detaches it from every booking (past and upcoming) that was
                                // ever made against it, since those keep the booking but lose
                                // the service reference. A brand-new, not-yet-saved row (no
                                // pkg.id) has none of that at stake, so it's removed silently.
                                if (pkg.id && !confirm(`Delete "${pkg.title || 'this service'}"? This can't be undone, and any past or upcoming bookings for it will lose their service details.`)) {
                                  return;
                                }
                                if (pkg.id && user) {
                                  try {
                                    await serviceService.deleteService(pkg.id);
                                  } catch (error: any) {
                                    // setPackages used to run regardless, so a refused
                                    // delete still removed the row from the list and the
                                    // service quietly came back on reload.
                                    console.error('Failed to delete service:', error);
                                    toast.error('Could not delete service', error?.message || 'Please try again.');
                                    return;
                                  }
                                }
                                setPackages(packages.filter((_, i) => i !== index));
                              }}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete package"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      {editMode ? (
                        <textarea
                          value={pkg.description}
                          onChange={(e) => {
                            const updated = [...packages];
                            updated[index].description = e.target.value;
                            setPackages(updated);
                          }}
                          rows={3}
                          className="w-full text-sm text-gray-600 border border-gray-200 rounded-md px-3 py-2 resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                          placeholder="Description of package features and benefits..."
                        />
                      ) : (
                        <p className="text-sm text-gray-600 whitespace-pre-wrap">{pkg.description}</p>
                      )}
                      {/* Service Category */}
                      {editMode ? (
                        <div className="mt-3">
                          <label className="block text-xs text-gray-500 mb-1">Service Category</label>
                          <select
                            value={pkg.category || ''}
                            onChange={(e) => {
                              const updated = [...packages];
                              updated[index].category = e.target.value;
                              setPackages(updated);
                            }}
                            className="w-full sm:w-48 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                          >
                            <option value="">Select a category</option>
                            {CATEGORY_OPTIONS.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </div>
                      ) : pkg.category && (
                        <div className="mt-2">
                          <span className="inline-flex items-center px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded-full">
                            <Tag className="w-3 h-3 mr-1" />
                            {pkg.category}
                          </span>
                        </div>
                      )}
                      {/* Pricing Options */}
                      {editMode ? (
                        <div className="mt-3 space-y-3">
                          {/* Pricing Type Checkboxes */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-2">Pricing Options (select one or both)</label>
                            <div className="flex gap-2">
                              <label
                                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${pkg.enable_hourly
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={pkg.enable_hourly || false}
                                  onChange={(e) => {
                                    const updated = [...packages];
                                    updated[index].enable_hourly = e.target.checked;
                                    // Ensure at least one option is enabled
                                    if (!e.target.checked && !updated[index].enable_package) {
                                      updated[index].enable_package = true;
                                    }
                                    setPackages(updated);
                                  }}
                                  className="sr-only"
                                />
                                ⏱️ Hourly
                              </label>
                              <label
                                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 ${pkg.enable_package
                                  ? 'bg-green-600 text-white'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={pkg.enable_package || false}
                                  onChange={(e) => {
                                    const updated = [...packages];
                                    updated[index].enable_package = e.target.checked;
                                    // Ensure at least one option is enabled
                                    if (!e.target.checked && !updated[index].enable_hourly) {
                                      updated[index].enable_hourly = true;
                                    }
                                    setPackages(updated);
                                  }}
                                  className="sr-only"
                                />
                                📦 Package
                              </label>
                            </div>
                          </div>

                          {/* Hourly Pricing Fields */}
                          {pkg.enable_hourly && (
                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                              <label className="block text-xs text-blue-800 mb-1">Hourly Rate (₱/hr)</label>
                              <input
                                type="number"
                                value={pkg.hourly_rate || ''}
                                onChange={(e) => {
                                  const updated = [...packages];
                                  updated[index].hourly_rate = e.target.value ? parseFloat(e.target.value) : null;
                                  setPackages(updated);
                                }}
                                placeholder="e.g., 500"
                                className="w-full px-3 py-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                              />
                              <p className="text-xs text-blue-600 mt-2">Client pays based on hours booked</p>
                            </div>
                          )}

                          {/* Package Pricing Fields */}
                          {pkg.enable_package && (
                            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                              <div className="flex gap-3">
                                <div className="flex-1">
                                  <label className="block text-xs text-green-800 mb-1">Package Price (₱)</label>
                                  <input
                                    type="number"
                                    value={pkg.package_price || ''}
                                    onChange={(e) => {
                                      const updated = [...packages];
                                      updated[index].package_price = e.target.value ? parseFloat(e.target.value) : null;
                                      setPackages(updated);
                                    }}
                                    placeholder="e.g., 2500"
                                    className="w-full px-3 py-2 text-sm border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-green-800 mb-1">Duration (hours)</label>
                                  <input
                                    type="number"
                                    value={pkg.duration_minutes ? pkg.duration_minutes / 60 : ''}
                                    onChange={(e) => {
                                      const updated = [...packages];
                                      updated[index].duration_minutes = e.target.value ? parseFloat(e.target.value) * 60 : null;
                                      setPackages(updated);
                                    }}
                                    placeholder="e.g., 4"
                                    className="w-28 px-3 py-2 text-sm border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                                    min="0.5"
                                    step="0.5"
                                  />
                                </div>
                              </div>
                              <p className="text-xs text-green-600 mt-2">Fixed price for the entire package duration</p>
                            </div>
                          )}

                          {/* Cash is a per-service choice, not an account-wide one: a
                              provider may happily take cash for a ₱2,000 portrait shoot
                              and want a wedding paid up front. */}
                          <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                            <label className="flex items-start gap-3 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={pkg.accepts_cash === true}
                                onChange={(e) => {
                                  const updated = [...packages];
                                  updated[index].accepts_cash = e.target.checked;
                                  setPackages(updated);
                                }}
                                className="mt-0.5 w-4 h-4"
                              />
                              <span className="text-sm">
                                <span className="block font-medium text-gray-900">Accept cash on the day</span>
                                <span className="block text-xs text-gray-600 mt-0.5">
                                  Clients can choose to pay you in cash at the shoot instead of online. You mark it
                                  received afterwards, and the {PLATFORM_COMMISSION_PERCENT}% platform commission is taken from your
                                  wallet balance instead of the payment. Cash bookings aren&apos;t held in escrow, so
                                  neither side is protected if the shoot goes wrong.
                                </span>
                              </span>
                            </label>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {/* Pricing badges - show all enabled options */}
                          {pkg.enable_hourly && pkg.hourly_rate && (
                            <span className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                              <PhilippinePeso className="w-3 h-3 mr-1" />
                              ₱{pkg.hourly_rate.toLocaleString()}/hr
                            </span>
                          )}
                          {pkg.enable_package && pkg.package_price && (
                            <>
                              <span className="inline-flex items-center px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">
                                <PhilippinePeso className="w-3 h-3 mr-1" />
                                ₱{pkg.package_price.toLocaleString()} package
                              </span>
                              {pkg.duration_minutes && (
                                <span className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full">
                                  <Calendar className="w-3 h-3 mr-1" />
                                  {pkg.duration_minutes / 60}h
                                </span>
                              )}
                            </>
                          )}
                          {pkg.accepts_cash && (
                            <span className="inline-flex items-center px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded-full">
                              <PhilippinePeso className="w-3 h-3 mr-1" />
                              Cash accepted
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {packages.length === 0 && !isLoadingPackages && (
                    <EmptyState
                      type="services"
                      title="No services yet"
                      description="Create service packages or hourly rates to showcase your offerings and start receiving bookings."
                      action={editMode ? (
                        <button
                          onClick={() => {
                            setPackages([{
                              id: null,
                              title: 'New Service',
                              description: 'Description of service features and benefits...',
                              category: '',
                              hourly_rate: 500,
                              package_price: 2000,
                              duration_minutes: 240,
                              enable_hourly: true,
                              enable_package: true,
                            }]);
                          }}
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          Add Your First Service
                        </button>
                      ) : undefined}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bookings Tab */}
        {activeTab === 'bookings' && (
          <div className="space-y-6">
            {/* Bookings past their date and still unpaid. These used to be listed under
                "Ready to Mark Complete" alongside the paid ones, which invited the
                provider to shoot for free: POST /bookings/:id/complete moves a booking to
                awaiting_confirmation, and payment can only be taken while it is accepted
                or confirmed - so completing an unpaid booking permanently locked the
                client out of paying it. The endpoint now refuses; this separates them
                here so the prompt is "chase the payment", not "upload your photos". */}
            {(() => {
              const pastAndUnpaid = providerBookings.filter(b =>
                ['accepted', 'confirmed'].includes(b.status) &&
                b.payment_status !== 'paid' &&
                new Date(b.start_date || b.date) <= new Date()
              );
              if (pastAndUnpaid.length === 0) return null;
              return (
                <div className="bg-amber-100 border-2 border-amber-200 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertCircle className="w-5 h-5 text-amber-700" />
                    <h3 className="text-amber-700 font-semibold">Waiting for Payment ({pastAndUnpaid.length})</h3>
                  </div>
                  <p className="text-sm text-amber-700 mb-4">
                    These bookings have passed their date but the client never paid, so they can't be
                    marked complete. Message the client, or cancel to free the date - unpaid bookings
                    are released automatically once their payment deadline passes.
                  </p>
                  <div className="space-y-3">
                    {pastAndUnpaid.slice(0, 5).map((booking) => (
                      <div key={`unpaid-${booking.id}`} className="p-4 bg-white border border-amber-200 rounded-xl flex items-center gap-4">
                        <ImageWithFallback
                          src={booking.image}
                          alt={booking.client}
                          className="w-12 h-12 object-cover rounded-lg"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 font-medium truncate">{booking.client}</p>
                          <p className="text-xs text-gray-600 truncate">{booking.service || 'Service'}</p>
                          <p className="text-xs text-gray-500">{booking.date} at {booking.time}</p>
                        </div>
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 whitespace-nowrap">
                          Unpaid
                        </span>
                      </div>
                    ))}
                    {pastAndUnpaid.length > 5 && (
                      <p className="text-sm text-amber-700 text-center">+{pastAndUnpaid.length - 5} more unpaid</p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Ready to Complete - Bookings that can be marked as done */}
            {(() => {
              const readyToComplete = providerBookings.filter(b =>
                ['accepted', 'confirmed'].includes(b.status) &&
                b.payment_status === 'paid' &&
                new Date(b.start_date || b.date) <= new Date()
              );
              if (readyToComplete.length === 0) return null;
              return (
                <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
                    <h3 className="text-blue-800 font-semibold">Ready to Mark Complete ({readyToComplete.length})</h3>
                  </div>
                  <p className="text-sm text-blue-700 mb-4">These bookings have passed their scheduled date. Upload evidence photos to mark them complete.</p>
                  <div className="space-y-3">
                    {readyToComplete.slice(0, 5).map((booking) => (
                      <div key={`ready-${booking.id}`} className="p-4 bg-white border border-blue-200 rounded-xl flex items-center gap-4">
                        <ImageWithFallback
                          src={booking.image}
                          alt={booking.client}
                          className="w-12 h-12 object-cover rounded-lg"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 font-medium truncate">{booking.client}</p>
                          <p className="text-xs text-gray-600 truncate">{booking.service || 'Service'}</p>
                          <p className="text-xs text-gray-500">{booking.date} at {booking.time}</p>
                        </div>
                        <button
                          onClick={() => {
                            setCompleteBookingData({
                              id: String(booking.id),
                              service_title: booking.service || 'Service',
                              client_name: booking.client || 'Client',
                              start_date: booking.start_date || booking.date,
                            });
                            setShowCompleteModal(true);
                          }}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm flex items-center gap-2 whitespace-nowrap"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Mark Complete
                        </button>
                      </div>
                    ))}
                    {readyToComplete.length > 5 && (
                      <p className="text-sm text-blue-600 text-center">+{readyToComplete.length - 5} more bookings ready to complete</p>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <h2 className="text-gray-900">All Bookings</h2>
                <div className="flex items-center gap-2">
                  {(['all', 'upcoming', 'completed', 'cancelled'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setAllBookingFilter(filter)}
                      className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                        allBookingFilter === filter
                          ? 'bg-purple-600 text-white'
                          : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>
              {isLoadingBookings ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <BookingCardSkeleton key={i} />
                  ))}
                </div>
              ) : bookingsError ? (
                <ErrorState
                  type="network"
                  title="Failed to load bookings"
                  message={bookingsError}
                  onRetry={fetchBookings}
                  retrying={isLoadingBookings}
                />
              ) : allFilteredBookings.length === 0 ? (
                <EmptyState
                  type="bookings"
                  title="No bookings yet"
                  description="When clients book your services, they'll appear here."
                />
              ) : (
                <div className="space-y-4">
                  {allPaginatedBookings.map((booking) => {
                    const statusStyles: Record<string, string> = {
                      pending: 'bg-yellow-100 text-yellow-700',
                      accepted: 'bg-green-100 text-green-700',
                      confirmed: 'bg-green-100 text-green-700',
                      awaiting_confirmation: 'bg-orange-100 text-orange-700',
                      completed: 'bg-blue-100 text-blue-700',
                      cancelled: 'bg-gray-100 text-gray-700',
                      rejected: 'bg-red-100 text-red-700',
                      disputed: 'bg-red-100 text-red-700',
                    };
                    const statusLabels: Record<string, string> = {
                      awaiting_confirmation: 'Awaiting Client Confirmation',
                      disputed: 'Disputed - Under Review',
                    };
                    return (
                      <div key={booking.id} className="p-4 border border-gray-200 rounded-xl hover:border-purple-300 transition-colors">
                        <div className="flex flex-col sm:flex-row gap-4">
                          <ImageWithFallback
                            src={booking.image}
                            alt={booking.client}
                            className="w-full sm:w-20 h-20 object-cover rounded-lg"
                          />
                          <div className="flex-1">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <h3 className="text-gray-900 font-medium">{booking.client}</h3>
                                <p className="text-sm text-gray-600">{booking.service || 'Service'}</p>
                              </div>
                              <span className={`px-3 py-1 rounded-full text-sm ${statusStyles[booking.status] || 'bg-gray-100 text-gray-700'}`}>
                                {statusLabels[booking.status] || booking.status.replace('_', ' ')}
                              </span>
                            </div>
                            <div className="mb-2">{renderPaymentPill(booking)}</div>
                            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mb-3">
                              <div className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                <span>{booking.date}</span>
                              </div>
                              <span>{booking.time}</span>
                              <span className="text-purple-600 font-medium">₱{booking.amount?.toLocaleString()}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {booking.status === 'pending' && (
                                <>
                                  <button
                                    onClick={async () => {
                                      try {
                                        await bookingService.updateBooking(String(booking.id), { status: 'accepted' } as any);
                                        setProviderBookings((prev) => prev.map((b: any) => b.id === booking.id ? { ...b, status: 'accepted' } : b));
                                        toast.success('Booking accepted', `Booking with ${booking.client} has been confirmed.`);
                                      } catch (e) {
                                        console.error('Failed to accept booking', e);
                                        toast.error('Failed to accept', 'Please try again.');
                                      }
                                    }}
                                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-2"
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                    Accept
                                  </button>
                                  <button
                                    onClick={async () => {
                                      try {
                                        await bookingService.updateBooking(String(booking.id), { status: 'rejected' } as any);
                                        setProviderBookings((prev) => prev.map((b: any) => b.id === booking.id ? { ...b, status: 'rejected' } : b));
                                        toast.info('Booking declined', 'The client has been notified.');
                                      } catch (e) {
                                        console.error('Failed to reject booking', e);
                                        toast.error('Failed to decline', 'Please try again.');
                                      }
                                    }}
                                    className="px-4 py-2 border border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm flex items-center gap-2"
                                  >
                                    <XCircle className="w-4 h-4" />
                                    Decline
                                  </button>
                                </>
                              )}
                              {/* Paid only, same as the other two Mark Complete buttons. */}
                              {['accepted', 'confirmed'].includes(booking.status) &&
                                booking.payment_status === 'paid' &&
                                new Date(booking.start_date || booking.date) <= new Date() && (
                                  <button
                                    onClick={() => {
                                      setCompleteBookingData({
                                        id: String(booking.id),
                                        service_title: booking.service || 'Service',
                                        client_name: booking.client || 'Client',
                                        start_date: booking.start_date || booking.date,
                                      });
                                      setShowCompleteModal(true);
                                    }}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm flex items-center gap-2"
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                    Mark Complete
                                  </button>
                                )}
                              {['pending', 'accepted', 'confirmed'].includes(booking.status) && (
                                <button
                                  onClick={() => {
                                    setRescheduleBooking({
                                      id: booking.id,
                                      service: booking.service,
                                      client: booking.client,
                                      date: booking.date,
                                      time: booking.time,
                                    });
                                    setShowRescheduleModal(true);
                                  }}
                                  className="px-4 py-2 border border-orange-500 text-orange-600 rounded-lg hover:bg-orange-50 transition-colors text-sm flex items-center gap-2"
                                >
                                  <RefreshCw className="w-4 h-4" />
                                  Reschedule
                                </button>
                              )}
                              {booking.status === 'awaiting_confirmation' && (
                                <span className="px-3 py-2 text-orange-600 text-sm flex items-center gap-1">
                                  <Calendar className="w-4 h-4" />
                                  Waiting for client to confirm (48h timeout)
                                </span>
                              )}
                              {booking.status === 'disputed' && (
                                <div className="w-full mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                                  <div className="flex items-start gap-2">
                                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                      <h4 className="text-sm font-semibold text-red-800">Dispute Raised</h4>
                                      <p className="text-sm text-red-700 mt-1">
                                        {booking.dispute_reason
                                          ? `Client Reason: "${booking.dispute_reason}"`
                                          : 'The client has disputed this booking. An admin will review it shortly.'}
                                      </p>
                                      <p className="text-xs text-red-600 mt-2">
                                        Status: Under Admin Review. Respond below so the admin hears your side.
                                      </p>
                                    </div>
                                  </div>
                                  {/* The provider previously had no way to answer a
                                      dispute: completion_notes are written before the
                                      dispute exists, so nothing they could say ever
                                      addressed what the client actually alleged. */}
                                  <DisputeResponsePanel
                                    bookingId={booking.id}
                                    role="provider"
                                    existingResponse={booking.dispute_response}
                                    existingResponseAt={booking.dispute_response_at}
                                    onSubmitted={fetchBookings}
                                  />
                                </div>
                              )}
                              <button
                                onClick={() => {
                                  setDetailsBooking({
                                    ...booking,
                                    otherParty: {
                                      id: booking.client_id,
                                      name: booking.client,
                                      image: booking.image,
                                      email: booking.clientEmail,
                                    },
                                    price: booking.amount,
                                  });
                                }}
                                className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                              >
                                <FileText className="w-4 h-4" />
                                View Details
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedBookingId(booking.id);
                                  setShowChat(true);
                                }}
                                className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                              >
                                <MessageSquare className="w-4 h-4" />
                                Message
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {!isLoadingBookings && !bookingsError && allFilteredBookings.length > 0 && (
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <p className="text-sm text-gray-600">
                    Showing {(safeAllPage - 1) * allBookingItemsPerPage + 1}-
                    {(safeAllPage - 1) * allBookingItemsPerPage + allPaginatedBookings.length} of {allFilteredBookings.length}
                  </p>
                  {allTotalPages > 1 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setAllBookingPage((p) => Math.max(1, p - 1))}
                        disabled={safeAllPage === 1}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        Previous
                      </button>
                      {Array.from({ length: allTotalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          onClick={() => setAllBookingPage(page)}
                          className={`w-9 h-9 rounded-lg text-sm ${
                            safeAllPage === page
                              ? 'bg-purple-600 text-white'
                              : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        onClick={() => setAllBookingPage((p) => Math.min(allTotalPages, p + 1))}
                        disabled={safeAllPage === allTotalPages}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Wallet Tab */}
        {activeTab === 'wallet' && (
          <WalletDashboard />
        )}

        {/* Reviews Tab */}
        {activeTab === 'reviews' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-gray-900">Client Reviews</h2>
              <div className="flex items-center gap-2">
                <Star className="w-6 h-6 fill-yellow-400 text-yellow-400" />
                <span className="text-2xl text-gray-900">{reviewStats.averageRating}</span>
                <span className="text-gray-600">({reviewStats.totalReviews} {reviewStats.totalReviews === 1 ? 'review' : 'reviews'})</span>
              </div>
            </div>

            {isLoadingReviews ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-6 border border-gray-100 rounded-xl">
                    <div className="flex items-start justify-between mb-3">
                      <div className="space-y-2">
                        <div className="h-5 bg-gray-200 animate-pulse rounded w-32" />
                        <div className="h-4 bg-gray-200 animate-pulse rounded w-24" />
                      </div>
                      <div className="flex gap-1">
                        {Array.from({ length: 5 }).map((_, j) => (
                          <div key={j} className="w-4 h-4 bg-gray-200 animate-pulse rounded" />
                        ))}
                      </div>
                    </div>
                    <div className="h-16 bg-gray-200 animate-pulse rounded mb-3" />
                    <div className="h-4 bg-gray-200 animate-pulse rounded w-20" />
                  </div>
                ))}
              </div>
            ) : reviewsError ? (
              <ErrorState
                type="network"
                title="Failed to load reviews"
                message={reviewsError}
                onRetry={fetchReviews}
                retrying={isLoadingReviews}
              />
            ) : reviews.length === 0 ? (
              <EmptyState
                type="reviews"
                title="No reviews yet"
                description="Reviews from your clients will appear here after they complete bookings with you."
              />
            ) : (
              <div className="space-y-4">
                {reviews.map((review) => (
                  <div key={review.id} className="p-6 border border-gray-200 rounded-xl">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {review.reviewer_image ? (
                          <ImageWithFallback
                            src={getUploadUrl(review.reviewer_image)}
                            alt={review.reviewer_name || 'Reviewer'}
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                            <span className="text-purple-600 font-medium">
                              {(review.reviewer_name || 'A').charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div>
                          <h3 className="text-gray-900 font-medium">{review.reviewer_name || 'Anonymous'}</h3>
                          <p className="text-sm text-gray-600">{review.service_title || 'Service'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className={`w-4 h-4 ${i < review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'}`}
                          />
                        ))}
                      </div>
                    </div>
                    {review.comment && (
                      <p className="text-gray-700 mb-3">{review.comment}</p>
                    )}
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-500">
                        {reviewService.formatReviewDate(review.created_at)}
                      </p>
                      {review.moderation_status === 'approved' && (
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                          Verified
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat Modal */}
      {showChat && selectedBookingId && (() => {
        const selectedBooking = providerBookings.find(b => b.id === selectedBookingId);
        return (
          <ChatInterface
            provider={{
              id: selectedBooking?.client_id,
              name: selectedBooking?.client || 'Client',
              service: selectedBooking?.service || 'Service',
              image: selectedBooking?.image || '',
            }}
            bookingId={selectedBookingId}
            onClose={() => setShowChat(false)}
          />
        );
      })()}

      {detailsBooking && (
        <BookingDetailsModal
          booking={detailsBooking}
          isProvider
          onClose={() => setDetailsBooking(null)}
        />
      )}

      {/* Reschedule Modal */}
      {showRescheduleModal && rescheduleBooking && (
        <RescheduleModal
          providerId={String(user?.id)}
          booking={rescheduleBooking}
          onClose={() => {
            setShowRescheduleModal(false);
            setRescheduleBooking(null);
          }}
          onSuccess={() => {
            setShowRescheduleModal(false);
            setRescheduleBooking(null);
            fetchBookings();
            toast.success('Booking rescheduled', 'The booking has been rescheduled successfully.');
          }}
        />
      )}

      {/* Complete Booking Modal - Provider uploads evidence */}
      {showCompleteModal && completeBookingData && (
        <CompleteBookingModal
          booking={completeBookingData}
          onClose={() => {
            setShowCompleteModal(false);
            setCompleteBookingData(null);
          }}
          onSuccess={() => {
            setShowCompleteModal(false);
            setCompleteBookingData(null);
            fetchBookings();
            toast.success('Evidence submitted', 'Awaiting client confirmation. They have 48 hours to respond.');
          }}
        />
      )}

      {/* Full-size view of one portfolio item, and where it gets labelled */}
      {previewOpen && (
        <div className="modal-lightbox" {...previewOverlayProps}>
          <button
            onClick={() => setPortfolioPreview(null)}
            className="modal-lightbox-close w-10 h-10 rounded-full flex items-center justify-center"
            aria-label="Close preview"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          <div
            {...previewCardProps}
            className="flex flex-col items-center gap-4 w-full"
          >
            <div className="portfolio-detail-media">
              <PortfolioPlayer
                path={previewImage}
                meta={metaFor(previewImage)}
                alt={metaFor(previewImage).caption || `Portfolio item ${portfolioPreview! + 1}`}
              />
            </div>

            {editMode ? (
              <div className="portfolio-detail space-y-3">
                <div>
                  <label htmlFor="portfolio-caption" className="block text-sm text-gray-700 mb-1">
                    Caption
                  </label>
                  <input
                    id="portfolio-caption"
                    value={detailDraft.caption}
                    onChange={(e) => setDetailDraft((d) => ({ ...d, caption: e.target.value }))}
                    maxLength={140}
                    placeholder="e.g. Golden hour at Nasugbu"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">{detailDraft.caption.length}/140</p>
                </div>

                <div>
                  <label htmlFor="portfolio-album" className="block text-sm text-gray-700 mb-1">
                    Album
                  </label>
                  <input
                    id="portfolio-album"
                    list="portfolio-albums"
                    value={detailDraft.album}
                    onChange={(e) => setDetailDraft((d) => ({ ...d, album: e.target.value }))}
                    maxLength={60}
                    placeholder="e.g. Weddings"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Clients can filter your portfolio by album. Leave blank to keep it ungrouped.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    disabled={portfolioBusy}
                    onClick={async () => {
                      const path = getStoredPath(previewImage);
                      const caption = detailDraft.caption.trim();
                      const album = detailDraft.album.trim();
                      const nextMeta: PortfolioMeta = { ...portfolioMeta };
                      if (caption || album) {
                        nextMeta[path] = {
                          ...(caption ? { caption } : {}),
                          ...(album ? { album } : {}),
                        };
                      } else {
                        delete nextMeta[path];
                      }
                      const ok = await persistPortfolio(
                        { meta: nextMeta },
                        { title: 'Details saved', body: 'This image is labelled on your public profile.' }
                      );
                      if (ok) setPortfolioPreview(null);
                    }}
                    className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    {portfolioBusy ? 'Saving...' : 'Save details'}
                  </button>

                  {portfolioPreview !== 0 && (
                    <button
                      disabled={portfolioBusy}
                      onClick={() => {
                        // Staged like every other rearrangement, so it is saved with the
                        // rest of the order rather than as its own separate write.
                        moveImage(portfolioPreview!, 0);
                        setPortfolioPreview(null);
                      }}
                      className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Make cover photo
                    </button>
                  )}

                  <button
                    disabled={portfolioBusy}
                    onClick={() => setPortfolioPreview(null)}
                    className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              (metaFor(previewImage).caption || metaFor(previewImage).album) && (
                <div className="portfolio-lightbox-caption">
                  {metaFor(previewImage).caption && <p>{metaFor(previewImage).caption}</p>}
                  {metaFor(previewImage).album && (
                    <span>{metaFor(previewImage).album}</span>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
