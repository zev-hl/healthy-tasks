import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Lock, Mic, MonitorPlay } from 'lucide-react';
import {
  FILE_KINDS,
  FILE_KIND_LABELS,
  type ActiveUserDto,
  type DepartmentDto,
  type FileCabinetItemDto,
  type FileKind,
} from '@healthy-tasks/shared';
import { api, ApiError } from '../api/client';
import { humanSize } from '../lib/attachmentFile';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Select, type SelectOption } from '../components/harbor/Select';
import { Btn, Card, Empty } from '../components/harbor/ui';
import { useToast } from '../components/harbor/Toast';
import { FileTile } from '../components/ui/FileTile';
import { Avatar, userLabel } from '../components/ui/Avatar';

const ALL = 'all';
type When = 'all' | '7' | '30' | 'year';
const WHEN: SelectOption<When>[] = [
  { value: 'all', label: 'Any time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'year', label: 'This year' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fromFor(w: When): string | undefined {
  const d = new Date();
  if (w === '7' || w === '30') {
    d.setDate(d.getDate() - Number(w) + 1);
    return ymd(d);
  }
  if (w === 'year') return `${d.getFullYear()}-01-01`;
  return undefined;
}
const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * The file cabinet (Nov 2026 plan, I3): every file on a task or in a comment
 * you may see — the same rule as the tasks — in one list, newest first, with
 * search (names, voice-note transcripts, task names) and filters. Each opens
 * from here and links to its task.
 */
export function FilesPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FileKind | typeof ALL>(ALL);
  const [dept, setDept] = useState<string>(ALL);
  const [who, setWho] = useState<string>(ALL);
  const [period, setPeriod] = useState<When>('all');
  const [files, setFiles] = useState<FileCabinetItemDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [people, setPeople] = useState<ActiveUserDto[]>([]);
  const asked = useRef(0);

  useEffect(() => {
    api.listDepartments().then(setDepartments, () => setDepartments([]));
    api.listActiveUsers().then(setPeople, () => setPeople([]));
  }, []);

  // Typing settles for a moment before it asks the server.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const filters = useMemo(
    () => ({
      q: query || undefined,
      kind: kind === ALL ? undefined : kind,
      departmentId: dept === ALL ? undefined : dept,
      uploadedById: who === ALL ? undefined : who,
      from: fromFor(period),
    }),
    [query, kind, dept, who, period],
  );

  useEffect(() => {
    const n = ++asked.current;
    setFiles(null);
    setError(null);
    api.listFiles(filters).then(
      (p) => {
        if (n !== asked.current) return;
        setFiles(p.files);
        setNext(p.next);
      },
      (e) => {
        if (n !== asked.current) return;
        setError(e instanceof ApiError ? e.message : 'Could not load the files.');
        setFiles([]);
      },
    );
  }, [filters]);

  async function loadMore() {
    if (!next) return;
    setMore(true);
    try {
      const p = await api.listFiles({ ...filters, cursor: next });
      setFiles((f) => [...(f ?? []), ...p.files]);
      setNext(p.next);
    } catch (e) {
      toast({ message: e instanceof ApiError ? e.message : 'Could not load more.', tone: 'error' });
    } finally {
      setMore(false);
    }
  }

  async function open(f: FileCabinetItemDto) {
    // Opened at once, filled in when the link comes back: a window opened
    // after an await is often blocked.
    const w = window.open('', '_blank');
    try {
      const { url } = await api.getAttachmentDownloadUrl(f.id);
      if (w) w.location.href = url;
      else window.location.href = url;
    } catch (e) {
      w?.close();
      toast({
        message: e instanceof ApiError ? e.message : 'Could not open the file.',
        tone: 'error',
      });
    }
  }

  const filtered = !!filters.q || kind !== ALL || dept !== ALL || who !== ALL || period !== 'all';
  const kindOptions: SelectOption<FileKind | typeof ALL>[] = [
    { value: ALL, label: 'All kinds' },
    ...FILE_KINDS.map((k) => ({ value: k, label: FILE_KIND_LABELS[k] })),
  ];
  const deptOptions: SelectOption<string>[] = [
    { value: ALL, label: 'All departments' },
    ...departments
      .filter((d) => !d.archived)
      .map((d) => ({ value: d.id, label: d.name, dot: d.color })),
  ];
  const whoOptions: SelectOption<string>[] = [
    { value: ALL, label: 'Anyone' },
    ...[...people]
      .sort((a, b) => userLabel(a).localeCompare(userLabel(b)))
      .map((p) => ({
        value: p.id,
        label: userLabel(p),
        lead: <Avatar user={p} px={22} decorative />,
      })),
  ];

  return (
    <>
      <PageHeader
        title="Files"
        subtitle="Every file on tasks and in comments that you can see."
        searchPlaceholder="Search file names, voice notes, tasks"
        searchLabel="Search files"
        searchValue={q}
        onSearchChange={setQ}
        newTask={false}
      />
      <PageBody>
        <div className="hb-toolbar">
          <Select
            variant="chip"
            label="Kind"
            value={kind}
            options={kindOptions}
            active={kind !== ALL}
            onChange={setKind}
          />
          <Select
            variant="chip"
            label="Department"
            value={dept}
            options={deptOptions}
            active={dept !== ALL}
            onChange={setDept}
            searchPlaceholder="Search departments…"
          />
          <Select
            variant="chip"
            label="Uploaded by"
            value={who}
            options={whoOptions}
            active={who !== ALL}
            onChange={setWho}
            searchPlaceholder="Search people…"
          />
          <Select
            variant="chip"
            label="When"
            value={period}
            options={WHEN}
            active={period !== 'all'}
            onChange={setPeriod}
          />
          {filtered && (
            <Btn
              kind="link"
              onClick={() => {
                setQ('');
                setKind(ALL);
                setDept(ALL);
                setWho(ALL);
                setPeriod('all');
              }}
            >
              Reset
            </Btn>
          )}
        </div>
        {error && (
          <div className="hb-alert" role="alert">
            {error}
          </div>
        )}
        <Card>
          {files === null ? (
            <Empty>Loading…</Empty>
          ) : files.length === 0 ? (
            <Empty>{filtered ? 'No files match.' : 'No files yet.'}</Empty>
          ) : (
            <ul className="hb-files" aria-label="Files">
              {files.map((f) => (
                <li key={f.id} className="hb-files-row">
                  {f.recording ? (
                    <span className="hb-filetile kind-other" aria-hidden="true">
                      {f.recording === 'voice' ? <Mic size={15} /> : <MonitorPlay size={15} />}
                    </span>
                  ) : (
                    <FileTile contentType={f.contentType} filename={f.filename} />
                  )}
                  <span className="hb-stack hb-files-main">
                    <button type="button" className="hb-files-name" onClick={() => void open(f)}>
                      {f.recording === 'voice'
                        ? 'Voice note'
                        : f.recording === 'screen'
                          ? 'Screen recording'
                          : f.filename}
                      <ExternalLink size={12} aria-hidden="true" />
                    </button>
                    <span className="hb-sub">
                      {f.on === 'comment' ? 'In a comment on ' : 'On '}
                      <Link to={`/tasks/${f.task.id}`}>
                        #{f.task.id} {f.task.name}
                      </Link>
                      {f.task.isPrivate && (
                        <Lock size={11} aria-label="Private task" className="hb-files-lock" />
                      )}
                      {f.department && (
                        <>
                          {' · '}
                          <span
                            className="hb-dot"
                            style={{ background: f.department.color }}
                            aria-hidden="true"
                          />{' '}
                          {f.department.name}
                        </>
                      )}
                    </span>
                    {f.transcript && <span className="hb-files-transcript">“{f.transcript}”</span>}
                  </span>
                  <span className="hb-files-who">
                    <Avatar user={f.uploadedBy} px={22} decorative />
                    {userLabel(f.uploadedBy)}
                  </span>
                  <span className="hb-small hb-files-meta">
                    {when(f.createdAt)} · {humanSize(f.size)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {next && (
          <div className="hb-files-more">
            <Btn onClick={() => void loadMore()} disabled={more}>
              {more ? 'Loading…' : 'Show more'}
            </Btn>
          </div>
        )}
      </PageBody>
    </>
  );
}
