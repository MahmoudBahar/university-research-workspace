import { z } from 'zod';
import {
  AccessStatus,
  EvidenceRef,
  EvidenceStatus,
  IanaZone,
  IdentityConfidence,
  IsoDate,
  RoleCategory,
  SourceCategory,
  SummaryBasis,
  SupervisionAvailability,
  TimezoneBasis,
  UnitType,
} from './common.js';

export const NOTE_SCHEMA_VERSION = 1;

export const NoteType = z.enum([
  'index',
  'university',
  'unit',
  'program',
  'person',
  'source_map',
  'lab',
  'publication',
  'outreach_draft',
  'outreach_brief',
  'source',
  'view',
  'applicant_profile',
  'applicant_style',
  'applicant_override',
]);
export type NoteType = z.infer<typeof NoteType>;

/** Frontmatter fields every note carries. */
export const BaseFrontmatter = z.object({
  schema_version: z.number().int().min(1),
  id: z.string().min(1),
  type: NoteType,
  title: z.string().min(1),
  revision: z.number().int().min(0).default(0),
  checked_at: IsoDate.optional(),
  created_at: IsoDate.optional(),
  sources: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const UniversityFrontmatter = BaseFrontmatter.extend({
  type: z.literal('university'),
  official_name: z.string().min(1),
  domain: z.string().optional(),
  homepage_url: z.string().optional(),
  country: z.string().optional(),
  campuses: z.array(z.string()).default([]),
  default_timezone: IanaZone.optional(),
  discovery_gaps: z.array(z.string()).default([]),
});

export const UnitFrontmatter = BaseFrontmatter.extend({
  type: z.literal('unit'),
  official_name: z.string().min(1),
  unit_type: UnitType,
  university_id: z.string(),
  parents: z.array(z.string()).default([]),
  campus: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  urls: z
    .object({
      main: z.string().optional(),
      faculty_directory: z.string().optional(),
      graduate_programs: z.string().optional(),
      research: z.string().optional(),
      labs: z.string().optional(),
    })
    .prefault({}),
  scope_decision: z.enum(['included', 'excluded', 'undecided']).default('undecided'),
  discovery_gaps: z.array(z.string()).default([]),
});

export const ProgramFrontmatter = BaseFrontmatter.extend({
  type: z.literal('program'),
  official_title: z.string().min(1),
  award: z.string().optional(),
  degree_family: z.string().optional(),
  university_id: z.string(),
  administering_units: z.array(z.string()).default([]),
  campus: z.string().optional(),
  academic_year: z.string().optional(),
  intakes: z.array(z.string()).default([]),
  supervisor_required_before_application: z
    .enum(['yes', 'no', 'recommended', 'unknown'])
    .default('unknown'),
  categories_checked: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
  evidence: z.array(EvidenceRef).default([]),
});

export const PersonFrontmatter = BaseFrontmatter.extend({
  type: z.literal('person'),
  full_name: z.string().min(1),
  official_title: z.string().optional(),
  role_category: RoleCategory,
  identity_confidence: IdentityConfidence.default('uncertain'),
  affiliations: z.array(z.string()).default([]),
  labs: z.array(z.string()).default([]),
  profile_url: z.string().optional(),
  orcid: z.string().optional(),
  email: z.string().optional(),
  email_evidence: EvidenceStatus.default('unknown'),
  contact_rule: z.enum(['email_ok', 'portal_only', 'do_not_email', 'unknown']).default('unknown'),
  timezone: IanaZone.optional(),
  timezone_basis: TimezoneBasis.default('unknown'),
  supervision: z
    .array(
      z.object({
        program_id: z.string().optional(),
        program_title: z.string().optional(),
        availability: SupervisionAvailability,
        checked_at: IsoDate.optional(),
        source_id: z.string().optional(),
      }),
    )
    .default([]),
  research_complete: z.boolean().default(false),
  publication_scope: z.string().optional(),
  coverage_limitations: z.array(z.string()).default([]),
});

export const SourceMapFrontmatter = BaseFrontmatter.extend({
  type: z.literal('source_map'),
  person_id: z.string(),
  categories_searched: z.array(SourceCategory).default([]),
  entries: z
    .array(
      z.object({
        source_id: z.string().optional(),
        url: z.string(),
        category: SourceCategory,
        discovery_source: z.string().optional(),
        identity_confidence: IdentityConfidence.default('uncertain'),
        access_status: AccessStatus.default('not_attempted'),
        last_attempt_at: IsoDate.optional(),
        investigated: z.boolean().default(false),
      }),
    )
    .default([]),
  absent_categories: z.array(SourceCategory).default([]),
  blocked: z.array(z.string()).default([]),
});

export const LabFrontmatter = BaseFrontmatter.extend({
  type: z.literal('lab'),
  official_name: z.string().min(1),
  university_id: z.string().optional(),
  units: z.array(z.string()).default([]),
  url: z.string().optional(),
  directors: z.array(z.string()).default([]),
  members_current: z.array(z.string()).default([]),
  members_former: z.array(z.string()).default([]),
  timezone: IanaZone.optional(),
  timezone_basis: TimezoneBasis.default('unknown'),
  recruitment_notice: z
    .object({
      text: z.string().optional(),
      observed_at: IsoDate.optional(),
      source_id: z.string().optional(),
    })
    .prefault({}),
  unavailable_information: z.array(z.string()).default([]),
});

export const PublicationFrontmatter = BaseFrontmatter.extend({
  type: z.literal('publication'),
  publication_title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  author_entity_ids: z.array(z.string()).default([]),
  doi: z.string().optional(),
  identifiers: z.record(z.string(), z.string()).prefault({}),
  publication_type: z.string().optional(),
  venue: z.string().optional(),
  published_date: z.string().optional(),
  online_date: z.string().optional(),
  preprint_date: z.string().optional(),
  version_of: z.string().optional(),
  accessibility: AccessStatus.default('not_attempted'),
  summary_basis: SummaryBasis.default('none'),
  links: z.array(z.string()).default([]),
});

export const OutreachDraftFrontmatter = BaseFrontmatter.extend({
  type: z.literal('outreach_draft'),
  outreach_id: z.string(),
  person_id: z.string(),
  program_id: z.string().optional(),
  purpose: z.string(),
  campaign: z.string().default('default'),
  recipient: z.string(),
  subject: z.string(),
  state: z.enum(['draft', 'needs_review', 'approved', 'sent', 'archived']).default('draft'),
  attachments: z
    .array(
      z.object({
        document_id: z.string(),
        version: z.number().int().min(1),
        filename: z.string(),
        sha256: z.string(),
      }),
    )
    .default([]),
  applicant_revision_id: z.string().optional(),
  style_revision_id: z.string().optional(),
  contact_requirements: z
    .array(
      z.object({
        requirement: z.string(),
        source_id: z.string().optional(),
        satisfied: z.enum(['yes', 'no', 'unknown']).default('unknown'),
      }),
    )
    .default([]),
});

export const OutreachBriefFrontmatter = BaseFrontmatter.extend({
  type: z.literal('outreach_brief'),
  outreach_id: z.string(),
  person_id: z.string(),
});

export const SourceNoteFrontmatter = BaseFrontmatter.extend({
  type: z.literal('source'),
  url: z.string(),
  category: SourceCategory,
  access_status: AccessStatus.default('not_attempted'),
  observed_at: IsoDate.optional(),
});

export const GenericFrontmatter = BaseFrontmatter;

export const NOTE_SCHEMAS = {
  index: GenericFrontmatter,
  view: GenericFrontmatter,
  university: UniversityFrontmatter,
  unit: UnitFrontmatter,
  program: ProgramFrontmatter,
  person: PersonFrontmatter,
  source_map: SourceMapFrontmatter,
  lab: LabFrontmatter,
  publication: PublicationFrontmatter,
  outreach_draft: OutreachDraftFrontmatter,
  outreach_brief: OutreachBriefFrontmatter,
  source: SourceNoteFrontmatter,
  applicant_profile: GenericFrontmatter,
  applicant_style: GenericFrontmatter,
  applicant_override: GenericFrontmatter,
} as const satisfies Record<NoteType, z.ZodTypeAny>;

export type AnyFrontmatter = z.infer<typeof GenericFrontmatter> & Record<string, unknown>;

export function schemaForType(type: string): z.ZodTypeAny | undefined {
  return (NOTE_SCHEMAS as Record<string, z.ZodTypeAny>)[type];
}
