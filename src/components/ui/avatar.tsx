"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar@1.1.3";

import { cn } from "./utils";

/**
 * shadcn ships this file written against `size-*` and `bg-muted`, and this project has
 * no Tailwind build step - src/index.css is a checked-in build OUTPUT, and none of
 * `size-full`, `size-10`, `shrink-0` or `bg-muted` are in it, so all four compiled to
 * nothing. The one that actually broke: AvatarImage was left with `aspect-square` and
 * NO width or height, so the <img> laid out at its intrinsic size - a 512px upload or
 * a 96px Google photo rendered at 512/96px inside a 32px round box with
 * `overflow: hidden`, i.e. a hugely magnified crop of the photo's top-left corner.
 * That is why the avatar only looked broken for accounts that HAVE a photo: with no
 * photo, Radix renders the fallback initial instead and the missing size never showed.
 *
 * Every class below is one that exists in the snapshot. `cn` is tailwind-merge, so a
 * caller passing `w-8 h-8` still overrides the `w-10 h-10` default.
 */
function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex w-10 h-10 flex-shrink-0 overflow-hidden rounded-full",
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      // Google sign-up stores payload.picture as-is (backend/src/routes/auth.ts:224), so
      // most avatars here are remote lh3.googleusercontent.com URLs, which are served
      // inconsistently when a Referer is attached. Radix forwards this to the probe image
      // it uses to decide loaded-vs-error as well as to the rendered <img>. Before the
      // spread, so a caller can still override it.
      referrerPolicy="no-referrer"
      className={cn("aspect-square w-full h-full object-cover", className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-gray-100 flex w-full h-full items-center justify-center rounded-full",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback };
