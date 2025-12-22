import { useState, useEffect } from 'react';
import { Search, Camera, Video, Palette, Sparkles, Star, MapPin, ChevronRight, ChevronLeft, CalendarDays } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import userService from '../api/services/userService';

// Category configuration with icons, colors, and images
const CATEGORY_CONFIG: Record<string, { icon: any; color: string; image: string }> = {
  'Photography': {
    icon: Camera,
    color: 'from-blue-500 to-cyan-500',
    image: 'https://images.unsplash.com/photo-1643968612613-fd411aecd1fd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
  },
  'Videography': {
    icon: Video,
    color: 'from-purple-500 to-pink-500',
    image: 'https://images.unsplash.com/photo-1713392824135-a7c7db3d9465?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
  },
  'Makeup Artist': {
    icon: Sparkles,
    color: 'from-pink-500 to-rose-500',
    image: 'https://images.unsplash.com/photo-1698181842119-a5283dea1440?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
  },
  'Design': {
    icon: Palette,
    color: 'from-orange-500 to-yellow-500',
    image: 'https://images.unsplash.com/photo-1609921212029-bb5a28e60960?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
  },
  'Event Organizer': {
    icon: CalendarDays,
    color: 'from-green-500 to-emerald-500',
    image: 'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
  },
  'Wedding Photography': {
    icon: Camera,
    color: 'from-rose-400 to-pink-500',
    image: 'https://images.unsplash.com/photo-1606216794074-735e91aa2c92?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
  },
  'Portrait Photography': {
    icon: Camera,
    color: 'from-indigo-500 to-purple-500',
    image: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
  },
  'Event Photography': {
    icon: Camera,
    color: 'from-teal-500 to-cyan-500',
    image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
  },
  'Commercial Photography': {
    icon: Camera,
    color: 'from-amber-500 to-orange-500',
    image: 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
  },
};

// Main categories to display (order matters)
const MAIN_CATEGORIES = ['Photography', 'Videography', 'Makeup Artist', 'Design', 'Event Organizer'];

interface LandingPageProps {
  onViewChange: (view: 'client' | 'provider') => void;
}

