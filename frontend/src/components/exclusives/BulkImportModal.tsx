/**
 * Bulk import & replace (HLAI-71 Chunk 8d).
 *
 * A .csv of ASINs, checked against the seller account, previewed in the four
 * columns of the agreed design — what is new, what is already here, what will
 * be dropped, and what is not the seller's — and only then applied.
 *
 * The sheet has two columns and no headings: the ASIN, then the marketplace
 * (US or CA). It is read in the browser; only the codes are sent. Checking
 * happens in batches so the progress bar reflects real progress.
 */
import { useState } from 'react';
import { type ExclusivesLookupResultDto, type ExclusivesMarketplace } from '@healthy-tasks/shared';
import { api, ApiError } from '../../api/client';
import { Flag } from './Flag';

/** How many codes go to the server at a time. One batch, one bar step. */
export const IMPORT_BATCH = 100;

const ASIN_SHAPE = /^[A-Z0-9]{10}$/;

/** What the sheet's second column may say for each marketplace. */
const MARKETPLACE_WORDS: Record<string, ExclusivesMarketplace> = {
  US: 'USA',
  USA: 'USA',
  'UNITED STATES': 'USA',
  CA: 'Canada',
  CAN: 'Canada',
  CANADA: 'Canada',
};

export interface SheetRow {
  asin: string;
  marketplace: ExclusivesMarketplace;
}

export interface ImportRow extends SheetRow {
  title: string | null;
  /** Set when another group watches it; importing moves it here. */
  ownerId: number | null;
  ownerName: string | null;
}

export interface ImportPreview {
  /** On the account, not in this group yet. */
  added: ImportRow[];
  /** In the sheet and already in this group — untouched. */
  kept: ImportRow[];
  /** In this group but missing from the sheet — these go. */
  dropped: SheetRow[];
  /** In the sheet but not the seller's, or a line we could not read. */
  notYours: { asin: string; marketplace?: ExclusivesMarketplace; reason: string }[];
  /** Amazon did not answer. Temporary, and it blocks the import. */
  unavailable: string[];
}

const key = (r: { asin: string; marketplace: string }) => `${r.marketplace}:${r.asin}`;

/**
 * Read the two-column sheet: ASIN, then marketplace. No headings are expected,
 * though one is skipped if a sheet happens to carry it. Anything unreadable is
 * returned separately rather than silently dropped.
 */
