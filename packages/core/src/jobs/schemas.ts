import { z } from 'zod';
import {
  AccessStatus,
  FetchMethod,
  EvidenceRef,
  EvidenceStatus,
  IdentityConfidence,
  IsoDate,
  RoleCategory,
  SourceCategory,
  SummaryBasis,
  SupervisionAvailability,
  TimezoneBasis,
  UnitType,
} from '../schemas/common.js';

export const RESULT_SCHEMA_VERSION = 1;

export const SourceInput = z.object({
  url: z.string().min(1),
  category: SourceCategory.default('other'),
  title: z.string().optional(),
  publisher: z.string().optional(),
  /** Required: omitting it must never read as a silent claim of success. */
  access_status: AccessStatus,
  fetch_method: FetchMethod.default('none'),
  observed_at: IsoDate.optional(),
  notes: z.string().optional(),
});
export type SourceInput = z.infer<typeof SourceInput>;

const CoverageBlock = z.object({
  pages_checked: z.array(z.string()).default([]),
  inaccessible: z
    .array(
      z.object({
        url: z.string(),
        reason: z.string(),
        status: AccessStatus.default('blocked'),
        fetch_method: FetchMethod.default('none'),
      }),
    )
    .default([]),
  notes: z.string().optional(),
});

export const UniversityDiscoveryResult = z.object({
  job: z.literal('discover_university'),
  university: z.object({
    official_name: z.string().min(1),
    domain: z.string().optional(),
    homepage_url: z.string().optional(),
    country: z.string().optional(),
    campuses: z.array(z.string()).default([]),
    default_timezone: z.string().optional(),
    overview: z.string().default(''),
    discovery_gaps: z.array(z.string()).default([]),
    sources: z.array(SourceInput).default([]),
  }),
  units: z
    .array(
      z.object({
        key: z.string().min(1),
        official_name: z.string().min(1),
        unit_type: UnitType,
        parent_key: z.string().nullable().default(null),
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
        overview: z.string().default(''),
        themes: z.array(z.string()).default([]),
        graduate_offerings: z.array(z.string()).default([]),
        discovery_gaps: z.array(z.string()).default([]),
        sources: z.array(SourceInput).default([]),
      }),
    )
    .default([]),
  ambiguity_candidates: z
    .array(z.object({ name: z.string(), url: z.string().optional(), note: z.string().optional() }))
    .default([]),
  coverage: CoverageBlock.prefault({}),
  summary: z.string().default(''),
});
export type UniversityDiscoveryResult = z.infer<typeof UniversityDiscoveryResult>;

const CategoryFacts = z.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()])).prefault({});

export const ProgramResearchResult = z.object({
  job: z.literal('research_programs'),
  unit_id: z.string(),
  programs: z
    .array(
      z.object({
        identity: z.object({
          official_title: z.string().min(1),
          award: z.string().optional(),
          degree_family: z.string().optional(),
          faculty: z.string().optional(),
          campus: z.string().optional(),
          joint_administration: z.string().optional(),
          administering_unit_ids: z.array(z.string()).default([]),
        }),
        overview: CategoryFacts,
        structure: CategoryFacts,
        attendance: CategoryFacts,
        research: CategoryFacts,
        curriculum: CategoryFacts,
        eligibility: CategoryFacts,
        application: CategoryFacts,
        supervision: CategoryFacts,
        funding: CategoryFacts,
        contact: CategoryFacts,
        extensions: CategoryFacts,
        academic_year: z.string().optional(),
        intakes: z.array(z.string()).default([]),
        supervisor_required_before_application: z.enum(['yes', 'no', 'recommended', 'unknown']).default('unknown'),
        categories_checked: z.array(z.string()).default([]),
        open_questions: z.array(z.string()).default([]),
        conflicts: z.array(z.string()).default([]),
        evidence: z.array(EvidenceRef).default([]),
        sources: z.array(SourceInput).default([]),
      }),
    )
    .default([]),
  no_program_found: z
    .object({ searched_pages: z.array(z.string()).default([]), result: z.string() })
    .optional(),
  coverage: CoverageBlock.prefault({}),
  summary: z.string().default(''),
});
export type ProgramResearchResult = z.infer<typeof ProgramResearchResult>;

