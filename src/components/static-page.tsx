import { Breadcrumbs } from './ui';

export interface ContentSection {
  heading?: string;
  paragraphs?: string[];
  list?: string[];
}

/** Shared layout for the store's informational pages. */
export function StaticPage({
  title, intro, sections, breadcrumb,
}: { title: string; intro?: string; sections: ContentSection[]; breadcrumb: string }) {
  return (
    <div className="container-page max-w-3xl py-6">
      <Breadcrumbs items={[{ label: 'خانه', href: '/' }, { label: breadcrumb }]} />
      <h1 className="mb-3 text-xl font-extrabold text-steel-900 sm:text-2xl">{title}</h1>
      {intro && <p className="mb-6 text-sm leading-[1.9] text-muted">{intro}</p>}

      <div className="card space-y-6 p-5 sm:p-6">
        {sections.map((section, i) => (
          <section key={section.heading ?? i}>
            {section.heading && (
              <h2 className="mb-2 text-base font-extrabold text-steel-900">{section.heading}</h2>
            )}
            {section.paragraphs?.map((p, j) => (
              <p key={j} className="mb-2 text-sm leading-[1.9] text-steel-800 last:mb-0">{p}</p>
            ))}
            {section.list && (
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-steel-800">
                {section.list.map((item, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-steel-400" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
