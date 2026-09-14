/**
 * Fixtures for a university that does not exist.
 *
 * Every name, address, URL and identifier below is invented. `.invalid` is
 * reserved by RFC 2606 and can never resolve, so nothing here can accidentally
 * touch a real institution or person.
 */
import type {
  LabResearchResult,
  OutreachDraftResult,
  PeopleDiscoveryResult,
  PersonResearchResult,
  ProgramResearchResult,
  SourceMapResult,
  UniversityDiscoveryResult,
  VerificationResult,
} from '@urw/core';

export const UNIVERSITY_NAME = 'Northvale Institute of Technology';
export const UNIVERSITY_DOMAIN = 'northvale.invalid';
const base = `https://www.${UNIVERSITY_DOMAIN}`;

export function universityDiscovery(): UniversityDiscoveryResult {
  return {
    job: 'discover_university',
    university: {
      official_name: UNIVERSITY_NAME,
      domain: UNIVERSITY_DOMAIN,
      homepage_url: base,
      country: 'Fictionland',
      campuses: ['Northvale main campus', 'Harbourside campus'],
      default_timezone: 'America/Toronto',
      overview:
        'Northvale Institute of Technology is a fictional institution used to exercise this workspace. It has two campuses and three faculties.',
      discovery_gaps: ['The Harbourside campus directory was not paginated beyond page 2 during this run.'],
      sources: [
        { url: `${base}/about`, category: 'other', title: 'About Northvale', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
        { url: `${base}/faculties`, category: 'other', title: 'Faculties and schools', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
      ],
    },
    units: [
      {
        key: 'eng',
        official_name: 'Faculty of Engineering',
        unit_type: 'faculty',
        parent_key: null,
        campus: 'Northvale main campus',
        aliases: ['Engineering'],
        urls: { main: `${base}/engineering`, graduate_programs: `${base}/engineering/graduate` },
        overview: 'The fictional Faculty of Engineering contains three departments.',
        themes: ['Systems engineering', 'Materials'],
        graduate_offerings: ['MASc', 'MEng', 'PhD'],
        discovery_gaps: [],
        sources: [{ url: `${base}/engineering`, category: 'other', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' }],
      },
      {
        key: 'ece',
        official_name: 'Department of Electrical and Computer Engineering',
        unit_type: 'department',
        parent_key: 'eng',
        campus: 'Northvale main campus',
        aliases: ['ECE'],
        urls: {
          main: `${base}/engineering/ece`,
          faculty_directory: `${base}/engineering/ece/people`,
          graduate_programs: `${base}/engineering/ece/graduate`,
          labs: `${base}/engineering/ece/labs`,
        },
        overview: 'A fictional department covering signal processing, embedded systems and photonics.',
        themes: ['Signal processing', 'Embedded systems', 'Photonics'],
        graduate_offerings: ['MASc in Electrical and Computer Engineering'],
        discovery_gaps: ['Adjunct faculty are listed on a separate page that returned 403 during this run.'],
        sources: [{ url: `${base}/engineering/ece`, category: 'department_directory', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' }],
      },
      {
        key: 'mech',
        official_name: 'Department of Mechanical Engineering',
        unit_type: 'department',
        parent_key: 'eng',
        campus: 'Northvale main campus',
        aliases: [],
        urls: { main: `${base}/engineering/mech`, faculty_directory: `${base}/engineering/mech/people` },
        overview: 'A fictional department covering thermofluids and robotics.',
        themes: ['Thermofluids', 'Robotics'],
        graduate_offerings: ['MASc in Mechanical Engineering'],
        discovery_gaps: [],
        sources: [{ url: `${base}/engineering/mech`, category: 'department_directory', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' }],
      },
      {
        key: 'arts',
        official_name: 'Faculty of Arts and Letters',
        unit_type: 'faculty',
        parent_key: null,
        campus: 'Harbourside campus',
        aliases: [],
        urls: { main: `${base}/arts` },
        overview: 'A fictional faculty that is out of scope for an engineering applicant.',
        themes: ['Literature'],
        graduate_offerings: ['MA'],
        discovery_gaps: [],
        sources: [{ url: `${base}/arts`, category: 'other', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' }],
      },
      {
        key: 'photonics',
        official_name: 'Northvale Institute for Photonic Systems',
        unit_type: 'institute',
        parent_key: 'eng',
        campus: 'Harbourside campus',
        aliases: ['NIPS'],
        urls: { main: `${base}/photonics` },
        overview: 'A fictional cross-faculty institute.',
        themes: ['Integrated photonics'],
        graduate_offerings: [],
        discovery_gaps: [],
        sources: [{ url: `${base}/photonics`, category: 'other', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' }],
      },
    ],
    ambiguity_candidates: [],
    coverage: {
      pages_checked: [`${base}/about`, `${base}/faculties`, `${base}/engineering`, `${base}/arts`],
      inaccessible: [{ url: `${base}/engineering/ece/adjuncts`, reason: 'HTTP 403 for anonymous visitors', status: 'blocked', fetch_method: 'web_fetch' }],
      notes: 'Two faculties and one institute were traversed. Nothing was inferred from an inaccessible page.',
    },
    summary: 'Discovered 5 units across 2 campuses. All units start undecided.',
  };
}

export function programResearch(unitId: string): ProgramResearchResult {
  return {
    job: 'research_programs',
    unit_id: unitId,
    programs: [
      {
        identity: {
          official_title: 'Master of Applied Science in Electrical and Computer Engineering',
          award: 'MASc',
          degree_family: 'MASc',
          faculty: 'Faculty of Engineering',
          campus: 'Northvale main campus',
          administering_unit_ids: [unitId],
        },
        overview: {
          program_overview: 'A fictional thesis-based research degree in electrical and computer engineering.',
          objectives: 'Prepare graduates for research careers or doctoral study.',
        },
        structure: { admit_terms: 'Fall, Winter', delivery_mode: 'In person', program_type: 'Thesis-based research', normal_length: '24 months' },
        attendance: { registration_options: 'Full time; part time by permission', study_option: 'Thesis' },
        research: {
          research_fields: ['Signal processing', 'Embedded systems', 'Photonics'],
          associated_labs: 'Northvale Signal Systems Laboratory',
        },
        curriculum: { required_credits: '4.0 credits plus thesis', milestones: 'Research proposal by month 8; thesis defence by month 24' },
        eligibility: {
          degree_requirement: 'Four-year bachelor degree in a related discipline',
          grade_wording: 'Minimum B+ standing in the final two years, as stated by the fictional calendar',
          english_tests: 'IELTS Academic 7.0 overall with no band below 6.5, or an exemption listed on the admissions page',
        },
        application: {
          deadlines: 'Fall intake: 15 January. Winter intake: 15 August.',
          documents: 'Transcripts, two references, statement of interest, CV',
          application_fee: 'FCU 120',
        },
        supervision: {
          supervisor_required_before_application: 'Recommended but not required by the fictional calendar',
          confirmation_process: 'The department confirms supervision after an offer of admission',
        },
        funding: {
          tuition: 'FCU 9,400 per year for the 2026-2027 fictional academic year',
          funding_wording: 'Funding packages are described as possible, not guaranteed, on the fictional funding page',
        },
        contact: { graduate_coordinator: 'grad-ece@northvale.invalid', instructions: 'Email the coordinator for admissions questions' },
        extensions: { accreditation: 'Not stated on any page checked' },
        academic_year: '2026-2027',
        intakes: ['Fall', 'Winter'],
        supervisor_required_before_application: 'recommended',
        categories_checked: ['identity', 'overview', 'structure', 'attendance', 'research', 'curriculum', 'eligibility', 'application', 'supervision', 'funding', 'contact'],
        open_questions: ['Whether part-time study is available for international applicants was not stated.'],
        conflicts: ['The department page says 24 months; the calendar says "normally two years". Both are recorded.'],
        evidence: [
          { claim: 'IELTS 7.0 overall, no band below 6.5', url: `${base}/engineering/ece/graduate`, status: 'confirmed', checked_at: '2026-09-10' },
          { claim: 'Funding is not guaranteed', url: `${base}/engineering/ece/funding`, status: 'confirmed', checked_at: '2026-09-10' },
        ],
        sources: [
          { url: `${base}/engineering/ece/graduate`, category: 'program_page', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
          { url: `${base}/calendar/2026/ece-masc`, category: 'graduate_calendar', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
        ],
      },
    ],
    coverage: {
      pages_checked: [`${base}/engineering/ece/graduate`, `${base}/calendar/2026/ece-masc`],
      inaccessible: [],
      notes: 'Both the department page and the fictional graduate calendar were cross-checked.',
    },
    summary: 'One MASc program recorded with one recorded conflict.',
  };
}

export function peopleDiscovery(unitId: string): PeopleDiscoveryResult {
  return {
    job: 'discover_people',
    unit_id: unitId,
    people: [
      {
        full_name: 'Dr Amara Osei',
        official_title: 'Associate Professor',
        role_category: 'associate_professor',
        profile_url: `${base}/engineering/ece/people/aosei`,
        orcid: '0000-0002-1825-0097',
        email: 'a.osei@northvale.invalid',
        email_evidence: 'confirmed',
        research_themes: ['Adaptive signal processing', 'Underwater acoustics'],
        identity_confidence: 'verified',
        graduate_supervision_evidence: 'Listed on the fictional graduate faculty page',
        contact_suitability_evidence: 'Profile publishes a departmental address for research enquiries',
        relationships: [],
        sources: [{ url: `${base}/engineering/ece/people/aosei`, category: 'official_profile', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' }],
      },
      {
        full_name: 'Dr Ruben Kaltsas',
        official_title: 'Assistant Professor',
        role_category: 'assistant_professor',
        profile_url: `${base}/engineering/ece/people/rkaltsas`,
        email: 'r.kaltsas@northvale.invalid',
        email_evidence: 'confirmed',
        research_themes: ['Embedded systems'],
        identity_confidence: 'verified',
        relationships: [],
        sources: [{ url: `${base}/engineering/ece/people/rkaltsas`, category: 'official_profile', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' }],
      },
      {
        full_name: 'Priya Raman',
        official_title: 'Research Assistant',
        role_category: 'research_assistant',
        profile_url: `${base}/engineering/ece/people/praman`,
        email_evidence: 'unknown',
        research_themes: [],
        identity_confidence: 'probable',
        contact_suitability_evidence: 'No public statement about contacting this person about supervision',
        relationships: [{ to_name: 'Dr Amara Osei', rel_type: 'works_with', role: 'research assistant', evidence_status: 'confirmed', source_url: `${base}/engineering/ece/people/praman` }],
        sources: [{ url: `${base}/engineering/ece/people/praman`, category: 'official_profile', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' }],
      },
      {
        full_name: 'Dr Lena Fournier',
        official_title: 'Professor',
        role_category: 'professor',
        profile_url: `${base}/engineering/ece/people/lfournier`,
        email: 'l.fournier@northvale.invalid',
        email_evidence: 'confirmed',
        research_themes: ['Integrated photonics'],
        identity_confidence: 'verified',
        relationships: [],
        sources: [{ url: `${base}/engineering/ece/people/lfournier`, category: 'official_profile', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' }],
      },
    ],
    coverage: {
      pages_checked: [`${base}/engineering/ece/people`, `${base}/engineering/ece/people?page=2`],
      directory_pages: [`${base}/engineering/ece/people`, `${base}/engineering/ece/people?page=2`],
      pagination_handled: true,
      categories: ['Faculty', 'Research staff'],
      inaccessible: [{ url: `${base}/engineering/ece/adjuncts`, reason: 'HTTP 403', status: 'blocked', fetch_method: 'web_fetch' }],
      notes: 'Two directory pages and two categories were traversed. Adjunct list stayed inaccessible.',
    },
    summary: 'Four people recorded, one of them a research assistant rather than an academic rank.',
  };
}

export function sourceMap(personId: string): SourceMapResult {
  return {
    job: 'map_person_sources',
    person_id: personId,
    entries: [
      {
        url: `${base}/engineering/ece/people/aosei`,
        category: 'official_profile',
        discovery_source: 'Department directory',
        identity_confidence: 'verified',
        access_status: 'accessible', fetch_method: 'web_fetch',
        last_attempt_at: '2026-09-10',
        title: 'Dr Amara Osei — Northvale ECE',
      },
      {
        url: 'https://osei-lab.invalid/',
        category: 'lab_page',
        discovery_source: 'Link from official profile',
        identity_confidence: 'verified',
        access_status: 'accessible', fetch_method: 'web_fetch',
        last_attempt_at: '2026-09-10',
        title: 'Northvale Signal Systems Laboratory',
      },
      {
        url: 'https://osei-lab.invalid/prospective-students',
        category: 'recruitment_page',
        discovery_source: 'Lab site navigation',
        identity_confidence: 'verified',
        access_status: 'accessible', fetch_method: 'web_fetch',
        last_attempt_at: '2026-09-10',
      },
      {
        url: 'https://orcid.invalid/0000-0002-1825-0097',
        category: 'orcid',
        discovery_source: 'ORCID stated on official profile',
        identity_confidence: 'verified',
        access_status: 'accessible', fetch_method: 'web_fetch',
        last_attempt_at: '2026-09-10',
      },
      {
        url: 'https://scholar.invalid/citations?user=EXAMPLE',
        category: 'scholar',
        discovery_source: 'Search',
        identity_confidence: 'uncertain',
        access_status: 'blocked', fetch_method: 'web_fetch',
        last_attempt_at: '2026-09-10',
        note: 'The fictional Scholar mirror returned a challenge page. It was not inspected.',
      },
      {
        url: 'https://doi.invalid/10.5555/northvale.2025.114',
        category: 'publisher',
        discovery_source: 'ORCID works list',
        identity_confidence: 'verified',
        access_status: 'accessible', fetch_method: 'web_fetch',
        last_attempt_at: '2026-09-10',
      },
      {
        url: 'https://doi.invalid/10.5555/northvale.2024.077',
        category: 'publisher',
        discovery_source: 'ORCID works list',
        identity_confidence: 'verified',
        access_status: 'auth_required', fetch_method: 'web_fetch',
        last_attempt_at: '2026-09-10',
        note: 'Publisher page requires a subscription; only the abstract is public.',
      },
    ],
    absent_categories: ['cv', 'preprint'],
    blocked: [
      { url: 'https://scholar.invalid/citations?user=EXAMPLE', reason: 'Challenge page; profile not inspected' },
      { url: 'https://doi.invalid/10.5555/northvale.2024.077', reason: 'Full text behind a subscription' },
    ],
    timezone_basis_location: 'Northvale main campus, Fictionland',
    summary: 'Seven destinations mapped. Scholar was blocked and is recorded as such.',
  };
}

export function personResearch(personId: string, options: { programId?: string; researchComplete?: boolean; budgetExhausted?: boolean } = {}): PersonResearchResult {
  return {
    job: 'research_person',
    person_id: personId,
    identity: {
      full_name: 'Dr Amara Osei',
      official_title: 'Associate Professor',
      role_category: 'associate_professor',
      appointments: ['Department of Electrical and Computer Engineering', 'Northvale Institute for Photonic Systems (cross-appointment)'],
      biography:
        'A fictional associate professor working on adaptive signal processing for underwater acoustic sensing, with a cross-appointment to a photonics institute.',
      uncertainties: ['The start date of the cross-appointment is not stated on any page checked.'],
    },
    research: {
      interests: ['Adaptive filtering', 'Underwater acoustic sensing', 'Low-power array processing'],
      methods: ['Simulation', 'Field trials in a fictional harbour testbed'],
      themes: ['Robust estimation under non-stationary noise'],
      synthesis:
        'The group builds adaptive array-processing methods for acoustic sensing where the noise field changes faster than conventional filters assume, and validates them in a fictional harbour testbed.',
    },
    current_activity: {
      projects: [
        {
          name: 'Harbourside acoustic testbed',
          description: 'A fictional multi-year deployment described on the lab site.',
          evidence_status: 'confirmed',
          observed_at: '2026-09-10',
          source_url: 'https://osei-lab.invalid/projects',
        },
      ],
      notes: 'The lab site lists one project as current and two as concluded in 2023.',
    },
    affiliations: {
      lab_ids: [],
      labs: [{ name: 'Northvale Signal Systems Laboratory', url: 'https://osei-lab.invalid/', role: 'Director', status: 'current' }],
      collaborators: [{ name: 'Dr Lena Fournier', note: 'Co-author on the 2025 fictional paper' }],
      students: [
        { full_name: 'Priya Raman', role: 'Research assistant', role_category: 'research_assistant', profile_url: `${base}/engineering/ece/people/praman`, source_url: 'https://osei-lab.invalid/people' },
        { full_name: 'Tomas Bergqvist', role: 'PhD student', role_category: 'graduate_student', source_url: 'https://osei-lab.invalid/people' },
      ],
    },
    supervision: options.programId
      ? [
          {
            program_id: options.programId,
            program_title: 'Master of Applied Science in Electrical and Computer Engineering',
            availability: 'no_public_information',
            checked_at: '2026-09-10',
            source_url: 'https://osei-lab.invalid/prospective-students',
            note: 'The prospective-students page invites enquiries but does not say whether places are available.',
          },
        ]
      : [],
    publications: [
      {
        title: 'Adaptive array processing for non-stationary harbour noise',
        authors: ['Amara Osei', 'Lena Fournier'],
        doi: '10.5555/northvale.2025.114',
        identifiers: {},
        publication_type: 'journal article',
        venue: 'Journal of Fictional Acoustics',
        published_date: '2025-04-12',
        online_date: '2025-03-01',
        links: ['https://doi.invalid/10.5555/northvale.2025.114'],
        accessibility: 'accessible',
        summary_basis: 'full_text',
        summary: {
          research_question: 'Can an adaptive array keep its null steering when the harbour noise field changes within a second?',
          approach: 'A recursive estimator evaluated on simulated and fictional field data.',
          findings: 'The estimator held its null within the stated tolerance across the reported conditions.',
          stated_limitations: 'The authors state the field data covers one season and one site.',
          possible_relevance: 'Directly relevant to the estimation work described in the applicant profile.',
        },
        is_preprint: false,
      },
      {
        title: 'Low-power beamforming for battery-limited sensor arrays',
        authors: ['Amara Osei', 'Ruben Kaltsas'],
        doi: '10.5555/northvale.2024.077',
        identifiers: {},
        publication_type: 'journal article',
        venue: 'Fictional Transactions on Sensing',
        published_date: '2024-11-02',
        links: ['https://doi.invalid/10.5555/northvale.2024.077'],
        accessibility: 'auth_required',
        summary_basis: 'abstract_only',
        summary: {
          abstract_text: 'The abstract states that a reduced-rank beamformer lowers energy per sample on battery-limited arrays.',
          possible_relevance: 'Possibly relevant; the full text was not accessible, so no claim is made about its experiments.',
        },
        is_preprint: false,
      },
      {
        title: 'Preprint: sequential detection under drifting noise',
        authors: ['Amara Osei'],
        identifiers: { arxiv_like: 'FICT-2026-0042' },
        publication_type: 'preprint',
        venue: 'Fictional preprint server',
        preprint_date: '2026-02-20',
        links: ['https://preprints.invalid/FICT-2026-0042'],
        accessibility: 'not_found',
        summary_basis: 'metadata_only',
        is_preprint: true,
      },
    ],
    contact: {
      email: 'a.osei@northvale.invalid',
      email_evidence: 'confirmed',
      preferred_method: 'Departmental email address published on the official profile',
      instructions:
        'The prospective-students page asks applicants to put "MASc enquiry" in the subject line and to attach a one-page CV.',
      required_subject: 'MASc enquiry',
      requested_documents: ['One-page CV'],
      contact_rule: 'email_ok',
      checked_at: '2026-09-10',
      source_url: 'https://osei-lab.invalid/prospective-students',
    },
    location: {
      institutional_location: 'Northvale main campus, Fictionland',
      timezone: 'America/Toronto',
      timezone_basis: 'campus_inferred',
      observed_at: '2026-09-10',
    },
    applicant_connections: {
      connections: ['The applicant profile records estimation coursework that overlaps with the 2025 paper.'],
      gaps: ['The applicant has no field-trial experience recorded.'],
      questions: ['Whether MASc places are available for the Fall intake.'],
    },
    evidence: {
      sources: [
        { url: `${base}/engineering/ece/people/aosei`, category: 'official_profile', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
        { url: 'https://osei-lab.invalid/', category: 'lab_page', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
        { url: 'https://osei-lab.invalid/prospective-students', category: 'recruitment_page', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
        { url: 'https://scholar.invalid/citations?user=EXAMPLE', category: 'scholar', access_status: 'blocked', fetch_method: 'web_fetch', observed_at: '2026-09-10', notes: 'Challenge page; not inspected.' },
      ],
      verification: [{ claim: 'Recipient address', status: 'confirmed', note: 'Matches the official profile page.' }],
      coverage: ['Google Scholar could not be inspected; the bibliography comes from ORCID and publisher pages.'],
      blocked: [{ url: 'https://scholar.invalid/citations?user=EXAMPLE', reason: 'Challenge page' }],
      unresolved: ['Whether the cross-appointment is current.'],
    },
    scope: {
      publication_scope: 'All publications discoverable through ORCID and publisher pages',
      budget_exhausted: options.budgetExhausted ?? false,
      papers_summarised: 2,
    },
    research_complete: options.researchComplete ?? true,
    summary: 'Profile complete with one blocked source recorded.',
  };
}

export function labResearch(unitId?: string): LabResearchResult {
  return {
    job: 'research_lab',
    lab: {
      official_name: 'Northvale Signal Systems Laboratory',
      url: 'https://osei-lab.invalid/',
      unit_ids: unitId ? [unitId] : [],
      themes: ['Adaptive array processing', 'Underwater acoustics'],
      projects: [
        { name: 'Harbourside acoustic testbed', description: 'A fictional multi-year deployment.' },
        { name: 'Reduced-rank beamforming', description: 'Concluded in 2023 according to the lab site.' },
      ],
      facilities: ['Fictional anechoic tank'],
      collaborations: ['Northvale Institute for Photonic Systems'],
      recruitment: {
        text: 'The lab page invites enquiries from prospective MASc students but does not state that funded places exist.',
        observed_at: '2026-09-10',
        source_url: 'https://osei-lab.invalid/prospective-students',
      },
      contact_instructions: 'Enquiries by email with "MASc enquiry" in the subject.',
      location: 'Northvale main campus',
      timezone: 'America/Toronto',
      timezone_basis: 'campus_inferred',
      overview: 'A fictional laboratory directed by Dr Amara Osei.',
    },
    members: [
      { full_name: 'Dr Amara Osei', role: 'Director', role_category: 'associate_professor', status: 'current', is_director: true, profile_url: `${base}/engineering/ece/people/aosei`, source_url: 'https://osei-lab.invalid/people', observed_at: '2026-09-10' },
      { full_name: 'Priya Raman', role: 'Research assistant', role_category: 'research_assistant', status: 'current', is_director: false, profile_url: `${base}/engineering/ece/people/praman`, source_url: 'https://osei-lab.invalid/people', observed_at: '2026-09-10' },
      { full_name: 'Tomas Bergqvist', role: 'PhD student', role_category: 'graduate_student', status: 'current', is_director: false, source_url: 'https://osei-lab.invalid/people', observed_at: '2026-09-10' },
      { full_name: 'Hana Bright', role: 'MASc student', role_category: 'graduate_student', status: 'former', is_director: false, source_url: 'https://osei-lab.invalid/alumni', observed_at: '2026-09-10' },
    ],
    publications: [{ title: 'Adaptive array processing for non-stationary harbour noise', doi: '10.5555/northvale.2025.114' }],
    unavailable_information: ['Current funding sources are not published.'],
    sources: [
      { url: 'https://osei-lab.invalid/', category: 'lab_page', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
      { url: 'https://osei-lab.invalid/people', category: 'lab_page', access_status: 'accessible', fetch_method: 'web_fetch', observed_at: '2026-09-10' },
    ],
    summary: 'Four members recorded, one explicitly identified as a former member.',
  };
}

export function outreachDraft(personId: string, programId: string | null, options: { attachments?: { document_id: string; version?: number }[] } = {}): OutreachDraftResult {
  return {
    job: 'draft_outreach',
    person_id: personId,
    purpose: 'initial_contact',
    program_id: programId,
    campaign: 'default',
    recipient: 'a.osei@northvale.invalid',
    subject: 'MASc enquiry — adaptive array processing',
    body: `Dear Dr Osei,

I am applying to the MASc in Electrical and Computer Engineering at Northvale for the Fall 2027 intake, and I am writing to ask whether you expect to take a MASc student.

I read your 2025 paper on adaptive array processing for non-stationary harbour noise in full. The recursive estimator and its stated single-season limitation are close to the estimation coursework and simulation work described in my profile. I also saw the 2024 beamforming paper, but only its abstract was available to me, so I have not formed a view on its experiments.

I have attached nothing beyond what your prospective-students page requests. If it would help, I can send a one-page CV as your page asks.

Thank you for your time.

Kind regards,
(applicant name from the approved profile)`,
    attachments: options.attachments ?? [],
    contact_requirements: [
      { requirement: 'Subject line must contain "MASc enquiry"', satisfied: 'yes' },
      { requirement: 'Attach a one-page CV', satisfied: 'unknown' },
    ],
    supporting_links: [],
    brief: `## Why this person

Dr Osei's 2025 paper matches the applicant's recorded estimation background.

## Evidence used

- Recipient address: official profile page, checked 2026-09-10, status confirmed.
- Contact instructions: lab prospective-students page, checked 2026-09-10.
- Supervision availability: no public information. The message asks; it does not assert.

## What was deliberately not claimed

- The 2024 paper was abstract-only. The message says so.
- No funded opening is implied anywhere.`,
    timing_note: 'Suggest a weekday morning in America/Toronto. The zone is inferred from the campus location.',
  };
}

export function verification(personId: string, options: { researchComplete?: boolean } = {}): VerificationResult {
  return {
    job: 'verify_person',
    person_id: personId,
    checks: [
      { claim: 'Recipient address a.osei@northvale.invalid', status: 'confirmed', source_url: `${base}/engineering/ece/people/aosei` },
      { claim: 'Subject line requirement "MASc enquiry"', status: 'confirmed', source_url: 'https://osei-lab.invalid/prospective-students' },
      { claim: 'Cross-appointment is current', status: 'unresolved', note: 'No dated statement was found.' },
    ],
    research_complete: options.researchComplete ?? true,
    blocking_issues: [],
    summary: 'Two critical claims confirmed, one left unresolved and recorded.',
  };
}
