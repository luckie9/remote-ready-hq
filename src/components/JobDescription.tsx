'use client';

import { useMemo } from 'react';
import {
  parseJobDescription,
  redactCompanyMentions,
  type ContentBlock,
  type DescriptionHighlight,
  type Job,
} from '@/lib/jobs';

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function Blocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="job-prose">
      {blocks.map((block, i) => {
        if (block.type === 'list') {
          return (
            <ul key={i} className="mb-4 list-disc space-y-2 pl-5">
              {block.items.map((item, j) => (
                <li key={j} className="text-sm leading-relaxed text-slate-300">
                  {renderInline(item)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={i}
            className="mb-4 text-sm leading-relaxed text-slate-300 last:mb-0"
          >
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

function HighlightCard({ highlights }: { highlights: DescriptionHighlight[] }) {
  if (highlights.length === 0) return null;
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/80 p-4 text-emerald-50 shadow-md shadow-emerald-950/30">
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-emerald-200/80">
        Key details
      </p>
      <ul className="space-y-2.5">
        {highlights.map((item) => (
          <li key={item.label} className="flex gap-2.5 text-sm leading-snug">
            <span aria-hidden className="mt-0.5 shrink-0">
              {item.icon}
            </span>
            <span>
              <span className="font-semibold text-white">{item.label}:</span>{' '}
              <span className="text-emerald-50/95">{item.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function JobDescription({
  job,
  isSubscriber = true,
}: {
  job: Job;
  isSubscriber?: boolean;
}) {
  const parsed = useMemo(() => {
    const raw = isSubscriber
      ? job.description
      : redactCompanyMentions(job.description ?? '', job.company);
    return parseJobDescription(raw, {
      salary: job.salary,
      location: job.location,
      description: raw,
      title: isSubscriber ? job.title : '',
    });
  }, [job, isSubscriber]);

  return (
    <div className="space-y-5">
      <HighlightCard highlights={parsed.highlights} />

      {parsed.overview.length > 0 && (
        <section>
          <h3 className="mb-2 mt-1 text-sm font-semibold tracking-tight text-white">
            About the Role
          </h3>
          <Blocks blocks={parsed.overview} />
        </section>
      )}

      {parsed.sections.map((section) => (
        <section key={section.title}>
          <h3 className="mb-2 mt-6 text-sm font-semibold tracking-tight text-white first:mt-1">
            {section.title}
          </h3>
          <Blocks blocks={section.blocks} />
        </section>
      ))}
    </div>
  );
}