export function LandingPage({ onViewChange }: LandingPageProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [categoryStats, setCategoryStats] = useState<{ name: string; count: number }[]>([]);
  const [totalProviders, setTotalProviders] = useState(0);
  const [loadingCategories, setLoadingCategories] = useState(true);

  // Fetch category stats on mount
  useEffect(() => {
    (async () => {
      setLoadingCategories(true);
      try {
        const res = await userService.getCategoryStats();
        setCategoryStats(res.data || []);
        setTotalProviders(res.meta?.total_providers || 0);
      } catch (err) {
        console.error('Failed to load category stats', err);
        setCategoryStats([]);
        setTotalProviders(0);
      } finally {
        setLoadingCategories(false);
      }
    })();
  }, []);

  // Build categories array with real counts - only show categories that have providers
  const categories = MAIN_CATEGORIES
    .map((name) => {
      const stats = categoryStats.find((c) => c.name === name);
      const config = CATEGORY_CONFIG[name] || {
        icon: Camera,
        color: 'from-gray-500 to-gray-600',
        image: 'https://images.unsplash.com/photo-1643968612613-fd411aecd1fd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080'
      };
      const count = stats?.count || 0;
      return {
        icon: config.icon,
        name,
        count,
        countText: `${count} professional${count !== 1 ? 's' : ''}`,
        color: config.color,
        image: config.image,
      };
    })
    .filter((cat) => cat.count > 0); // Only show categories with providers

  const [providers, setProviders] = useState<any[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    (async () => {
      setLoadingProviders(true);
      try {
        const res = await userService.getAllProviders({ page: 1, limit: 6 });
        setProviders(res.data || []);
      } catch (err) {
        console.error('Failed to load providers for landing page', err);
        setProviders([]);
      } finally {
        setLoadingProviders(false);
      }
    })();
  }, []);

  const nextSlide = () => {
    if (providers.length > 0) {
      setCurrentSlide((prev) => (prev + 1) % providers.length);
    }
  };

  const prevSlide = () => {
    if (providers.length > 0) {
      setCurrentSlide((prev) => (prev - 1 + providers.length) % providers.length);
    }
  };

  return (
    <div className="pb-16">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-purple-50 via-pink-50 to-blue-50 py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-gray-900 mb-4">
            Find photographers, videographers, designers near you
          </h1>
          <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
            Connect with talented creative professionals for your next project. Book trusted experts in minutes.
          </p>

          {/* Search Bar */}
          <div className="bg-white rounded-2xl shadow-lg p-2 flex flex-col sm:flex-row gap-2 max-w-3xl mx-auto">
            <div className="flex-1 flex items-center gap-3 px-4">
              <Search className="w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="What service are you looking for?"
                className="flex-1 outline-none text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <div className="flex-1 flex items-center gap-3 px-4 border-t sm:border-t-0 sm:border-l border-gray-200 pt-2 sm:pt-0">
              <MapPin className="w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Location"
                className="flex-1 outline-none text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <button 
              onClick={() => onViewChange('client')}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all"
            >
              Search
            </button>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-4 mt-12">
            <button 
              onClick={() => onViewChange('client')}
              className="px-8 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors shadow-lg shadow-purple-200"
            >
              Find a Professional
            </button>
            <button 
              onClick={() => onViewChange('provider')}
              className="px-8 py-3 bg-white text-purple-600 rounded-xl border-2 border-purple-600 hover:bg-purple-50 transition-colors"
            >
              Join as Creator
            </button>
          </div>
        </div>
      </section>

      {/* Featured Providers Carousel */}
      <section className="py-16 px-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-gray-900 mb-2">Featured Service Providers</h2>
            <p className="text-gray-600">Top-rated professionals ready to bring your vision to life</p>
          </div>
          <button className="text-purple-600 hover:text-purple-700 flex items-center gap-1">
            View all
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="relative">
          {loadingProviders ? (
            // Loading skeleton
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={`skeleton-${idx}`} className="bg-white rounded-2xl overflow-hidden shadow-md p-4">
                  <div className="h-44 bg-gray-200 animate-pulse rounded-lg mb-4" />
                  <div className="h-4 bg-gray-200 animate-pulse rounded w-3/4 mb-2" />
                  <div className="h-3 bg-gray-200 animate-pulse rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : providers.length === 0 ? (
            // Empty state
            <div className="text-center py-16 bg-gray-50 rounded-2xl">
              <Camera className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl text-gray-600 mb-2">No providers yet</h3>
              <p className="text-gray-500 mb-6">Be the first to join our platform!</p>
              <button
                onClick={() => onViewChange('provider')}
                className="px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors"
              >
                Become a Provider
              </button>
            </div>
          ) : (
            <>
              {/* Navigation Buttons */}
              <button
                onClick={prevSlide}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft className="w-6 h-6 text-gray-700" />
              </button>
              <button
                onClick={nextSlide}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 transition-colors"
              >
                <ChevronRight className="w-6 h-6 text-gray-700" />
              </button>

              {/* Carousel */}
              <div className="overflow-hidden">
                <div
                  className="flex transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${currentSlide * (100 / Math.min(3, providers.length))}%)` }}
                >
                  {providers.map((provider, index) => (
                  <button
                    key={index}
                    onClick={() => onViewChange('client')}
                    className="flex-shrink-0 px-3 text-left"
                    style={{ width: `${100 / Math.min(3, providers.length || 3)}%` }}
                  >
                    <div className="bg-white rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-shadow">
                    <div className="relative h-64">
                      <ImageWithFallback
                        src={provider.image || provider.profile_image || provider.imageUrl}
                        alt={provider.name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-4 right-4 px-3 py-1 bg-white rounded-full flex items-center gap-1 shadow-lg">
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                        <span className="text-sm text-gray-900">{provider.rating || provider.reviews || ''}</span>
                      </div>
                    </div>
                    <div className="p-6">
                      <h3 className="text-gray-900 mb-1">{provider.name}</h3>
                      <p className="text-gray-600 text-sm mb-3">{provider.featured_service?.title || provider.service || provider.title}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <MapPin className="w-4 h-4" />
                          <span>{provider.location}</span>
                        </div>
                        <span className="text-purple-600">{provider.featured_service?.price ? `$${provider.featured_service.price}/hr` : provider.price || ''}</span>
                      </div>
                      <div className="mt-3 text-sm text-gray-500">
                        {provider.reviews || (provider.featured_service ? '' : '')} {provider.reviews ? 'reviews' : ''}
                      </div>
                    </div>
                  </div>
                  </button>
                ))}
                </div>
              </div>

              {/* Dots Navigation */}
              <div className="flex justify-center gap-2 mt-6">
                {providers.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentSlide(index)}
                    className={`w-2 h-2 rounded-full transition-all ${
                      currentSlide === index ? 'bg-purple-600 w-8' : 'bg-gray-300'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Categories Section - Only show if there are categories with providers */}
      {categories.length > 0 && (
        <section className="py-16 px-4 bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-gray-900 mb-2">Browse by Category</h2>
              <p className="text-gray-600">Explore our diverse range of creative services</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
              {categories.map((category, index) => {
                const Icon = category.icon;
                return (
                  <button
                    key={index}
                    onClick={() => onViewChange('client')}
                    className="group relative overflow-hidden rounded-2xl bg-gray-50 hover:shadow-xl transition-all duration-300"
                  >
                    <div className="relative h-48 overflow-hidden">
                      <ImageWithFallback
                        src={category.image}
                        alt={category.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                      />
                      <div className={`absolute inset-0 bg-gradient-to-t ${category.color} opacity-60`}></div>
                    </div>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                      <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center mb-3">
                        <Icon className="w-7 h-7" />
                      </div>
                      <h3 className="text-white mb-1">{category.name}</h3>
                      <p className="text-sm text-white/90">{category.countText}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Stats Section - Only show if there are providers */}
      {totalProviders > 0 && (
        <section className="py-16 px-4 bg-gradient-to-br from-purple-600 to-pink-600">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-8 text-center text-white">
              <div>
                <div className="text-4xl mb-2">{totalProviders.toLocaleString()}</div>
                <div className="text-purple-100">Active Professionals</div>
              </div>
              <div>
                <div className="text-4xl mb-2">{categories.length}</div>
                <div className="text-purple-100">Categories</div>
              </div>
              <div>
                <div className="text-4xl mb-2">24/7</div>
                <div className="text-purple-100">Customer Support</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* How It Works */}
      <section className="py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-gray-900 mb-2">How PhotoFind Works</h2>
            <p className="text-gray-600">Get started in three simple steps</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-gray-900 mb-2">1. Search & Browse</h3>
              <p className="text-gray-600">Find the perfect professional based on your needs, location, and budget</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Camera className="w-8 h-8 text-pink-600" />
              </div>
              <h3 className="text-gray-900 mb-2">2. Book & Pay</h3>
              <p className="text-gray-600">Select your service, choose a date, and securely pay through our platform</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Star className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-gray-900 mb-2">3. Get Results</h3>
              <p className="text-gray-600">Work with your professional and receive amazing results for your project</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