export function parseSheet(text: string): {
  rows: SheetRow[];
  bad: { line: string; why: string }[];
} {
  const rows: SheetRow[] = [];
  const bad: { line: string; why: string }[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const cells = line.split(/[,;\t]/).map((c) => c.replace(/["']/g, '').trim());
    const asin = (cells[0] ?? '').toUpperCase();
    const where = (cells[1] ?? '').toUpperCase();
    if (asin === 'ASIN') continue; // a heading, if one slipped in

    if (!ASIN_SHAPE.test(asin)) {
      bad.push({ line, why: 'Not a valid ASIN' });
      continue;
    }
    const marketplace = MARKETPLACE_WORDS[where];
    if (!marketplace) {
      bad.push({ line, why: where ? `Unknown marketplace “${cells[1]}”` : 'No marketplace' });
      continue;
    }
    const k = `${marketplace}:${asin}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ asin, marketplace });
  }

  return { rows, bad };
}

/** What the server said about one asked-for row. */
export type Answer =
  | { kind: 'found'; title: string | null; ownerId: number | null; ownerName: string | null }
  | { kind: 'not-listed' }
  | { kind: 'unavailable' };

/** Turn the answers, plus what the group holds today, into the four columns. */
export function buildPreview(
  asked: SheetRow[],
  answers: Map<string, Answer>,
  bad: { line: string; why: string }[],
  current: SheetRow[],
  groupId: number | null,
): ImportPreview {
  const held = new Set(current.map(key));
  const resolved = new Set<string>();
  const preview: ImportPreview = {
    added: [],
    kept: [],
    dropped: [],
    notYours: bad.map((b) => ({ asin: b.line, reason: b.why })),
    unavailable: [],
  };

  for (const row of asked) {
    const answer = answers.get(key(row));
    if (!answer || answer.kind === 'unavailable') {
      preview.unavailable.push(row.asin);
      continue;
    }
    if (answer.kind === 'not-listed') {
      preview.notYours.push({
        asin: row.asin,
        marketplace: row.marketplace,
        reason: 'Not on the seller account',
      });
      continue;
    }
    const entry: ImportRow = { ...row, title: answer.title, ...ownerOf(answer, groupId) };
    resolved.add(key(row));
    if (held.has(key(row))) preview.kept.push(entry);
    else preview.added.push(entry);
  }

  preview.dropped = current.filter((r) => !resolved.has(key(r)));
  return preview;
}

function ownerOf(
  answer: Extract<Answer, { kind: 'found' }>,
  groupId: number | null,
): { ownerId: number | null; ownerName: string | null } {
  const elsewhere = answer.ownerId !== null && answer.ownerId !== groupId;
  return {
    ownerId: elsewhere ? answer.ownerId : null,
    ownerName: elsewhere ? answer.ownerName : null,
  };
}

/** Fold one marketplace's lookup answers into the map, for the rows we asked about. */
function collect(
  results: ExclusivesLookupResultDto[],
  marketplace: ExclusivesMarketplace,
  into: Map<string, Answer>,
): void {
  for (const result of results) {
    const k = `${marketplace}:${result.asin}`;
    if (result.status === 'unavailable') {
      into.set(k, { kind: 'unavailable' });
      continue;
    }
    const listing = result.listings.find((l) => l.marketplace === marketplace);
    into.set(
      k,
      listing
        ? {
            kind: 'found',
            title: listing.title,
            ownerId: listing.groupId,
            ownerName: listing.groupName,
          }
        : { kind: 'not-listed' },
    );
  }
}

type Stage = 'input' | 'checking' | 'review';

export function BulkImportModal({
  groupId,
  current,
  onCancel,
  onImport,
}: {
  groupId: number | null;
  current: SheetRow[];
  onCancel: () => void;
  onImport: (rows: ImportRow[]) => void;
}) {
  const [stage, setStage] = useState<Stage>('input');
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function chooseFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a .csv file.');
      setFileName(null);
      setText('');
      return;
    }
    setError(null);
    setFileName(file.name);
    setText(await file.text());
  }

  async function check() {
    const { rows: asked, bad } = parseSheet(text);
    if (asked.length === 0 && bad.length === 0) {
      setError('That file is empty. Each row should be an ASIN, then US or CA.');
      return;
    }

    setStage('checking');
    setProgress(0);
    setError(null);
    try {
      const answers = new Map<string, Answer>();
      const byMarketplace = new Map<ExclusivesMarketplace, string[]>();
      for (const row of asked) {
        const list = byMarketplace.get(row.marketplace) ?? [];
        list.push(row.asin);
        byMarketplace.set(row.marketplace, list);
      }

      let done = 0;
      for (const [marketplace, asins] of byMarketplace) {
        for (let i = 0; i < asins.length; i += IMPORT_BATCH) {
          const batch = asins.slice(i, i + IMPORT_BATCH);
          const res = await api.lookupExclusivesAsins({
            asins: batch,
            marketplaces: [marketplace],
          });
          collect(res.results, marketplace, answers);
          done += batch.length;
          setProgress(Math.round((done / asked.length) * 100));
        }
      }
      setPreview(buildPreview(asked, answers, bad, current, groupId));
      setStage('review');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check these ASINs.');
      setStage('input');
    }
  }

  const blocked = (preview?.unavailable.length ?? 0) > 0;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal exc-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exc-import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="exc-confirm-title" id="exc-import-title">
          Bulk import &amp; replace
        </h2>

        {error && <div className="alert error">{error}</div>}

        {stage === 'input' && (
          <div className="exc-import-choose">
            <label className="exc-import-file-btn" htmlFor="exc-import-file">
              Choose a .csv file
            </label>
            <input
              id="exc-import-file"
              type="file"
              accept=".csv,text/csv"
              className="exc-import-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void chooseFile(file);
              }}
            />
            <p className="muted exc-import-hint">
              Click the button above to upload your file.
            </p>
            {fileName && <p className="mono exc-import-file-name">{fileName}</p>}
          </div>
        )}

        {stage === 'checking' && (
          <div className="exc-import-progress">
            <p className="muted">Checking these ASINs against the seller account…</p>
            <div
              className="exc-progress"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="exc-progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <span className="mono muted">{progress}%</span>
          </div>
        )}

        {stage === 'review' && preview && (
          <>
            {blocked && (
              <div className="alert error">
                Amazon did not answer for {preview.unavailable.length} ASIN
                {preview.unavailable.length === 1 ? '' : 's'}. Importing now would drop products for
                no reason — try again in a moment.
              </div>
            )}
            <div className="exc-import-cols">
              <ImportColumn title="New ASINs for this group" rows={preview.added} />
              <ImportColumn title="Existing ASINs for this group" rows={preview.kept} />
              <ImportColumn
                title="ASINs that will be dropped from this group"
                rows={preview.dropped}
                tone="danger"
              />
              <ImportColumn
                title="Not listed on amazon as yours"
                rows={preview.notYours.map((n) => ({
                  asin: n.asin,
                  marketplace: n.marketplace,
                  note: n.reason,
                }))}
              />
            </div>
            <p className="exc-import-foot">
              This will replace the group list only with the imported ASINs listed as yours on
              Amazon.
            </p>
          </>
        )}

        <div className="exc-confirm-foot">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          {stage === 'review' ? (
            <button
              type="button"
              disabled={blocked}
              onClick={() => onImport([...(preview?.added ?? []), ...(preview?.kept ?? [])])}
            >
              Import
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void check()}
              disabled={stage === 'checking' || !text}
            >
              {stage === 'checking' ? 'Checking…' : 'Check ASINs'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportColumn({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: {
    asin: string;
    marketplace?: ExclusivesMarketplace;
    ownerName?: string | null;
    note?: string;
  }[];
  tone?: 'danger';
}) {
  return (
    <div className={`exc-import-col${tone ? ` ${tone}` : ''}`}>
      <div className="exc-import-col-head">
        <span>{title}</span>
        <span className="mono muted">{rows.length}</span>
      </div>
      <div className="exc-import-col-body">
        {rows.length === 0 ? (
          <span className="muted">None</span>
        ) : (
          rows.map((r, i) => (
            <div className="exc-import-row" key={`${r.asin}-${r.marketplace ?? ''}-${i}`}>
              {r.marketplace && <Flag platform={r.marketplace} />}
              <span className="mono">{r.asin}</span>
              {r.ownerName && <span className="exc-log-detail">moving from “{r.ownerName}”</span>}
              {r.note && <span className="exc-log-detail">{r.note}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
