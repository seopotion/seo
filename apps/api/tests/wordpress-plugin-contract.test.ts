import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const pluginRoot = join(process.cwd(), 'apps/integration-clients/wordpress-org');
const api = readFileSync(join(pluginRoot, 'libs/api.php'), 'utf8');
const plugin = readFileSync(join(pluginRoot, 'seo-potion.php'), 'utf8');

describe('WordPress idempotent publish contract', () => {
  test('advertises the versioned capability and returns actual remote state', () => {
    expect(plugin).toContain('Version: 1.2.0');
    expect(api).toContain("'idempotent_publish'");
    expect(api).toContain("'slug' => (string) get_post_field('post_name', $post_id)");
    expect(api).toContain("'permalink' => (string) get_permalink($post_id)");
    expect(api).toContain("'post_status' => (string) get_post_field('post_status', $post_id)");
  });

  test('persists separate source identity and durable completion metadata', () => {
    const lock = api.indexOf(
      '$source_lock = seo_potion_acquire_source_publish_lock($source_article_id);',
    );
    const repeatLookup = api.indexOf(
      '$existing_post_id = seo_potion_find_post_by_source_article_id($source_article_id);',
    );
    const insert = api.indexOf('$post_id = seo_potion_create_post_with_images($post_data);');
    const completion = api.indexOf(
      "update_post_meta($post_id, '_seo_potion_source_publish_complete', '1')",
    );

    expect(api).toContain("'_seo_potion_source_article_id' => $source_article_id");
    expect(api).toContain("get_post_meta($post_id, '_seo_potion_source_publish_complete', true)");
    expect(lock).toBeGreaterThan(0);
    expect(repeatLookup).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(repeatLookup);
    expect(completion).toBeGreaterThan(insert);
  });

  test('uses connection-owned advisory locking and makes active contention retryable', () => {
    expect(api).toContain("$wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock_name)");
    expect(api).toContain("$wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock_name)");
    expect(api).toContain("'code' => 'source_publish_in_progress'");
    expect(api).toContain("'code' => 'source_publish_lock_unavailable'");
    expect(api).toContain('], 409);');
    expect(api).toContain('seo_potion_release_source_publish_lock($source_lock_name)');
  });

  test('an explicit automatic status overrides the manual draft preference', () => {
    expect(api).toContain("$requested_status !== ''");
    expect(api).toContain('? $requested_status');
    expect(api).toContain("get_option('seo_potion_post_as_draft', 'yes')");
  });
});
