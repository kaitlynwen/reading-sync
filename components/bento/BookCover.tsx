/**
 * `BookCover` — renders a book cover at an authentic 2:3 aspect ratio with the
 * book-spine shadow and cover corner radius from the steering (Req 13.1, and
 * the geometry 14.2 relies on; steering §5).
 *
 * When no cover reference is available it renders a placeholder that preserves
 * the exact same 2:3 box and radius so layouts never shift (steering §5; the
 * placeholder behavior this enables is Req 13.3, exercised by task 14.2).
 *
 * Hover lift / deeper spine shadow (steering §8) is layered by the consuming
 * screen; this primitive owns only the static geometry so it stays testable
 * and side-effect free.
 */

import type { CSSProperties } from "react";
import {
  BOOK_COVER_ASPECT,
  RADIUS_BOOK_COVER,
  SHADOW_SPINE,
} from "@/lib/bento";

export interface BookCoverProps {
  /** Cover image URL. When null/absent, a 2:3 placeholder is rendered. */
  src?: string | null;
  /** Book title, used for the image alt text and placeholder label. */
  title: string;
  /** Width of the cover; height is derived from the 2:3 aspect ratio. */
  width?: number | string;
  className?: string;
  style?: CSSProperties;
}

export default function BookCover({
  src,
  title,
  width = "100%",
  className = "",
  style,
}: BookCoverProps) {
  const frameStyle: CSSProperties = {
    width,
    aspectRatio: BOOK_COVER_ASPECT,
    borderRadius: RADIUS_BOOK_COVER,
    boxShadow: SHADOW_SPINE,
    overflow: "hidden",
    ...style,
  };

  const hasCover = typeof src === "string" && src.length > 0;

  return (
    <div
      data-book-cover=""
      data-has-cover={hasCover}
      style={frameStyle}
      className={className}
    >
      {hasCover ? (
        // Cover URLs are arbitrary remote references; a plain <img> keeps this
        // primitive framework-agnostic and avoids next/image domain config here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt={title}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          data-book-cover-placeholder=""
          aria-label={`${title} — no cover`}
          className="flex h-full w-full items-center justify-center bg-bg-surface-muted p-3 text-center"
        >
          <span className="font-serif text-sm text-text-secondary line-clamp-4">
            {title}
          </span>
        </div>
      )}
    </div>
  );
}