export const PeopleDiscoveryResult = z.object({
  job: z.literal('discover_people'),
  unit_id: z.string(),
  people: z
    .array(
      z.object({
        full_name: z.string().min(1),
        official_title: z.string().optional(),
        role_category: RoleCategory,
        profile_url: z.string().optional(),
        orcid: z.string().optional(),
        email: z.string().optional(),
        email_evidence: EvidenceStatus.default('unknown'),
        research_themes: z.array(z.string()).default([]),
        identity_confidence: IdentityConfidence.default('uncertain'),
        graduate_supervision_evidence: z.string().optional(),
        contact_suitability_evidence: z.string().optional(),
        relationships: z
          .array(
            z.object({
              to_name: z.string().optional(),
              to_person_id: z.string().optional(),
              rel_type: z.string(),
              role: z.string().optional(),
              evidence_status: EvidenceStatus.default('unverified'),
              source_url: z.string().optional(),
            }),
          )
          .default([]),
        sources: z.array(SourceInput).default([]),
      }),
    )
    .default([]),
  coverage: CoverageBlock.extend({
    directory_pages: z.array(z.string()).default([]),
    pagination_handled: z.boolean().default(false),
    categories: z.array(z.string()).default([]),
  }).prefault({}),
  summary: z.string().default(''),
});
export type PeopleDiscoveryResult = z.infer<typeof PeopleDiscoveryResult>;

