import { z } from 'zod';

export const EvidenceStatus = z.enum(['confirmed', 'inferred', 'unverified', 'conflicting', 'unknown']);
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;

export const AccessStatus = z.enum([
  'accessible',
  'blocked',
  'not_found',
  'auth_required',
  'captcha',
  'rate_limited',
  'error',
  'not_attempted',
  /** A plain fetch returned no usable content (JavaScript shell, consent interstitial); a browser is needed. */
  'needs_browser',
]);
export type AccessStatus = z.infer<typeof AccessStatus>;

/** How a page was retrieved. `browser` means the user's Claude in Chrome session. */
export const FetchMethod = z.enum(['web_fetch', 'browser', 'web_search', 'manual', 'none']);
export type FetchMethod = z.infer<typeof FetchMethod>;

/** Access outcomes that a browser retrieval may still resolve. */
export const RETRYABLE_WITH_BROWSER: readonly string[] = ['needs_browser', 'blocked', 'captcha', 'rate_limited'];

export const IdentityConfidence = z.enum(['verified', 'probable', 'uncertain', 'name_only', 'rejected']);
export type IdentityConfidence = z.infer<typeof IdentityConfidence>;

export const UnitType = z.enum([
  'university',
  'faculty',
  'school',
  'department',
  'institute',
  'centre',
  'graduate_unit',
  'division',
  'other',
]);
export type UnitType = z.infer<typeof UnitType>;

/**
 * Normalised role category. Kept strictly separate from the official title so
 * that "Assistant Professor" is never confused with a research assistant.
 */
export const RoleCategory = z.enum([
  'professor',
  'associate_professor',
  'assistant_professor',
  'teaching_stream_faculty',
  'emeritus',
  'adjunct',
  'lecturer',
  'postdoctoral_researcher',
  'research_associate',
  'research_assistant',
  'graduate_student',
  'administrative_staff',
  'technical_staff',
  'unknown',
]);
export type RoleCategory = z.infer<typeof RoleCategory>;

export const SourceCategory = z.enum([
  'official_profile',
  'graduate_faculty',
  'department_directory',
  'personal_site',
  'cv',
  'lab_page',
  'project_page',
  'recruitment_page',
  'scholar',
  'orcid',
  'repository',
  'publisher',
  'preprint',
  'contact_page',
  'graduate_calendar',
  'program_page',
  'news',
  'other',
]);
export type SourceCategory = z.infer<typeof SourceCategory>;

export const TimezoneBasis = z.enum(['directly_stated', 'campus_inferred', 'user_override', 'unknown']);
export type TimezoneBasis = z.infer<typeof TimezoneBasis>;

export const SummaryBasis = z.enum(['full_text', 'abstract_only', 'metadata_only', 'none']);
export type SummaryBasis = z.infer<typeof SummaryBasis>;

export const SupervisionAvailability = z.enum(['accepting', 'not_accepting', 'no_public_information']);
export type SupervisionAvailability = z.infer<typeof SupervisionAvailability>;

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const IsoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, 'Expected an ISO-8601 UTC instant');
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
export const EntityId = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*-\d{4,}$/, 'Expected an entity id such as person-0001');

/** A single sourced statement; the unit that makes a note auditable. */
export const EvidenceRef = z.object({
  claim: z.string().min(1),
  source_id: z.string().optional(),
  url: z.string().optional(),
  status: EvidenceStatus.default('unverified'),
  checked_at: IsoDate.optional(),
  quote: z.string().optional(),
  note: z.string().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const IanaZone = z
  .string()
  .min(3)
  .refine((value) => /^[A-Za-z]+(?:[_+-]?[A-Za-z0-9]+)*(?:\/[A-Za-z0-9_+-]+)+$|^UTC$/.test(value), {
    message: 'Expected an IANA zone identifier such as America/Toronto',
  });
