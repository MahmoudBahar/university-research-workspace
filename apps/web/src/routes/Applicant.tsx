import { useEffect, useState } from 'react';
import { FileText, FolderLock, UserRound } from 'lucide-react';
import { api, type DocumentRow, type ExtractionSummary } from '../lib/api';
import { useResource } from '../lib/useApi';
import { useToast } from '../lib/toast';
import { CommandHint, DataTable, ErrorBanner, Loading, Markdown, Notice, Panel, Pill } from '../components/ui';

interface ApplicantResponse {
  files: {
    kind: 'profile' | 'style';
    path: string;
    text: string;
    sha256: string;
    revision: number;
    approvedAt: string | null;
    approvedMatchesFile: boolean;
  }[];
  overrides: { name: string; path: string; sha256: string }[];
}

interface DocumentsResponse {
  documents: DocumentRow[];
  facts: { id: string; fact_key: string; fact_value: string; document_id: string | null; version: number | null; page: number | null; verification_status: string; entry_method: string }[];
}

interface ExtractResult {
  status: 'extracted' | 'unavailable' | 'empty';
  method: string;
  detail: string;
  characters: number;
}

type VersionRow = { doc: DocumentRow; version: DocumentRow['versions'][number] };

export default function Applicant() {
  const applicant = useResource<ApplicantResponse>('/api/applicant');
  const documents = useResource<DocumentsResponse>('/api/documents');
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [extractions, setExtractions] = useState<Record<string, ExtractionSummary>>({});
  const [pasting, setPasting] = useState<VersionRow | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pastePages, setPastePages] = useState('');

  useEffect(() => {
    const loaded = applicant.data;
    if (!loaded) return;
    setDrafts((previous) => {
      const next = { ...previous };
      for (const file of loaded.files) if (next[file.kind] === undefined) next[file.kind] = file.text;
      return next;
    });
  }, [applicant.data]);

  const save = async (kind: 'profile' | 'style', expectedSha: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.put<{ revision: number; sha256: string }>(`/api/applicant/${kind}`, {
        text: drafts[kind] ?? '',
        expectedSha,
      });
      setMessage(`Saved ${kind} as revision ${result.revision}. Approve it before an email cites these facts.`);
      applicant.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const approve = async (kind: 'profile' | 'style', sha256: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/api/applicant/${kind}/approve`, { sha256 });
      setMessage(`Approved the current ${kind} revision.`);
      applicant.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const importDocument = async (file: File, kind: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      const base64 = btoa(binary);
      const result = await api.post<{ documentId: string; version: number }>('/api/documents', {
        kind,
        originalFilename: file.name,
        contentBase64: base64,
      });
      toast({ kind: 'ok', message: `Imported ${file.name} as ${result.documentId} version ${result.version}.` });
      documents.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const recordExtraction = (row: VersionRow, result: ExtractResult) => {
    setExtractions((previous) => ({
      ...previous,
      [row.version.id]: { status: result.status, method: result.method, characters: result.characters, detail: result.detail },
    }));
  };

  const extract = async (row: VersionRow) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.post<ExtractResult>(`/api/documents/${row.doc.id}/extract`, { version: row.version.version });
      recordExtraction(row, result);
      toast({ kind: result.status === 'extracted' ? 'ok' : 'warn', title: result.status, message: result.detail });
      documents.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const submitPaste = async () => {
    if (!pasting) return;
    setBusy(true);
    setError(undefined);
    try {
      const pages = pastePages.trim() === '' ? undefined : Number(pastePages);
      const result = await api.post<ExtractResult>(`/api/documents/${pasting.doc.id}/extract`, {
        version: pasting.version.version,
        text: pasteText,
        method: 'manual_paste',
        ...(pages && Number.isFinite(pages) ? { pageCount: pages } : {}),
      });
      recordExtraction(pasting, result);
      toast({ kind: 'ok', message: `Recorded ${result.characters} characters of pasted text for ${pasting.doc.id} v${pasting.version.version}. It stays unverified until you confirm it.` });
      setPasting(null);
      setPasteText('');
      setPastePages('');
      documents.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const verifyFact = async (factId: string, status: 'verified' | 'rejected') => {
    setBusy(true);
    setError(undefined);
    try {
      await api.post(`/api/facts/${factId}/verify`, { status });
      toast({ kind: status === 'verified' ? 'ok' : 'info', message: `Fact ${factId} marked ${status}.` });
      documents.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setBusy(false);
    }
  };

  const extractionFor = (row: VersionRow): ExtractionSummary | null => extractions[row.version.id] ?? row.version.extraction ?? null;

  const versionRows: VersionRow[] = (documents.data?.documents ?? []).flatMap((doc) => doc.versions.map((version) => ({ doc, version })));

  return (
    <>
      <header>
        <h2>Applicant</h2>
        <p className="lede">
          These files start empty. Nothing is imported from anywhere else. An email may only assert facts from an
          approved profile revision.
        </p>
      </header>

      <ErrorBanner error={error} />
      {message ? <Notice kind="ok">{message}</Notice> : null}
      {applicant.loading && !applicant.data ? <Loading what="applicant files" variant="panel" /> : null}

      {(applicant.data?.files ?? []).map((file) => (
        <Panel
          key={file.kind}
          icon={file.kind === 'profile' ? UserRound : FileText}
          title={file.kind === 'profile' ? 'Profile (applicant/profile.md)' : 'Email style (applicant/email-style.md)'}
          actions={
            <Pill tone={file.approvedMatchesFile ? 'ok' : 'warn'}>
              {file.approvedMatchesFile ? `approved r${file.revision}` : file.approvedAt ? 'approved revision is older' : 'not approved'}
            </Pill>
          }
        >
          <div className="field">
            <label htmlFor={`file-${file.kind}`}>Markdown</label>
            <textarea
              id={`file-${file.kind}`}
              rows={14}
              value={drafts[file.kind] ?? ''}
              onChange={(event) => setDrafts((previous) => ({ ...previous, [file.kind]: event.target.value }))}
            />
          </div>
          <div className="button-row">
            <button type="button" onClick={() => save(file.kind, file.sha256)} disabled={busy || drafts[file.kind] === file.text}>
              Save
            </button>
            <button type="button" className="primary" onClick={() => approve(file.kind, file.sha256)} disabled={busy || drafts[file.kind] !== file.text}>
              Approve this exact revision
            </button>
            {drafts[file.kind] !== file.text ? <span className="small muted">Unsaved changes. Save before approving.</span> : null}
          </div>
          <p className="small muted mono">
            {file.path} · sha256 {file.sha256.slice(0, 16)}…
          </p>
        </Panel>
      ))}

      <Panel title="Drafting overrides" hint="applicant/overrides/<university-id>.md, <program-id>.md or <person-id>.md. More specific instructions win.">
        <DataTable
          rows={applicant.data?.overrides ?? []}
          rowKey={(override) => override.name}
          empty="No overrides. Create files under applicant/overrides/ to add university, program or person-specific guidance."
          dense
          columns={[
            { key: 'name', header: 'File', render: (override) => override.name },
            { key: 'path', header: 'Path', render: (override) => <span className="mono small">{override.path}</span> },
          ]}
        />
      </Panel>

      <Panel icon={FolderLock} title="Private documents" hint="Stored under applicant/documents and never placed in the vault. Nothing is uploaded anywhere.">
        <div className="field-row">
          <div className="field">
            <label htmlFor="doc-kind">Document type</label>
            <select id="doc-kind" defaultValue="cv">
              {['cv', 'ielts', 'transcript', 'graduation_certificate', 'publication', 'other'].map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="doc-file">File</label>
            <input
              id="doc-file"
              type="file"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                const kind = (document.getElementById('doc-kind') as HTMLSelectElement | null)?.value ?? 'other';
                if (file) void importDocument(file, kind);
                event.target.value = '';
              }}
            />
          </div>
        </div>
        <p className="small muted">
          PDFs are read by Claude, not by a system tool: run <code>/import-document &lt;path&gt; --kind cv</code> in Claude Code, or paste
          the text yourself below. Either way the text stays unverified until you confirm it against the original.
        </p>

        {documents.loading && !documents.data ? <Loading what="documents" variant="table" /> : null}
        <DataTable
          rows={versionRows}
          rowKey={(row) => row.version.id}
          empty="No documents imported."
          columns={[
            { key: 'id', header: 'Document', render: (row) => <span className="mono small">{row.doc.id}</span> },
            { key: 'kind', header: 'Type', render: (row) => row.doc.kind.replace(/_/g, ' ') },
            { key: 'file', header: 'File', render: (row) => row.version.original_filename },
            { key: 'version', header: 'Version', render: (row) => row.version.version },
            {
              key: 'review',
              header: 'Review',
              render: (row) => <Pill tone={row.version.review_state === 'verified' ? 'ok' : 'default'}>{row.version.review_state.replace(/_/g, ' ')}</Pill>,
            },
            {
              key: 'extraction',
              header: 'Text',
              render: (row) => {
                const extraction = extractionFor(row);
                if (!extraction) return <span className="muted">not extracted</span>;
                return (
                  <Pill tone={extraction.status === 'extracted' ? 'ok' : extraction.status === 'empty' ? 'warn' : 'default'} title={extraction.detail ?? undefined}>
                    {extraction.status === 'extracted' ? `${extraction.method.replace(/_/g, ' ')}${extraction.characters ? ` · ${extraction.characters} chars` : ''}` : extraction.status}
                  </Pill>
                );
              },
            },
            { key: 'hash', header: 'sha256', render: (row) => <span className="mono small">{row.version.sha256.slice(0, 12)}…</span> },
            {
              key: 'actions',
              header: 'Actions',
              render: (row) => (
                <div className="button-row">
                  <a className="button" href={`/api/documents/${row.doc.id}/content?version=${row.version.version}`}>
                    Download
                  </a>
                  <button type="button" onClick={() => extract(row)} disabled={busy}>
                    Extract text
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasting(row);
                      setPasteText('');
                    }}
                    disabled={busy}
                  >
                    Paste text
                  </button>
                </div>
              ),
            },
          ]}
        />
        {versionRows.some((row) => extractionFor(row)?.status === 'unavailable') ? (
          <CommandHint
            command={`/import-document ${versionRows.find((row) => extractionFor(row)?.status === 'unavailable')?.doc.id ?? '<document-id>'}`}
            note="No built-in extractor handles this file type. Claude reads it with its own file tool and records the text with page references for you to verify. The document leaves this machine only while that skill runs."
          />
        ) : null}
      </Panel>

      {pasting ? (
        <Panel
          title={`Paste extracted text for ${pasting.doc.id} v${pasting.version.version}`}
          actions={<button type="button" onClick={() => setPasting(null)}>Cancel</button>}
        >
          <p className="small muted">
            Paste the document's text as you copied it from the original. It is stored as data with the method
            “manual paste”; nothing in it is interpreted, and it stays unverified until you confirm it.
          </p>
          <div className="field">
            <label htmlFor="paste-text">Extracted text</label>
            <textarea id="paste-text" rows={12} value={pasteText} onChange={(event) => setPasteText(event.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 200 }}>
            <label htmlFor="paste-pages">
              Page count <span className="optional">optional</span>
            </label>
            <input id="paste-pages" type="number" min={1} value={pastePages} onChange={(event) => setPastePages(event.target.value)} />
          </div>
          <button type="button" className="primary" onClick={submitPaste} disabled={busy || pasteText.trim().length === 0}>
            Record pasted text
          </button>
        </Panel>
      ) : null}

      <Panel title="Recorded facts" hint="Extracted or entered by hand. Facts stay unverified until you confirm them against the original.">
        <DataTable
          rows={documents.data?.facts ?? []}
          rowKey={(fact) => fact.id}
          empty="No facts recorded."
          dense
          columns={[
            { key: 'key', header: 'Fact', sortValue: (fact) => fact.fact_key, render: (fact) => fact.fact_key },
            { key: 'value', header: 'Value', render: (fact) => fact.fact_value },
            {
              key: 'source',
              header: 'Source',
              render: (fact) => (fact.document_id ? `${fact.document_id} v${fact.version ?? '?'}${fact.page ? ` p${fact.page}` : ''}` : '—'),
            },
            { key: 'method', header: 'Entered', render: (fact) => fact.entry_method },
            {
              key: 'status',
              header: 'Status',
              sortValue: (fact) => fact.verification_status,
              render: (fact) => (
                <Pill tone={fact.verification_status === 'verified' ? 'ok' : fact.verification_status === 'rejected' ? 'danger' : 'warn'}>
                  {fact.verification_status}
                </Pill>
              ),
            },
            {
              key: 'verify',
              header: '',
              render: (fact) => (
                <div className="button-row">
                  <button type="button" disabled={busy || fact.verification_status === 'verified'} onClick={() => verifyFact(fact.id, 'verified')}>
                    Mark verified
                  </button>
                  <button type="button" className="danger" disabled={busy || fact.verification_status === 'rejected'} onClick={() => verifyFact(fact.id, 'rejected')}>
                    Reject
                  </button>
                </div>
              ),
            },
          ]}
        />
      </Panel>

      {applicant.data?.files.find((file) => file.kind === 'profile') ? (
        <Panel title="Profile preview">
          <Markdown text={applicant.data.files.find((file) => file.kind === 'profile')?.text ?? ''} />
        </Panel>
      ) : null}
    </>
  );
}
