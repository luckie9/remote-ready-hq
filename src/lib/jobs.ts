export type JobCategory =
  | 'All'
  | 'Support'
  | 'Sales'
  | 'Operations'
  | 'Marketing'
  | 'Engineering'
  | 'Design'
  | 'Product';

/** Display order — Support & Sales lead */
export const JOB_CATEGORIES: JobCategory[] = [
  'All',
  'Support',
  'Sales',
  'Operations',
  'Marketing',
  'Engineering',
  'Design',
  'Product',
];

export type JobBadge = 'HOT' | 'FEATURED' | 'DIRECT_APPLY' | 'SALARY_VERIFIED';

export type Job = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  apply_url: string;
  created_at: string | null;
  description?: string | null;
  posted_label?: string;
  badges?: JobBadge[];
  locked_domain?: string;
  applicants_today?: number;
  social_proof?: string;
};

const CATEGORY_RULES: {
  category: Exclude<JobCategory, 'All'>;
  patterns: RegExp;
}[] = [
  {
    category: 'Support',
    patterns:
      /\b(support|customer success|customer service|help ?desk|service desk|technical support|cx |client success|care specialist)\b/i,
  },
  {
    category: 'Sales',
    patterns:
      /\b(sales|account executive|account manager|sdr|bdr|business development|revenue|closer|gtm)\b/i,
  },
  {
    category: 'Marketing',
    patterns:
      /\b(marketing|copywriter|writer|content|seo|growth|social media|brand manager)\b/i,
  },
  {
    category: 'Engineering',
    patterns:
      /\b(engineer|developer|software|frontend|backend|full[- ]?stack|devops|sre|data scientist|python|react|infra)\b/i,
  },
  {
    category: 'Design',
    patterns: /\b(design|designer|ux|ui|brand|visual|figma)\b/i,
  },
  {
    category: 'Product',
    patterns: /\b(product manager|product owner|\bpm\b|product lead)\b/i,
  },
  {
    category: 'Operations',
    patterns:
      /\b(operations|ops|assistant|reviewer|evaluator|office|hr|people|recruit|finance|legal|coordinator)\b/i,
  },
];

const VALID_CATS = new Set(
  JOB_CATEGORIES.filter((c) => c !== 'All')
);

