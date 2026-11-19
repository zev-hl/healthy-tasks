import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, ChevronLeft, PlayCircle, Upload, Users } from 'lucide-react';
import type { ActiveUserDto, DepartmentDto, DutyDto, DutyHoldingsDto } from '@healthy-tasks/shared';
import { api, ApiError, uploadToStorage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PageBody, PageHeader } from '../components/harbor/PageHeader';
import { Btn, Card, CardHead, Empty } from '../components/harbor/ui';
import { useToast } from '../components/harbor/Toast';
import { RichText } from '../components/RichText';
import { RichTextEditor } from '../components/RichTextEditor';
import { Avatar, userLabel } from '../components/ui/Avatar';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** A link to a video file plays here; any other link opens beside. */
const playsInline = (url: string) => /\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(url);

function useDutyData() {
  const [departments, setDepartments] = useState<DepartmentDto[] | null>(null);
  const [holdings, setHoldings] = useState<DutyHoldingsDto>({});
  const [people, setPeople] = useState<ActiveUserDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      api.listDepartments(),
      api.getDutyHoldings(),
      api.listActiveUsers().catch(() => []),
    ])
      .then(([d, h, p]) => {
        setDepartments(d);
        setHoldings(h);
        setPeople(p);
      })
      .catch((e) => setError(errorText(e, 'Could not load the duties.')));
  }, []);
  return { departments, setDepartments, holdings, people, error };
}

/**
 * A duty's own page (Nov 2026 plan, I4): its department, what it is, its SOP
 * (rich text) and a training video (a link or a file), and who holds it. No
 * default sub-tasks. Admins change the SOP and video here.
 */
