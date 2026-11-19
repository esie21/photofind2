import React, { useState } from 'react'

const ERROR_IMG_SRC =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODgiIGhlaWdodD0iODgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBvcGFjaXR5PSIuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIzLjciPjxyZWN0IHg9IjE2IiB5PSIxNiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iNiIvPjxwYXRoIGQ9Im0xNiA1OCAxNi0xOCAzMiAzMiIvPjxjaXJjbGUgY3g9IjUzIiBjeT0iMzUiIHI9IjciLz48L3N2Zz4KCg=='

export function ImageWithFallback(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [didError, setDidError] = useState(false)

  const handleError = () => {
    setDidError(true)
  }

  const { src, alt, style, className, loading, decoding, ...rest } = props

  // A missing/empty src (e.g. a provider who never uploaded a photo) doesn't reliably
  // fire onError across browsers, so it would otherwise render as a silent blank box
  // instead of the same fallback a genuine load failure gets.
  const showFallback = didError || !src

  return showFallback ? (
    <div
      className={`inline-block bg-gray-100 text-center align-middle ${className ?? ''}`}
      style={style}
    >
      <div className="flex items-center justify-center w-full h-full">
        <img
          src={ERROR_IMG_SRC}
          // The caller's alt, not a hardcoded "Error loading image". This branch is
          // reached for any provider who simply hasn't uploaded a photo yet (see
          // showFallback above), which is not an error - so that string announced a
          // failure to screen reader users when nothing had failed, and discarded the
          // one useful thing the caller passed, usually the person's name.
          alt={alt ?? ''}
          {...rest}
          data-original-url={src}
        />
      </div>
    </div>
  ) : (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      // Defaults rather than hardcoded values: both are destructured out of `rest`
      // above, so a caller with an above-the-fold image can still pass
      // loading="eager" and not have its LCP deferred. Nothing on the landing page
      // needs that today - the hero is a CSS gradient, and the provider and category
      // cards are both well below the fold - but the profile and dashboard headers
      // are the obvious future exception.
      loading={loading ?? 'lazy'}
      decoding={decoding ?? 'async'}
      {...rest}
      onError={handleError}
    />
  )
}