export function categorizeJob(
  title: string,
  description?: string | null
): Exclude<JobCategory, 'All'> {
  const stamped = description?.match(/^rrhq_category:([A-Za-z]+)/);
  const stampedCat = stamped?.[1] as Exclude<JobCategory, 'All'> | undefined;
  if (stampedCat && VALID_CATS.has(stampedCat)) {
    return stampedCat;
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.test(title)) return rule.category;
  }
  return 'Operations';
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Recently';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Recently';
  const diffMs = Date.now() - then;
  const mins = Math.max(0, Math.floor(diffMs / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function minutesSince(iso: string | null | undefined): number {
  if (!iso) return 12;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 12;
  return Math.max(1, Math.floor((Date.now() - then) / 60_000));
}

/** Collapse char-joined artifacts: "S, w, i…" / "S . w . i…" / "S w i t z…" */
function repairCharJoinedLocation(value: string): string {
  const commaParts = value.split(', ');
  if (
    commaParts.length >= 4 &&
    commaParts.filter((p) => p.length <= 1).length / commaParts.length >= 0.8
  ) {
    return commaParts.join('');
  }

  const dotParts = value
    .split(/\s*[·.•]\s*|\s+\.\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (
    dotParts.length >= 4 &&
    dotParts.every((p) => p.length === 1) &&
    /[A-Za-zÀ-ÿ]/.test(dotParts.join(''))
  ) {
    return dotParts.join('');
  }

  // Spaced letters: "S w i t z e r l a n d"
  const spaceParts = value.split(/\s+/);
  if (
    spaceParts.length >= 5 &&
    spaceParts.every((p) => p.length === 1) &&
    /^[A-Za-zÀ-ÿ0-9]+$/.test(spaceParts.join(''))
  ) {
    return spaceParts.join('');
  }

  return value;
}

export function formatLocation(location: string | null | undefined): string {
  let value = (location || 'Worldwide')
    .replace(/[\u00a0\u200b\t\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  value = repairCharJoinedLocation(value)
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .replace(/^(?:,\s*)+|(?:,\s*)+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop consecutive duplicate segments: "Palm Beach, Palm Beach, Florida"
  value = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter(
      (part, i, arr) =>
        i === 0 || part.toLowerCase() !== arr[i - 1].toLowerCase()
    )
    .join(', ');
  if (!value) value = 'Worldwide';
  if (
    /worldwide|anywhere|remote/i.test(value) &&
    value.split(',').length <= 2
  ) {
    return `🌍 ${value}`;
  }
  return value;
}

export type RegionFilter =
  | 'any'
  | 'worldwide'
  | 'us'
  | 'europe'
  | 'latam'
  | 'apac';

export type DatePostedFilter = 'anytime' | '24h' | '7d' | '30d';

export type SalaryFilter = 'all' | 'verified';

export const REGION_OPTIONS: { value: RegionFilter; label: string }[] = [
  { value: 'any', label: 'Any Region' },
  { value: 'worldwide', label: 'Worldwide' },
  { value: 'us', label: 'US Only' },
  { value: 'europe', label: 'Europe / UK' },
  { value: 'latam', label: 'LATAM' },
  { value: 'apac', label: 'APAC' },
];

export const DATE_OPTIONS: { value: DatePostedFilter; label: string }[] = [
  { value: 'anytime', label: 'Anytime' },
  { value: '24h', label: 'Past 24 Hours' },
  { value: '7d', label: 'Past 7 Days' },
  { value: '30d', label: 'Past 30 Days' },
];

export const SALARY_OPTIONS: { value: SalaryFilter; label: string }[] = [
  { value: 'all', label: 'All Roles' },
  { value: 'verified', label: 'Verified Salary Only' },
];

const REGION_PATTERNS: Record<Exclude<RegionFilter, 'any'>, RegExp> = {
  worldwide: /\b(worldwide|anywhere|global|fully remote|remote\s*only)\b/i,
  us: /\b(united states|\bUSA\b|\bU\.?S\.?A?\b|\bUS\b|america|north america)\b/i,
  europe:
    /\b(europe|european|UK|united kingdom|britain|england|germany|france|spain|netherlands|portugal|ireland|sweden|norway|denmark|finland|poland|italy|switzerland|berlin|london|paris|amsterdam|remote\s*EU|\bEU\b|\bEMEA\b)\b/i,
  latam:
    /\b(latam|latin america|brazil|mexico|argentina|colombia|chile|peru|uruguay|costa rica|sao paulo|são paulo)\b/i,
  apac:
    /\b(apac|asia|pacific|australia|singapore|japan|india|philippines|indonesia|new zealand|korea|hong kong|taiwan|vietnam|thailand)\b/i,
};

export function matchesRegion(
  location: string | null | undefined,
  region: RegionFilter
): boolean {
  if (region === 'any') return true;
  const loc = formatLocation(location).replace(/^🌍\s*/, '');
  return REGION_PATTERNS[region].test(loc);
}

export function matchesDatePosted(
  createdAt: string | null | undefined,
  filter: DatePostedFilter
): boolean {
  if (filter === 'anytime') return true;
  if (!createdAt) return false;
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return true;
  const ageMs = Date.now() - then;
  if (filter === '24h') return ageMs <= 24 * 60 * 60 * 1000;
  if (filter === '7d') return ageMs <= 7 * 24 * 60 * 60 * 1000;
  return ageMs <= 30 * 24 * 60 * 60 * 1000;
}

export function matchesSalaryFilter(
  job: Pick<Job, 'salary'> & { badges?: JobBadge[] },
  filter: SalaryFilter
): boolean {
  if (filter === 'all') return true;
  if (job.salary && job.salary.trim()) return true;
  return (job.badges ?? []).includes('SALARY_VERIFIED');
}

export type JobFilters = {
  query?: string;
  locationQuery?: string;
  region?: RegionFilter;
  datePosted?: DatePostedFilter;
  salary?: SalaryFilter;
  category?: JobCategory;
};

export function matchesJobFilters(
  job: Job,
  {
    query = '',
    locationQuery = '',
    region = 'any',
    datePosted = 'anytime',
    salary = 'all',
    category = 'All',
  }: JobFilters
): boolean {
  const q = query.trim().toLowerCase();
  if (q) {
    const hay = `${job.title} ${job.company} ${job.description ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  const locQ = locationQuery.trim().toLowerCase();
  if (locQ) {
    const loc = formatLocation(job.location).toLowerCase();
    if (!loc.includes(locQ)) return false;
  }

  if (!matchesRegion(job.location, region)) return false;
  if (!matchesDatePosted(job.created_at, datePosted)) return false;
  if (!matchesSalaryFilter(job, salary)) return false;

  if (category !== 'All') {
    if (categorizeJob(job.title, job.description) !== category) return false;
  }

  return true;
}

export function categoryCounts(
  jobs: Job[],
  filters: Omit<JobFilters, 'category'> = {}
): Record<JobCategory, number> {
  const counts = Object.fromEntries(
    JOB_CATEGORIES.map((c) => [c, 0])
  ) as Record<JobCategory, number>;

  const scoped = jobs.filter((job) =>
    matchesJobFilters(job, { ...filters, category: 'All' })
  );
  counts.All = scoped.length;
  for (const job of scoped) {
    counts[categorizeJob(job.title, job.description)] += 1;
  }
  return counts;
}

export function hashCode(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function deriveBadges(job: {
  id: string;
  title: string;
  salary: string | null;
  created_at: string | null;
}): JobBadge[] {
  const badges: JobBadge[] = ['DIRECT_APPLY'];
  const h = hashCode(job.id || job.title);
  const ageMins = minutesSince(job.created_at);
  if (job.salary) badges.push('SALARY_VERIFIED');
  if (h % 5 === 0 || ageMins < 180) badges.push('HOT');
  if (h % 7 === 0) badges.push('FEATURED');
  return badges;
}

export function lockedDomainPreview(applyUrl: string): string {
  try {
    const u = new URL(applyUrl);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/$/, '');
    const shortPath =
      path.length > 28 ? `${path.slice(0, 18)}…${path.slice(-6)}` : path || '/';
    return `${host}${shortPath}`;
  } catch {
    return 'apply.lever.co/company/…';
  }
}

export function applicantsToday(jobId: string): number {
  return 12 + (hashCode(jobId) % 37);
}

export function socialProofLine(jobId: string, _badges?: JobBadge[]): string {
  return `🔥 ${applicantsToday(jobId)} candidates unlocked this link today`;
}

/** Freshness badge — "Verified Today" or "Scraped 12m ago" */
export function freshnessBadge(iso: string | null | undefined): string {
  const mins = minutesSince(iso);
  if (mins <= 24 * 60) {
    const h = hashCode(String(iso ?? 'today'));
    if (h % 3 !== 0) return 'Verified Today';
  }
  if (mins < 60) return `Scraped ${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `Scraped ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Scraped ${days}d ago`;
}

const COMPANY_MASKS = [
  'Top-Tier Series B Company',
  'Global Fintech',
  'High-Growth SaaS Startup',
  'Series C Marketplace',
  'Well-Funded AI Company',
  'Remote-First Scale-Up',
  'Category-Leading Tech Firm',
  'Venture-Backed Growth Co',
  'Global Enterprise Tech',
  'Fast-Growing B2B Platform',
] as const;

const ROLE_TEMPLATES: Record<
  Exclude<JobCategory, 'All'>,
  readonly string[]
> = {
  Support: [
    'Senior Support Specialist',
    'Customer Operations Manager',
    'Technical Support Lead',
    'Customer Success Specialist',
    'Client Care Manager',
  ],
  Sales: [
    'Account Executive',
    'Senior Sales Development Rep',
    'Customer Success Manager',
    'Revenue Operations Specialist',
    'Business Development Lead',
  ],
  Operations: [
    'Operations Coordinator',
    'People Operations Specialist',
    'Talent Operations Associate',
    'Business Operations Manager',
    'Program Coordinator',
  ],
  Marketing: [
    'Growth Marketing Specialist',
    'Content Marketing Manager',
    'Demand Generation Lead',
    'Brand Marketing Specialist',
    'Lifecycle Marketing Manager',
  ],
  Engineering: [
    'Software Engineer',
    'Full-Stack Developer',
    'Backend Engineer',
    'Frontend Engineer',
    'Platform Engineer',
  ],
  Design: [
    'Product Designer',
    'UX Designer',
    'Senior UI Designer',
    'Design Systems Specialist',
    'Brand Designer',
  ],
  Product: [
    'Product Manager',
    'Senior Product Manager',
    'Associate Product Manager',
    'Product Operations Lead',
    'Technical Product Manager',
  ],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSeniority(title: string): string {
  const m = title.match(
    /\b(Junior|Jr\.?|Senior|Sr\.?|Lead|Staff|Principal|Head|Director|Chief|II|III|IV)\b/i
  );
  if (!m) return '';
  const raw = m[1];
  if (/^jr\.?$/i.test(raw)) return 'Junior';
  if (/^sr\.?$/i.test(raw)) return 'Senior';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** Generalized company + title for locked (non-subscriber) listings */
export function obfuscateListing(job: {
  id: string;
  title: string;
  company: string;
  description?: string | null;
}): { companyLabel: string; titleLabel: string; headline: string } {
  const h = hashCode(job.id || job.title);
  const companyLabel = COMPANY_MASKS[h % COMPANY_MASKS.length];
  const category = categorizeJob(job.title, job.description);
  const templates = ROLE_TEMPLATES[category];
  let titleLabel = templates[h % templates.length];

  const seniority = extractSeniority(job.title);
  if (
    seniority &&
    !new RegExp(`\\b${escapeRegExp(seniority)}\\b`, 'i').test(titleLabel)
  ) {
    // Prefer original seniority + role noun from template
    const roleNoun = titleLabel
      .replace(
        /^(Junior|Senior|Lead|Staff|Principal|Head|Director|Associate)\s+/i,
        ''
      )
      .trim();
    titleLabel = `${seniority} ${roleNoun}`;
  }

  if (h % 2 === 0) {
    return {
      companyLabel: `[${companyLabel}]`,
      titleLabel,
      headline: `[${companyLabel}] ${titleLabel}`,
    };
  }
  return {
    companyLabel,
    titleLabel,
    headline: `${companyLabel} • ${titleLabel}`,
  };
}

/** Redact real company name from free text when listing is locked */
export function redactCompanyMentions(
  text: string,
  company: string | null | undefined
): string {
  if (!text || !company?.trim() || company.trim().length < 2) return text;
  try {
    return text.replace(
      new RegExp(escapeRegExp(company.trim()), 'gi'),
      'the company'
    );
  } catch {
    return text;
  }
}

export function stripCategoryStamp(description?: string | null): string {
  if (!description) return '';
  return description.replace(/^rrhq_category:[A-Za-z]+\s*\n?/, '').trim();
}

/** High-contrast salary badge label, e.g. "💰 $65,000 - $85,000/yr" */
export function formatSalaryHighlight(
  salary: string | null | undefined
): string | null {
  if (!salary?.trim()) return null;
  let s = salary
    .trim()
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
  if (!/[€£$]/.test(s) && /\d/.test(s)) {
    s = `$${s.replace(/^\$+\s*/, '')}`;
  }
  if (
    /\d/.test(s) &&
    !/\/\s*(yr|year|mo|month|hr|hour|annum)/i.test(s) &&
    !/\b(per|\/)\s*(year|month|hour|annum)\b/i.test(s)
  ) {
    if (/\b(k|000)\b/i.test(s) || /\d{2,3}[,.]?\d{3}/.test(s)) {
      s = `${s}/yr`;
    }
  }
  if (!s.startsWith('💰')) s = `💰 ${s}`;
  return s;
}

const SKILL_RULES: { label: string; pattern: RegExp }[] = [
  { label: 'SaaS', pattern: /\bsaas\b/i },
  { label: 'B2B', pattern: /\bb2b\b/i },
  { label: 'B2C', pattern: /\bb2c\b/i },
  { label: 'Zendesk', pattern: /\bzendesk\b/i },
  { label: 'Salesforce', pattern: /\bsalesforce\b/i },
  { label: 'HubSpot', pattern: /\bhub\s?spot\b/i },
  { label: 'Intercom', pattern: /\bintercom\b/i },
  { label: 'Slack', pattern: /\bslack\b/i },
  { label: 'English', pattern: /\benglish\b/i },
  { label: 'Spanish', pattern: /\bspanish\b/i },
  { label: 'React', pattern: /\breact\b/i },
  { label: 'Python', pattern: /\bpython\b/i },
  { label: 'Node.js', pattern: /\bnode\.?js\b/i },
  { label: 'TypeScript', pattern: /\btypescript\b/i },
  { label: 'SQL', pattern: /\bsql\b/i },
  { label: 'AWS', pattern: /\baws\b/i },
  { label: 'Figma', pattern: /\bfigma\b/i },
  { label: 'SEO', pattern: /\bseo\b/i },
  { label: 'Outbound', pattern: /\boutbound\b/i },
  { label: 'Inbound', pattern: /\binbound\b/i },
];

export function extractSkillTags(job: Job): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    const key = label.toLowerCase();
    if (seen.has(key) || tags.length >= 6) return;
    seen.add(key);
    tags.push(label);
  };

  push(categorizeJob(job.title, job.description));

  const loc = formatLocation(job.location).replace(/^🌍\s*/, '');
  if (/worldwide|anywhere|global/i.test(loc)) push('Remote - Worldwide');
  else if (/\b(united states|USA|\bUS\b)/i.test(loc)) push('Remote - US');
  else if (/\b(europe|UK|EU|EMEA|united kingdom)\b/i.test(loc))
    push('Remote - Europe');
  else if (/\b(latam|brazil|mexico|argentina)\b/i.test(loc))
    push('Remote - LATAM');
  else if (loc) push(`Remote - ${loc.split(',')[0].trim().slice(0, 22)}`);
  else push('Remote');

  const hay = `${job.title}\n${stripCategoryStamp(job.description)}`;
  if (/\bfull[-\s]?time\b/i.test(hay)) push('Full-Time');
  else if (/\bpart[-\s]?time\b/i.test(hay)) push('Part-Time');
  else if (/\bcontract\b|\bfreelance\b/i.test(hay)) push('Contract');
  else push('Full-Time');

  for (const rule of SKILL_RULES) {
    if (rule.pattern.test(hay)) push(rule.label);
  }
  return tags;
}

export type DescriptionSection = { title: string; body: string };

export type ContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

export type DescriptionHighlight = {
  icon: string;
  label: string;
  value: string;
};

export type ParsedJobDescription = {
  highlights: DescriptionHighlight[];
  overview: ContentBlock[];
  sections: { title: string; blocks: ContentBlock[] }[];
};

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–');
}

/** Strip common recruiter / GDPR / board boilerplate from descriptions. */
export function stripDescriptionBoilerplate(text: string): string {
  let out = text;
  const cutFrom = [
    /(?:^|[.\s])Why Apply Through Jobgether\??/i,
    /(?:^|[.\s])How Jobgether works\s*:/i,
    /(?:^|[.\s])Data Privacy Notice\s*:/i,
    /(?:^|[.\s])By submitting your application, you acknowledge that Jobgether/i,
    /(?:^|[.\s])This processing is based on legitimate interest/i,
    /Find more .+ Jobs (?:in .+ )?on Arbeitnow/i,
    /#LI-[A-Z0-9-]+\b/i,
    /Please note that we will never request payment or bank account information[\s\S]{0,600}monks\.com\/careers\s*\)\.?/i,
  ];
  for (const re of cutFrom) {
    const m = out.match(re);
    if (m && typeof m.index === 'number') {
      out = out.slice(0, m.index).trim();
    }
  }
  out = out
    .replace(/\s*You may exercise your rights[\s\S]*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out;
}

/** Strip HTML / category stamp into readable plain text (keeps newlines when present). */
export function cleanJobDescription(description?: string | null): string {
  const stamped = stripCategoryStamp(description);
  let text = decodeBasicEntities(
    stamped
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|tr)>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<h[1-6][^>]*>/gi, '\n\n### ')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<(strong|b)[^>]*>/gi, '**')
      .replace(/<\/(strong|b)>/gi, '**')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
  );
  text = stripDescriptionBoilerplate(text);
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return text;
}

const SECTION_TITLE_MAP: { pattern: RegExp; title: string }[] = [
  { pattern: /^about(?:\s+the)?\s+(?:role|job|position)$/i, title: 'About the Role' },
  { pattern: /^about(?:\s+us|\s+the\s+company)?$/i, title: 'About the Company' },
  { pattern: /^accountabilit(?:y|ies)$/i, title: 'Accountabilities' },
  {
    pattern: /^responsibilit(?:y|ies)(?:\s+and\s+attributions?)?$/i,
    title: 'Responsibilities',
  },
  { pattern: /^what you['’]?ll do$/i, title: "What You'll Do" },
  { pattern: /^the role$/i, title: 'About the Role' },
  { pattern: /^requirements?$/i, title: 'Requirements' },
  { pattern: /^qualifications?$/i, title: 'Qualifications' },
  { pattern: /^must[- ]haves?$/i, title: 'Must-Haves' },
  { pattern: /^nice to haves?$/i, title: 'Nice to Haves' },
  { pattern: /^who you are$/i, title: 'Who You Are' },
  {
    pattern: /^benefits?(?:\s+and\s+perks)?$/i,
    title: 'Benefits',
  },
  { pattern: /^what we(?:'ll| will)? offer$/i, title: 'Benefits' },
  { pattern: /^compensation(?:\s+and\s+benefits)?$/i, title: 'Compensation' },
  { pattern: /^perks$/i, title: 'Benefits' },
];

function normalizeSectionTitle(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  for (const entry of SECTION_TITLE_MAP) {
    if (entry.pattern.test(cleaned)) return entry.title;
  }
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

const SECTION_SPLIT =
  /(?:^|[\n.!?]\s*|\s{2,})(about(?:\s+the)?\s+(?:role|job|position|company)|about us|accountabilit(?:y|ies)|responsibilit(?:y|ies)(?:\s+and\s+attributions?)?|what you['’]?ll do|the role|requirements?|qualifications?|must[- ]haves?|nice to haves?|who you are|benefits?(?:\s+and\s+perks)?|what we(?:'ll| will)? offer|compensation(?:\s+and\s+benefits)?|perks)\s*[:\-–]\s*/gi;

function splitIntoSentences(text: string): string[] {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9•*"'“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [trimmed];
}

function bodyToBlocks(title: string, body: string): ContentBlock[] {
  const cleaned = body.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const bulletLines = cleaned
    .split(/(?:^|\s+)[•●▪◦]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bulletLines.length >= 2 && /^[•●▪◦]/.test(body.trim())) {
    return [
      {
        type: 'list',
        items: bulletLines.map((s) => s.replace(/[.;]\s*$/, '')),
      },
    ];
  }

  // Explicit newlines already list-like
  const lines = body
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (
    lines.length >= 2 &&
    lines.every((l) => /^([•\-*\d]+[.)]\s)/.test(l))
  ) {
    return [
      {
        type: 'list',
        items: lines.map((l) =>
          l.replace(/^[•\-*\d]+[.)]\s+/, '').replace(/[.;]\s*$/, '')
        ),
      },
    ];
  }

  const listSection =
    /accountabilit|responsibilit|requirement|qualification|benefit|compensation|perk|must.?have|nice.?have|what you.?ll do/i.test(
      title
    );

  if (listSection) {
    const sentences = splitIntoSentences(cleaned);
    if (sentences.length >= 2) {
      return [
        {
          type: 'list',
          items: sentences.map((s) => s.replace(/[.;]\s*$/, '').trim()),
        },
      ];
    }
  }

  // Soft-split long walls into ~2–3 sentence paragraphs
  const sentences = splitIntoSentences(cleaned);
  if (sentences.length <= 3) {
    return [{ type: 'paragraph', text: cleaned }];
  }
  const blocks: ContentBlock[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    blocks.push({
      type: 'paragraph',
      text: sentences.slice(i, i + 2).join(' '),
    });
  }
  return blocks;
}

function extractCompensationValue(
  salary: string | null | undefined,
  haystack: string
): string | null {
  const fromSalary = formatSalaryHighlight(salary);
  if (fromSalary) return fromSalary.replace(/^💰\s*/, '');

  const patterns = [
    /(?:base\s+pay|compensation|salary|pay)\s+of\s+([^.]{8,90})/i,
    /((?:USDT|USD|EUR|GBP|\$|€|£)\s?[\d,]+\s*(?:[-–—to]+\s*(?:USDT|USD|EUR|GBP|\$|€|£)?\s?[\d,]+)?(?:\s*(?:per\s+)?(?:month|mo|year|yr|hour|hr))?[^.]{0,60})/i,
    /(commission[^.]{10,100})/i,
  ];
  const hits: string[] = [];
  for (const re of patterns) {
    const m = haystack.match(re);
    if (m?.[1]) hits.push(m[1].replace(/\s+/g, ' ').trim());
  }
  if (hits.length === 0) return null;
  // Prefer combining base + commission when both present
  const unique = [...new Set(hits)].slice(0, 2);
  return unique.join(' + ');
}

export function buildJobHighlights(
  job: Pick<Job, 'salary' | 'location' | 'description' | 'title'>,
  cleanedDescription?: string
): DescriptionHighlight[] {
  const hay = cleanedDescription ?? cleanJobDescription(job.description);
  const highlights: DescriptionHighlight[] = [];

  const compensation = extractCompensationValue(job.salary, hay);
  if (compensation) {
    highlights.push({
      icon: '💰',
      label: 'Compensation',
      value: compensation,
    });
  }

  const loc = formatLocation(job.location).replace(/^🌍\s*/, '');
  const remoteHint = hay.match(
    /\bremote\s+work\s+(?:across|in|from|within)\s+([^.]{3,50})/i
  );
  const locationValue =
    remoteHint && remoteHint[1]
      ? `${loc} / ${remoteHint[1].replace(/\s+/g, ' ').trim()}`
      : loc;
  highlights.push({
    icon: '🌍',
    label: 'Location',
    value: locationValue,
  });

  if (/\bfull[-\s]?time\b/i.test(hay) || /\bfull[-\s]?time\b/i.test(job.title)) {
    highlights.push({ icon: '⏱', label: 'Type', value: 'Full-Time' });
  } else if (/\bpart[-\s]?time\b/i.test(hay)) {
    highlights.push({ icon: '⏱', label: 'Type', value: 'Part-Time' });
  } else if (/\bcontract\b|\bfreelance\b/i.test(hay)) {
    highlights.push({ icon: '⏱', label: 'Type', value: 'Contract' });
  }

  return highlights.slice(0, 4);
}

/** Parse description into overview + titled sections with paragraphs/lists. */
export function parseJobDescription(
  description?: string | null,
  job?: Pick<Job, 'salary' | 'location' | 'description' | 'title'>
): ParsedJobDescription {
  const raw = cleanJobDescription(description);
  if (!raw) {
    return {
      highlights: job ? buildJobHighlights(job, '') : [],
      overview: [
        {
          type: 'paragraph',
          text: 'No description available for this role yet.',
        },
      ],
      sections: [],
    };
  }

  const markers: { title: string; index: number; headerEnd: number }[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(SECTION_SPLIT.source, SECTION_SPLIT.flags);
  while ((match = re.exec(raw)) !== null) {
    const titleStart = match.index + match[0].indexOf(match[1]);
    markers.push({
      title: normalizeSectionTitle(match[1]),
      index: titleStart,
      headerEnd: match.index + match[0].length,
    });
  }

  let overviewText = raw;
  const sections: { title: string; blocks: ContentBlock[] }[] = [];

  if (markers.length > 0) {
    overviewText = raw.slice(0, markers[0].index).trim();
    // Trim trailing punctuation orphan from split before header
    overviewText = overviewText.replace(/[.\s]+$/, (m) =>
      m.includes('.') ? '.' : ''
    );

    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].headerEnd;
      const end = i + 1 < markers.length ? markers[i + 1].index : raw.length;
      let body = raw.slice(start, end).trim();
      body = body.replace(/^[.\s]+/, '').replace(/\s+$/, '');
      if (!body) continue;
      sections.push({
        title: markers[i].title,
        blocks: bodyToBlocks(markers[i].title, body),
      });
    }
  }

  const overview = overviewText
    ? bodyToBlocks('About the Role', overviewText)
    : sections.length === 0
      ? [{ type: 'paragraph' as const, text: raw }]
      : [];

  // If overview empty but first section is About, promote it
  let finalSections = sections;
  let finalOverview = overview;
  if (
    finalOverview.length === 0 &&
    finalSections[0] &&
    /about the role/i.test(finalSections[0].title)
  ) {
    finalOverview = finalSections[0].blocks;
    finalSections = finalSections.slice(1);
  }

  return {
    highlights: buildJobHighlights(
      job ?? {
        salary: null,
        location: null,
        description: description ?? null,
        title: '',
      },
      raw
    ),
    overview: finalOverview,
    sections: finalSections,
  };
}

/** @deprecated Prefer parseJobDescription — kept for any older callers. */
export function parseJobDescriptionLegacy(description?: string | null): {
  overview: string;
  sections: DescriptionSection[];
} {
  const parsed = parseJobDescription(description);
  const flatten = (blocks: ContentBlock[]) =>
    blocks
      .map((b) =>
        b.type === 'list' ? b.items.map((i) => `• ${i}`).join('\n') : b.text
      )
      .join('\n\n');
  return {
    overview: flatten(parsed.overview),
    sections: parsed.sections.map((s) => ({
      title: s.title,
      body: flatten(s.blocks),
    })),
  };
}