export function DutyPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'Admin';
  const { departments, setDepartments, holdings, people, error } = useDutyData();
  const found = useMemo(() => {
    for (const d of departments ?? []) {
      const duty = d.duties.find((x) => x.id === id);
      if (duty) return { dept: d, duty };
    }
    return null;
  }, [departments, id]);
  const holders = people.filter((p) => (holdings[p.id] ?? []).includes(id));

  const [editing, setEditing] = useState(false);
  const [sop, setSop] = useState('');
  const [video, setVideo] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!found?.duty.videoFile) {
      setFileUrl(null);
      return;
    }
    api
      .getDutyVideoUrl(id)
      .then((r) => setFileUrl(r.url))
      .catch(() => setFileUrl(null));
  }, [id, found?.duty.videoFile]);

  if (error)
    return (
      <PageBody>
        <div className="hb-alert">{error}</div>
      </PageBody>
    );
  if (!departments)
    return (
      <PageBody>
        <Empty>Loading…</Empty>
      </PageBody>
    );
  if (!found)
    return (
      <PageBody>
        <Empty>That duty doesn’t exist.</Empty>
      </PageBody>
    );
  const { dept, duty } = found;

  function startEdit(d: DutyDto) {
    setSop(d.sop ?? '');
    setVideo(d.videoUrl ?? '');
    setEditing(true);
  }
  async function save() {
    setBusy(true);
    try {
      setDepartments(
        await api.updateDuty(duty.id, { sop: sop || null, videoUrl: video.trim() || null }),
      );
      setEditing(false);
      toast({ message: 'Saved.', tone: 'success' });
    } catch (e) {
      toast({ message: errorText(e, 'Could not save.'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const meta = { filename: file.name, contentType: file.type, size: file.size };
      const { uploadUrl, storageKey } = await api.presignDutyVideo(duty.id, meta);
      await uploadToStorage(uploadUrl, file);
      await api.setDutyVideo(duty.id, { ...meta, storageKey });
      setDepartments(await api.listDepartments());
      toast({ message: 'Video uploaded.', tone: 'success' });
    } catch (e) {
      toast({ message: errorText(e, 'Could not upload the video.'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function dropFile() {
    setBusy(true);
    try {
      await api.clearDutyVideo(duty.id);
      setDepartments(await api.listDepartments());
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={duty.name}
        subtitle={
          <>
            <span className="hb-dot" style={{ background: dept.color }} aria-hidden="true" />{' '}
            {dept.name}
            {duty.archived ? ' · archived' : ''}
          </>
        }
        actions={
          isAdmin && !editing ? (
            <Btn onClick={() => startEdit(duty)}>Edit SOP and video</Btn>
          ) : undefined
        }
      />
      <PageBody>
        <p className="hb-small">
          <Link to="/duties">
            <ChevronLeft size={14} aria-hidden="true" /> My duties
          </Link>
        </p>
        <div className="hb-duty">
          <div className="hb-col">
            {duty.description && (
              <Card>
                <div className="hb-card-pad">
                  <p className="hb-duty-desc">{duty.description}</p>
                </div>
              </Card>
            )}
            <Card>
              <CardHead icon={<BookOpen size={16} />} title="SOP" />
              <div className="hb-card-pad">
                {editing ? (
                  <RichTextEditor value={sop} onChange={setSop} ariaLabel="SOP" />
                ) : duty.sop ? (
                  <RichText html={duty.sop} />
                ) : (
                  <Empty>No SOP written yet.</Empty>
                )}
              </div>
            </Card>
            {editing && (
              <div className="hb-draft-actions">
                <Btn kind="primary" disabled={busy} onClick={() => void save()}>
                  {busy ? 'Saving…' : 'Save'}
                </Btn>
                <Btn onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Btn>
              </div>
            )}
          </div>
          <div className="hb-col">
            <Card>
              <CardHead icon={<PlayCircle size={16} />} title="Training video" />
              <div className="hb-card-pad hb-duty-video">
                {editing && (
                  <label className="hb-tpl-field">
                    <span className="hb-tpl-flabel">Video link</span>
                    <input
                      className="hb-tpl-input"
                      value={video}
                      placeholder="https://…"
                      onChange={(e) => setVideo(e.target.value)}
                    />
                  </label>
                )}
                {fileUrl ? (
                  <video controls preload="metadata" src={fileUrl} />
                ) : duty.videoUrl && playsInline(duty.videoUrl) ? (
                  <video controls preload="metadata" src={duty.videoUrl} />
                ) : duty.videoUrl ? (
                  <a
                    href={duty.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hb-btn"
                  >
                    <PlayCircle size={15} aria-hidden="true" /> Watch the video
                  </a>
                ) : (
                  !editing && <Empty>No video yet.</Empty>
                )}
                {isAdmin && (
                  <div className="hb-draft-actions">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="video/*"
                      hidden
                      onChange={(e) => {
                        void upload(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <Btn disabled={busy} onClick={() => fileRef.current?.click()}>
                      <Upload size={14} aria-hidden="true" />{' '}
                      {duty.videoFile ? 'Replace the video file' : 'Upload a video file'}
                    </Btn>
                    {duty.videoFile && (
                      <Btn disabled={busy} onClick={() => void dropFile()}>
                        Remove the file
                      </Btn>
                    )}
                  </div>
                )}
              </div>
            </Card>
            <Card>
              <CardHead
                icon={<Users size={16} />}
                title="Who holds it"
                right={<span className="hb-small">{holders.length}</span>}
              />
              {holders.length === 0 ? (
                <Empty>Nobody holds this duty.</Empty>
              ) : (
                holders.map((p) => (
                  <div key={p.id} className="hb-row">
                    <Avatar user={p} px={26} decorative />
                    <span className="hb-name">{userLabel(p)}</span>
                  </div>
                ))
              )}
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

/** My duties (I4): the duties I hold, by department, each opening its page. */
export function MyDutiesPage() {
  const { user } = useAuth();
  const { departments, holdings, error } = useDutyData();
  const mine = new Set(user ? (holdings[user.id] ?? []) : []);
  const groups = (departments ?? [])
    .map((d) => ({ dept: d, duties: d.duties.filter((x) => mine.has(x.id)) }))
    .filter((g) => g.duties.length > 0);
  return (
    <>
      <PageHeader
        title="My duties"
        subtitle="What you look after, with each duty’s SOP and video."
      />
      <PageBody>
        {error && <div className="hb-alert">{error}</div>}
        {!departments ? (
          <Empty>Loading…</Empty>
        ) : groups.length === 0 ? (
          <Empty>You don’t hold any duties yet. Your manager can give you some.</Empty>
        ) : (
          <div className="hb-duty-groups">
            {groups.map(({ dept, duties }) => (
              <Card key={dept.id}>
                <CardHead
                  icon={<span className="hb-dot" style={{ background: dept.color }} />}
                  title={dept.name}
                />
                {duties.map((x) => (
                  <Link key={x.id} to={`/duties/${x.id}`} className="hb-row hov">
                    <span className="hb-stack">
                      <span className="hb-name">{x.name}</span>
                      {x.description && <span className="hb-sub">{x.description}</span>}
                    </span>
                    <span className="hb-small">
                      {[x.sop ? 'SOP' : null, x.videoUrl || x.videoFile ? 'Video' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </Link>
                ))}
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
