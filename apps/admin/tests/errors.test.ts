import { describe, expect, test } from 'vitest';
import { ApiError } from '../src/lib/api';
import { errorMessage, errorText } from '../src/lib/errors';

describe('errorMessage', () => {
  test('maps known API codes to operator-readable copy', () => {
    for (const code of ['not_found', 'no_presets', 'strategy_not_claimable']) {
      expect(errorMessage(code)).not.toBe(code);
    }
  });

  test('maps every refusal the article editor and WordPress routes can return', () => {
    for (const code of [
      'validation_failed',
      'images_in_progress',
      'images_not_supported',
      'wordpress_not_connected',
      'already_published',
      'not_published',
      'images_not_complete',
      'post_id_not_saved',
      'wordpress_request_failed',
    ]) {
      expect(errorMessage(code)).not.toBe(code);
    }
  });

  test('maps every static-site publishing refusal', () => {
    for (const code of [
      'static_site_not_connected',
      'static_publish_in_progress',
      'slug_conflict',
      'installation_not_found',
      'installation_suspended',
      'missing_write_permission',
      'repo_not_found',
      'commit_rejected',
      'ref_conflict',
      'github_request_failed',
      'invalid_provider_response',
      'record_failed',
    ]) {
      expect(errorMessage(code)).not.toBe(code);
    }
  });

  test('describes the images guard for every publishing destination', () => {
    expect(errorMessage('images_not_complete')).not.toContain('WordPress');
  });

  test('maps every refusal the phase-2 unstick levers can return', () => {
    for (const code of [
      'candidate_not_restorable',
      'not_resettable',
      'generation_started',
      'setup_complete',
      'gsc_not_connected',
      'wordpress_not_connected',
      'invalid_integration_key',
      'integration_not_configured',
      'wordpress_request_failed',
      'strategy_not_claimable',
    ]) {
      expect(errorMessage(code)).not.toBe(code);
    }
  });

  test('falls back to the raw code for anything unmapped', () => {
    // Better than a generic "something went wrong": the operator can still act
    // on a code they can read (WordPress plugin codes arrive verbatim).
    expect(errorMessage('rest_cannot_create')).toBe('rest_cannot_create');
  });
});

describe('errorText', () => {
  test('distinguishes storage HTTP failures from browser network/CORS failures', () => {
    expect(errorText(new ApiError('image_upload_failed', 403), 'fallback')).toContain('HTTP 403');
    const networkMessage = errorText(new ApiError('image_upload_network_error', 0), 'fallback');
    expect(networkMessage).toContain('CORS');
    expect(networkMessage).not.toContain('expired');
  });
  test('renders the mapped message for an ApiError', () => {
    expect(errorText(new ApiError('no_presets', 409), 'fallback')).toBe(errorMessage('no_presets'));
  });

  test('uses the fallback for anything else', () => {
    expect(errorText(new TypeError('fetch failed'), 'Search failed.')).toBe('Search failed.');
  });
});
