import { describe, expect, it } from 'vitest';
import { matchPath } from './router';
import { buildHeaders, qs, readCookie } from './api';
import { bytes, deviceLabel, duration, relativeDate, totalDuration } from './format';
import { aura, hexToRgb, inkOn } from './mood';

describe('router', () => {
  it('matches static and parameter paths', () => {
    expect(matchPath('/discover', '/discover')).toEqual({});
    expect(matchPath('/playlist/:id', '/playlist/42')).toEqual({ id: '42' });
    expect(matchPath('/admin/:section', '/admin/users')).toEqual({ section: 'users' });
    expect(matchPath('/discover', '/discover/')).toEqual({});
  });
  it('does not match different or longer paths', () => {
    expect(matchPath('/playlist/:id', '/playlist')).toBe(null);
    expect(matchPath('/studio', '/studio/upload')).toBe(null);
    expect(matchPath('/admin', '/administrator')).toBe(null);
  });
  it('treats * as a catch-all and rejects malformed escapes', () => {
    expect(matchPath('*', '/anything/here')).toEqual({ '*': 'anything/here' });
    expect(matchPath('/song/:id', '/song/%E0%A4%A')).toBe(null);
  });
});

describe('api helpers', () => {
  it('sends the CSRF token only on state-changing requests', () => {
    const cookies = 'a=1; muse_csrf=tok%3D1; b=2';
    expect(readCookie('muse_csrf', cookies)).toBe('tok=1');
    expect(buildHeaders('GET', false, cookies)['X-CSRF-Token']).toBeUndefined();
    expect(buildHeaders('POST', true, cookies)['X-CSRF-Token']).toBe('tok=1');
    expect(buildHeaders('POST', true, cookies)['Content-Type']).toBe('application/json');
  });
  it('builds query strings without empty values', () => {
    expect(qs({ q: 'rain day', page: 2, empty: '', none: null })).toBe('?q=rain+day&page=2');
    expect(qs({})).toBe('');
  });
});

describe('format', () => {
  it('formats durations', () => {
    expect(duration(0)).toBe('0:00');
    expect(duration(185)).toBe('3:05');
    expect(duration(3725)).toBe('1:02:05');
    expect(totalDuration(5400)).toBe('1 h 30 min');
  });
  it('formats relative dates and sizes', () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    expect(relativeDate('2026-11-16T11:59:30Z', now)).toBe('just now');
    expect(relativeDate('2026-11-16T10:00:00Z', now)).toBe('2 h ago');
    expect(bytes(52428800)).toBe('50.0 MB');
  });
  it('names devices from user agents', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605 Version/17 Safari/605')).toBe('Safari on macOS');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537')).toBe('Chrome on Android');
    expect(deviceLabel('')).toBe('Unknown device');
  });
});

describe('mood colours', () => {
  it('parses hex and picks readable ink', () => {
    expect(hexToRgb('#7FB7BE')).toEqual([127, 183, 190]);
    expect(hexToRgb('nope')).toBe(null);
    expect(inkOn('#FFFFFF')).toBe('#1A1C2C');
    expect(inkOn('#191B2B')).toBe('#FFFFFF');
  });
  it('builds one aura field per mood, at most four', () => {
    expect(aura([])).toBe('none');
    const a = aura(['#F2B544', '#7FB7BE', '#C98BB9', '#5D6DA8', '#E4572E']);
    expect(a.split('radial-gradient').length - 1).toBe(4);
  });
});
