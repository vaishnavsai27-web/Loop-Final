import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { Link, useRouter } from '../../lib/router';
import { useToast } from '../../lib/toast';
import { bytes, relativeDate, plural } from '../../lib/format';
import { Empty, ErrorState, Field, Loading, PageHead, StatusBadge } from '../../components/ui';

const OPEN = ['UPLOADING', 'QUARANTINED', 'PROCESSING', 'PENDING_REVIEW', 'APPROVED'];
const STATUS_HELP = {
  UPLOADING: 'Waiting for the audio file.',
  QUARANTINED: 'Received and held privately until it is scanned.',
  PROCESSING: 'Being checked for malware and audio format.',
  PENDING_REVIEW: 'Checked; waiting for an Admin to review the rights declaration.',
  APPROVED: 'Approved; waiting for an Admin to publish it.',
  PUBLISHED: 'Live on LOOP.',
  REJECTED: 'Not accepted. See the reviewer’s note.',
  TAKEN_DOWN: 'Withdrawn or taken down. Nobody can play it.',
  PROCESSING_FAILED: 'The file could not be processed. Upload it again.',
};

/** The Artist studio. Every action is checked again on the server (artist.studio / artist.upload). */
export default function Studio({ section = 'overview' }) {
  const studio = useAsync(() => api.artistMe(), []);
  if (studio.loading && !studio.data) return <Loading label="Loading your studio" />;
  if (studio.error) return <div className="page"><ErrorState error={studio.error} onRetry={studio.reload} /></div>;
  const data = studio.data;
  const props = { data, reload: studio.reload };
  return (
    <div className="page">
      {section === 'overview' && <Overview {...props} />}
      {section === 'profile' && <ArtistProfile {...props} />}
      {section === 'upload' && <Upload {...props} />}
      {section === 'submissions' && <Submissions {...props} />}
      {section === 'rights' && <Rights {...props} />}
    </div>
  );
}

function Overview({ data }) {
  const open = data.uploads.filter((u) => OPEN.includes(u.status)).length;
  const live = data.uploads.filter((u) => u.status === 'PUBLISHED').length;
  return (
    <>
      <PageHead title={data.artists[0]?.name || 'Your studio'}>
        Publish your own or properly licensed recordings. Every upload is scanned and reviewed by an Admin before anyone can hear it.
      </PageHead>
      <div className="stats">
        <Link className="stat" to="/studio/submissions"><b>{live}</b><span>Published recordings</span></Link>
        <Link className="stat" to="/studio/submissions"><b>{open}</b><span>In review</span></Link>
        <Link className="stat" to="/studio/profile"><b>{data.artists.length}</b><span>{data.artists.length === 1 ? 'Artist profile' : 'Artist profiles'}</span></Link>
      </div>
      {!data.uploadsEnabled && <div className="notice notice-warn"><strong>Uploads are paused on this deployment.</strong><span>{data.uploadsDisabledReason}</span></div>}
      <div className="composer-actions">
        <Link className="btn btn-primary" to="/studio/upload">Upload a recording</Link>
        <Link className="btn" to="/studio/profile">Edit artist profile</Link>
      </div>
    </>
  );
}

