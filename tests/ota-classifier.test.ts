import { describe, expect, it } from 'vitest';

import {
  classifyChangedFile,
  classifyChangedFiles,
  OTA_CLASSIFICATIONS,
} from '../scripts/guards/classify-ota-change.mjs';

describe('OTA/native change classifier', () => {
  it('allows existing-runtime JavaScript and documentation changes', () => {
    expect(classifyChangedFiles([
      'src/services/api.ts',
      'src/shared/i18n/locales/tr.ts',
      'docs/ota-rollback-runbook.md',
    ])).toMatchObject({
      classification: OTA_CLASSIFICATIONS.safe,
      otaPublishAllowed: true,
    });
  });

  it.each([
    'android/app/src/main/AndroidManifest.xml',
    'ios/WMatch/Supporting/Expo.plist',
    'app.json',
    'eas.json',
    'package.json',
    'package-lock.json',
    'firebase/GoogleService-Info.plist',
    'assets/branding/icon-wm-normalized.png',
  ])('requires a new binary for %s', (path) => {
    expect(classifyChangedFile(path)?.classification).toBe(
      OTA_CLASSIFICATIONS.native,
    );
  });

  it('fails closed for unknown and bundler configuration paths', () => {
    expect(classifyChangedFiles(['metro.config.js'])).toMatchObject({
      classification: OTA_CLASSIFICATIONS.review,
      otaPublishAllowed: false,
    });
    expect(classifyChangedFiles(['unexpected-runtime-file.xyz'])).toMatchObject({
      classification: OTA_CLASSIFICATIONS.review,
      otaPublishAllowed: false,
    });
  });

  it('fails closed for empty and independently deployed infrastructure changes', () => {
    expect(classifyChangedFiles([])).toMatchObject({
      classification: OTA_CLASSIFICATIONS.review,
      otaPublishAllowed: false,
    });
    expect(classifyChangedFiles(['supabase/migrations/20260101000000_change.sql'])).toMatchObject({
      classification: OTA_CLASSIFICATIONS.review,
      otaPublishAllowed: false,
    });
    expect(classifyChangedFiles(['infra/cloudflare/wmatch-edge/src/index.ts'])).toMatchObject({
      classification: OTA_CLASSIFICATIONS.review,
      otaPublishAllowed: false,
    });
  });

  it.each([
    ['src/services/api.ts', 'supabase/functions/api/index.ts'],
    ['src/services/api.ts', 'infra/cloudflare/wmatch-edge/src/index.ts'],
    ['src/services/api.ts', '.github/workflows/eas-update-production.yml'],
  ])('fails closed for a mobile and independently deployed mixed commit', (mobilePath, deployedPath) => {
    expect(classifyChangedFiles([mobilePath, deployedPath])).toMatchObject({
      classification: OTA_CLASSIFICATIONS.review,
      otaPublishAllowed: false,
    });
  });

  it('uses the strictest classification in a mixed change set', () => {
    expect(classifyChangedFiles(['src/app/App.tsx', 'android/build.gradle'])).toMatchObject({
      classification: OTA_CLASSIFICATIONS.native,
      otaPublishAllowed: false,
    });
  });
});
