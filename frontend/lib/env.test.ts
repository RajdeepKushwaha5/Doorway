import { afterEach, describe, expect, it } from 'vitest';
import { apiBase, serverApiBase, siteUrl } from './env';

/**
 * Regression cover for a blank environment variable taking a build down.
 *
 * A hosting dashboard stores an empty field as an empty string rather than
 * leaving the variable unset, and `??` does not fall back on an empty string.
 * `new URL('')` threw at module evaluation, which failed the whole build on a
 * page unrelated to the variable. These read at call time precisely so this is
 * testable.
 */

const KEYS = ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_NOTICE_API_BASE', 'NOTICE_API_BASE'] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('environment URLs', () => {
  it('falls back when a variable is blank, which is how a dashboard stores an empty field', () => {
    for (const key of KEYS) process.env[key] = '';
    expect(() => new URL(siteUrl())).not.toThrow();
    expect(() => new URL(apiBase())).not.toThrow();
    expect(siteUrl()).toBe('http://localhost:3000');
    expect(apiBase()).toBe('http://localhost:4000');
  });

  it('falls back on whitespace, which looks filled in but is not', () => {
    process.env['NEXT_PUBLIC_SITE_URL'] = '   ';
    expect(siteUrl()).toBe('http://localhost:3000');
  });

  it('falls back rather than throwing when the scheme is missing', () => {
    process.env['NEXT_PUBLIC_SITE_URL'] = 'notice.vercel.app';
    expect(() => new URL(siteUrl())).not.toThrow();
    expect(siteUrl()).toBe('http://localhost:3000');
  });

  it('strips trailing slashes, since callers append paths directly', () => {
    process.env['NEXT_PUBLIC_NOTICE_API_BASE'] = 'https://notice-api.onrender.com///';
    expect(apiBase()).toBe('https://notice-api.onrender.com');
  });

  it('keeps a well formed value untouched', () => {
    process.env['NEXT_PUBLIC_NOTICE_API_BASE'] = 'https://notice-api.onrender.com';
    expect(apiBase()).toBe('https://notice-api.onrender.com');
  });

  it('lets the server override the public base, and falls through when it is blank', () => {
    process.env['NEXT_PUBLIC_NOTICE_API_BASE'] = 'https://public.example.com';
    process.env['NOTICE_API_BASE'] = 'http://internal:4000';
    expect(serverApiBase()).toBe('http://internal:4000');

    process.env['NOTICE_API_BASE'] = '';
    expect(serverApiBase()).toBe('https://public.example.com');
  });
});