function ArtistProfile({ data, reload }) {
  const toast = useToast();
  const [artistId, setArtistId] = useState(data.artists[0]?.id);
  const artist = data.artists.find((a) => a.id === artistId);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (artist) setForm({ name: artist.name, artistType: artist.type, bio: artist.bio || '' }); }, [artist]);
  if (!artist) return <Empty title="No artist profile is linked to your account">An Admin links a profile when your application is approved.</Empty>;
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { await api.updateArtistProfile(artist.id, { name: form.name.trim(), artistType: form.artistType, bio: form.bio }); toast('Artist profile saved'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title="Artist profile">This is what listeners see on your artist page.</PageHead>
      {data.artists.length > 1 && (
        <Field label="Profile"><select className="select" value={artistId} onChange={(e) => setArtistId(Number(e.target.value))}>{data.artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      )}
      {form && (
        <form className="form" onSubmit={save} style={{ maxWidth: 560 }}>
          <Field label="Artist name"><input className="input" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Type">
            <select className="select" value={form.artistType} onChange={(e) => setForm({ ...form, artistType: e.target.value })}>
              <option value="SOLO">Solo artist</option><option value="GROUP">Band or group</option><option value="COMPOSER">Composer</option><option value="ORCHESTRA">Ensemble or orchestra</option>
            </select>
          </Field>
          <Field label="Bio" hint="up to 400 characters"><textarea className="textarea" maxLength={400} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></Field>
          <div className="composer-actions">
            <button className="btn btn-primary" disabled={busy || !form.name.trim()}>Save profile</button>
            <Link to={`/artist/${artist.id}`} className="small">View public page</Link>
          </div>
        </form>
      )}
    </>
  );
}

const BLANK = { title: '', versionLabel: '', genreId: '', languageId: '', durationSec: '', releaseYear: String(new Date().getFullYear()),
  explicit: false, compositionRights: 'OWNED', recordingRights: 'OWNED', rightsEvidenceRef: '', rightsAccepted: false };

export function validateUpload(form, file, maxBytes) {
  const e = {};
  if (!form.title.trim()) e.title = 'Enter the recording title.';
  if (!form.genreId) e.genreId = 'Choose a genre.';
  const d = Number(form.durationSec);
  if (!Number.isInteger(d) || d < 30 || d > 1800) e.durationSec = 'Duration must be between 30 and 1800 seconds.';
  const y = Number(form.releaseYear);
  if (!Number.isInteger(y) || y < 1900 || y > 2100) e.releaseYear = 'Enter a year between 1900 and 2100.';
  if (!file) e.file = 'Choose an audio file.';
  else if (file.size > maxBytes) e.file = `The file is larger than ${bytes(maxBytes)}.`;
  else if (file.type && !file.type.startsWith('audio/')) e.file = 'Choose an audio file (MP3, WAV, FLAC, OGG or M4A).';
  const licensed = form.compositionRights === 'LICENSED' || form.recordingRights === 'LICENSED';
  if (licensed && !/^https:\/\/.{5,}/i.test(form.rightsEvidenceRef)) e.rightsEvidenceRef = 'Licensed material needs an https:// link to the licence or permission.';
  if (!form.rightsAccepted) e.rightsAccepted = 'Confirm that you have the rights to publish this recording.';
  return e;
}

function Upload({ data, reload }) {
  const toast = useToast();
  const { navigate } = useRouter();
  const genres = useAsync(() => api.genres(), []);
  const languages = useAsync(() => api.languages(), []);
  const [form, setForm] = useState(BLANK);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const artist = data.artists[0];
  const disabled = !data.uploadsEnabled || !artist;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const v = validateUpload(form, file, data.maxUploadBytes);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const intent = await api.createUpload({
        artistId: artist.id, title: form.title.trim(), versionLabel: form.versionLabel.trim(), genreId: Number(form.genreId),
        ...(form.languageId ? { languageId: Number(form.languageId) } : {}), durationSec: Number(form.durationSec), releaseYear: Number(form.releaseYear),
        explicit: form.explicit, fileSize: file.size, mimeType: file.type || 'application/octet-stream',
        compositionRights: form.compositionRights, recordingRights: form.recordingRights,
        ...(form.rightsEvidenceRef ? { rightsEvidenceRef: form.rightsEvidenceRef } : {}), rightsAccepted: true,
      });
      await api.uploadContent(intent.id, file);
      toast('Recording received. It stays private until it is scanned and reviewed.');
      reload();
      navigate('/studio/submissions');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }
  const fe = (k) => ({ error: errors[k], errorId: `upload-${k}-error` });

  return (
    <>
      <PageHead title="Upload a recording">Only upload music you own or are licensed to publish. It stays private until an Admin approves and publishes it.</PageHead>
      {!data.uploadsEnabled && <div className="notice notice-warn" role="status"><strong>Uploads are paused on this deployment.</strong><span>{data.uploadsDisabledReason}</span></div>}
      <form className="form" onSubmit={submit} noValidate style={{ maxWidth: 640 }}>
        <fieldset disabled={disabled || busy} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--s4)' }}>
          <div className="form-row">
            <Field label="Title" {...fe('title')}><input className="input" maxLength={150} value={form.title} onChange={set('title')} aria-invalid={!!errors.title || undefined} /></Field>
            <Field label="Version" hint="optional, e.g. Acoustic"><input className="input" maxLength={40} value={form.versionLabel} onChange={set('versionLabel')} /></Field>
          </div>
          <div className="form-row">
            <Field label="Genre" {...fe('genreId')}>
              <select className="select" value={form.genreId} onChange={set('genreId')} aria-invalid={!!errors.genreId || undefined}>
                <option value="">Choose…</option>{(genres.data || []).map((g) => <option key={g.id} value={g.id}>{g.path || g.name}</option>)}
              </select></Field>
            <Field label="Language" hint="optional">
              <select className="select" value={form.languageId} onChange={set('languageId')}>
                <option value="">Instrumental or none</option>{(languages.data || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label="Duration in seconds" {...fe('durationSec')}><input className="input" inputMode="numeric" value={form.durationSec} onChange={set('durationSec')} aria-invalid={!!errors.durationSec || undefined} /></Field>
            <Field label="Release year" {...fe('releaseYear')}><input className="input" inputMode="numeric" value={form.releaseYear} onChange={set('releaseYear')} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={form.explicit} onChange={set('explicit')} />Contains explicit content</label>
          <Field label="Audio file" hint={`MP3, WAV, FLAC, OGG or M4A, up to ${bytes(data.maxUploadBytes)}`} {...fe('file')}>
            <input className="input" type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] || null)} aria-invalid={!!errors.file || undefined} /></Field>
          <div className="form-row">
            <Field label="Composition rights">
              <select className="select" value={form.compositionRights} onChange={set('compositionRights')}>
                <option value="OWNED">I wrote it / own it</option><option value="LICENSED">Licensed to me</option><option value="PUBLIC_DOMAIN">Public domain</option>
              </select>
            </Field>
            <Field label="Recording rights">
              <select className="select" value={form.recordingRights} onChange={set('recordingRights')}>
                <option value="OWNED">I recorded it / own it</option><option value="LICENSED">Licensed to me</option><option value="PUBLIC_DOMAIN">Public domain</option>
              </select>
            </Field>
          </div>
          <Field label="Licence or permission link" hint="required for licensed material" {...fe('rightsEvidenceRef')}><input className="input" type="url" value={form.rightsEvidenceRef} onChange={set('rightsEvidenceRef')} /></Field>
          <label className="check"><input type="checkbox" checked={form.rightsAccepted} onChange={set('rightsAccepted')} />
            <span>I own or am licensed to publish this recording and its composition on LOOP, under terms {data.termsVersion}.</span></label>
          {errors.rightsAccepted && <span className="field-error" id="upload-rightsAccepted-error">{errors.rightsAccepted}</span>}
          <div><button className="btn btn-primary" type="submit">{busy ? 'Uploading…' : 'Upload recording'}</button></div>
        </fieldset>
      </form>
    </>
  );
}

