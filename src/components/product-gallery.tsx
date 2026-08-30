'use client';

import { useState } from 'react';

/** Product image gallery: one main frame plus thumbnails, keyboard-navigable. */
export function ProductGallery({
  images, title,
}: { images: { url: string; alt: string | null }[]; title: string }) {
  const [index, setIndex] = useState(0);
  const list = images.length > 0 ? images : [{ url: '/demo/engine-part.svg', alt: title }];
  const current = list[Math.min(index, list.length - 1)]!;

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden bg-white">
        { }
        <img
          src={current.url}
          alt={current.alt ?? title}
          className="aspect-square w-full object-contain"
          fetchPriority="high"
        />
      </div>

      {list.length > 1 && (
        <ul className="scroll-x no-scrollbar flex gap-2" role="tablist" aria-label="تصاویر محصول">
          {list.map((image, i) => (
            <li key={`${image.url}-${i}`}>
              <button
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`تصویر ${i + 1}`}
                onClick={() => setIndex(i)}
                className={`size-16 shrink-0 overflow-hidden rounded-lg border-2 bg-white transition-colors sm:size-20 ${
                  i === index ? 'border-steel-700' : 'border-line hover:border-steel-300'
                }`}
              >
                { }
                <img src={image.url} alt="" loading="lazy" className="size-full object-contain" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
