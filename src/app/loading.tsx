export default function Loading() {
  return (
    <div className="container-page py-10" role="status" aria-label="در حال بارگذاری">
      <div className="space-y-4">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-steel-100" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card overflow-hidden">
              <div className="aspect-square animate-pulse bg-steel-100" />
              <div className="space-y-2 p-4">
                <div className="h-3 w-16 animate-pulse rounded bg-steel-100" />
                <div className="h-4 w-full animate-pulse rounded bg-steel-100" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-steel-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">در حال بارگذاری…</span>
    </div>
  );
}