export const SourceMapResult = z.object({
  job: z.literal('map_person_sources'),
  person_id: z.string(),
  entries: z
    .array(
      z.object({
        url: z.string().min(1),
        category: SourceCategory,
        discovery_source: z.string().optional(),
        identity_confidence: IdentityConfidence.default('uncertain'),
        access_status: AccessStatus.default('not_attempted'),
        fetch_method: FetchMethod.default('none'),
        last_attempt_at: IsoDate.optional(),
        title: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  absent_categories: z.array(SourceCategory).default([]),
  blocked: z.array(z.object({ url: z.string(), reason: z.string() })).default([]),
  timezone_basis_location: z.string().optional(),
  summary: z.string().default(''),
});
export type SourceMapResult = z.infer<typeof SourceMapResult>;

export const PublicationInput = z.object({
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  doi: z.string().optional(),
  identifiers: z.record(z.string(), z.string()).prefault({}),
  publication_type: z.string().optional(),
  venue: z.string().optional(),
  published_date: z.string().optional(),
  online_date: z.string().optional(),
  preprint_date: z.string().optional(),
  links: z.array(z.string()).default([]),
  accessibility: AccessStatus.default('not_attempted'),
  summary_basis: SummaryBasis.default('metadata_only'),
  summary: z
    .object({
      research_question: z.string().optional(),
      approach: z.string().optional(),
      findings: z.string().optional(),
      stated_limitations: z.string().optional(),
      possible_relevance: z.string().optional(),
      abstract_text: z.string().optional(),
    })
    .optional(),
  version_of_doi: z.string().optional(),
  is_preprint: z.boolean().default(false),
});
export type PublicationInput = z.infer<typeof PublicationInput>;

export const PersonResearchResult = z.object({
  job: z.literal('research_person'),
  person_id: z.string(),
  identity: z.object({
    full_name: z.string().min(1),
    official_title: z.string().optional(),
    role_category: RoleCategory,
    appointments: z.array(z.string()).default([]),
    biography: z.string().default(''),
    uncertainties: z.array(z.string()).default([]),
  }),
  research: z.object({
    interests: z.array(z.string()).default([]),
    methods: z.array(z.string()).default([]),
    themes: z.array(z.string()).default([]),
    synthesis: z.string().default(''),
  }),
  current_activity: z
    .object({
      projects: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().default(''),
            evidence_status: EvidenceStatus.default('unverified'),
            observed_at: IsoDate.optional(),
            source_url: z.string().optional(),
          }),
        )
        .default([]),
      notes: z.string().default(''),
    })
    .prefault({}),
  affiliations: z
    .object({
      lab_ids: z.array(z.string()).default([]),
      labs: z
        .array(z.object({ name: z.string(), url: z.string().optional(), role: z.string().optional(), status: z.string().default('current') }))
        .default([]),
      collaborators: z.array(z.object({ name: z.string(), note: z.string().optional() })).default([]),
      students: z
        .array(
          z.object({
            full_name: z.string(),
            role: z.string().default('graduate student'),
            role_category: RoleCategory.default('graduate_student'),
            profile_url: z.string().optional(),
            source_url: z.string().optional(),
          }),
        )
        .default([]),
    })
    .prefault({}),
  supervision: z
    .array(
      z.object({
        program_id: z.string().optional(),
        program_title: z.string().optional(),
        availability: SupervisionAvailability,
        checked_at: IsoDate.optional(),
        source_url: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  publications: z.array(PublicationInput).default([]),
  contact: z
    .object({
      email: z.string().optional(),
      email_evidence: EvidenceStatus.default('unknown'),
      preferred_method: z.string().optional(),
      instructions: z.string().optional(),
      required_subject: z.string().optional(),
      requested_documents: z.array(z.string()).default([]),
      contact_rule: z.enum(['email_ok', 'portal_only', 'do_not_email', 'unknown']).default('unknown'),
      checked_at: IsoDate.optional(),
      source_url: z.string().optional(),
    })
    .prefault({}),
  location: z
    .object({
      institutional_location: z.string().optional(),
      timezone: z.string().optional(),
      timezone_basis: TimezoneBasis.default('unknown'),
      observed_at: IsoDate.optional(),
    })
    .prefault({}),
  applicant_connections: z
    .object({
      connections: z.array(z.string()).default([]),
      gaps: z.array(z.string()).default([]),
      questions: z.array(z.string()).default([]),
    })
    .optional(),
  evidence: z
    .object({
      sources: z.array(SourceInput).default([]),
      verification: z.array(z.object({ claim: z.string(), status: z.string(), note: z.string().optional() })).default([]),
      coverage: z.array(z.string()).default([]),
      blocked: z.array(z.object({ url: z.string(), reason: z.string() })).default([]),
      unresolved: z.array(z.string()).default([]),
    })
    .prefault({}),
  scope: z
    .object({
      publication_scope: z.string().default('all discoverable publications in agreed scope'),
      budget_exhausted: z.boolean().default(false),
      papers_summarised: z.number().int().default(0),
    })
    .prefault({}),
  research_complete: z.boolean().default(false),
  summary: z.string().default(''),
});
export type PersonResearchResult = z.infer<typeof PersonResearchResult>;

export const LabResearchResult = z.object({
  job: z.literal('research_lab'),
  lab_id: z.string().optional(),
  lab: z.object({
    official_name: z.string().min(1),
    url: z.string().optional(),
    university_id: z.string().optional(),
    unit_ids: z.array(z.string()).default([]),
    themes: z.array(z.string()).default([]),
    projects: z.array(z.object({ name: z.string(), description: z.string().default('') })).default([]),
    facilities: z.array(z.string()).default([]),
    collaborations: z.array(z.string()).default([]),
    recruitment: z
      .object({ text: z.string().optional(), observed_at: IsoDate.optional(), source_url: z.string().optional() })
      .prefault({}),
    contact_instructions: z.string().optional(),
    location: z.string().optional(),
    timezone: z.string().optional(),
    timezone_basis: TimezoneBasis.default('unknown'),
    overview: z.string().default(''),
  }),
  members: z
    .array(
      z.object({
        full_name: z.string().min(1),
        person_id: z.string().optional(),
        role: z.string().default(''),
        role_category: RoleCategory.default('unknown'),
        status: z.enum(['current', 'former', 'unknown']).default('current'),
        is_director: z.boolean().default(false),
        profile_url: z.string().optional(),
        source_url: z.string().optional(),
        observed_at: IsoDate.optional(),
      }),
    )
    .default([]),
  publications: z.array(z.object({ title: z.string(), doi: z.string().optional(), url: z.string().optional() })).default([]),
  unavailable_information: z.array(z.string()).default([]),
  sources: z.array(SourceInput).default([]),
  summary: z.string().default(''),
});
export type LabResearchResult = z.infer<typeof LabResearchResult>;

export const OutreachDraftResult = z.object({
  job: z.literal('draft_outreach'),
  person_id: z.string(),
  purpose: z.string().default('initial_contact'),
  program_id: z.string().nullable().default(null),
  campaign: z.string().default('default'),
  recipient: z.string().min(3),
  subject: z.string().min(1),
  body: z.string().min(1),
  attachments: z.array(z.object({ document_id: z.string(), version: z.number().int().optional() })).default([]),
  contact_requirements: z
    .array(
      z.object({
        requirement: z.string(),
        source_id: z.string().optional(),
        satisfied: z.enum(['yes', 'no', 'unknown']).default('unknown'),
      }),
    )
    .default([]),
  supporting_links: z.array(z.object({ label: z.string(), vault_path: z.string() })).default([]),
  brief: z.string().min(1),
  timing_note: z.string().optional(),
});
export type OutreachDraftResult = z.infer<typeof OutreachDraftResult>;

export const VerificationResult = z.object({
  job: z.literal('verify_person'),
  person_id: z.string(),
  checks: z
    .array(
      z.object({
        claim: z.string(),
        status: z.enum(['confirmed', 'refuted', 'unresolved']),
        source_url: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  research_complete: z.boolean().default(false),
  blocking_issues: z.array(z.string()).default([]),
  summary: z.string().default(''),
});
export type VerificationResult = z.infer<typeof VerificationResult>;

export const JobResult = z.discriminatedUnion('job', [
  UniversityDiscoveryResult,
  ProgramResearchResult,
  PeopleDiscoveryResult,
  SourceMapResult,
  PersonResearchResult,
  LabResearchResult,
  OutreachDraftResult,
  VerificationResult,
]);
export type JobResult = z.infer<typeof JobResult>;