function Submissions({ data, reload }) {
  const toast = useToast();
  async function withdraw(id) {
    try { await api.withdrawUpload(id); toast('Recording withdrawn. Nobody can play it now.'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  }
  return (
    <>
      <PageHead title="My submissions">{plural(data.uploads.length, 'recording')} sent to LOOP.</PageHead>
      {data.uploads.length === 0 ? <Empty title="Nothing uploaded yet" action={<Link className="btn btn-primary" to="/studio/upload">Upload a recording</Link>} /> : (
        <ul className="list">
          {data.uploads.map((u) => (
            <li key={u.id} className="list-item">
              <div className="list-item-main">
                <span className="title">{u.title}</span>
                <span className="small muted">{STATUS_HELP[u.status] || ''} Sent {relativeDate(u.createdAt)}{u.fileSize ? `, ${bytes(u.fileSize)}` : ''}.</span>
                {u.reviewNote && <span className="small">Reviewer: “{u.reviewNote}”</span>}
              </div>
              <div className="row-actions">
                <StatusBadge status={u.status} />
                {!['REJECTED', 'TAKEN_DOWN'].includes(u.status) && <button type="button" className="btn btn-sm btn-danger" onClick={() => withdraw(u.id)}>Withdraw</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Rights({ data }) {
  return (
    <div className="page-narrow" style={{ display: 'grid', gap: 'var(--s5)' }}>
      <PageHead title="Rights">What you agree to when you publish on LOOP (terms {data.termsVersion}).</PageHead>
      <ul style={{ display: 'grid', gap: 'var(--s3)', listStyle: 'disc', paddingLeft: '1.2em', maxWidth: 'var(--measure)' }}>
        <li>You only upload recordings you own, or are licensed to distribute, for both the composition and the recording.</li>
        <li>Licensed material needs a link to the licence or written permission. An Admin checks it before approval.</li>
        <li>Uploads are held privately, scanned for malware and checked as valid audio before review.</li>
        <li>You can’t approve or publish your own recordings. Only an Admin can.</li>
        <li>You can withdraw a recording at any time. Playback stops immediately.</li>
        <li>Anyone can report a recording for a rights problem. Reports are reviewed by an Admin, and a recording can be taken down.</li>
      </ul>
    </div>
  );
}
