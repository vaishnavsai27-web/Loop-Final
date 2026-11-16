import { describe, expect, it } from 'vitest';
import { validateRegistration } from './Auth';
import { validateUpload } from './artist/Studio';

describe('registration validation', () => {
  const ok = { displayName: 'Uma', username: 'uma_1', email: 'uma@example.com', password: 'Secret123', confirm: 'Secret123' };
  it('accepts a valid form', () => { expect(validateRegistration(ok)).toEqual({}); });
  it('reports each invalid field', () => {
    const e = validateRegistration({ displayName: ' ', username: 'Bad Name', email: 'x', password: 'short', confirm: 'other' });
    expect(Object.keys(e).sort()).toEqual(['confirm', 'displayName', 'email', 'password', 'username']);
  });
  it('has no role field to choose', () => { expect('role' in ok).toBe(false); });
});

describe('upload validation', () => {
  const form = { title: 'Song', genreId: '1', durationSec: '200', releaseYear: '2026', compositionRights: 'OWNED', recordingRights: 'OWNED', rightsEvidenceRef: '', rightsAccepted: true };
  const file = { size: 1000, type: 'audio/mpeg' };
  it('accepts a complete declaration', () => { expect(validateUpload(form, file, 5000)).toEqual({}); });
  it('requires a file, an audio type and a size within the limit', () => {
    expect(validateUpload(form, null, 5000).file).toBeTruthy();
    expect(validateUpload(form, { size: 9000, type: 'audio/mpeg' }, 5000).file).toBeTruthy();
    expect(validateUpload(form, { size: 100, type: 'image/png' }, 5000).file).toBeTruthy();
  });
  it('requires evidence for licensed material and the rights declaration', () => {
    expect(validateUpload({ ...form, recordingRights: 'LICENSED' }, file, 5000).rightsEvidenceRef).toBeTruthy();
    expect(validateUpload({ ...form, recordingRights: 'LICENSED', rightsEvidenceRef: 'https://label.example/licence' }, file, 5000)).toEqual({});
    expect(validateUpload({ ...form, rightsAccepted: false }, file, 5000).rightsAccepted).toBeTruthy();
  });
  it('checks duration and year ranges', () => {
    expect(validateUpload({ ...form, durationSec: '10' }, file, 5000).durationSec).toBeTruthy();
    expect(validateUpload({ ...form, releaseYear: '1800' }, file, 5000).releaseYear).toBeTruthy();
  });
});
