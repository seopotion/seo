<?php

define('ABSPATH', __DIR__ . '/');
define('SEO_POTION_PLUGIN_PATH', __DIR__ . '/');
define('OBJECT', 'OBJECT');

class WP_REST_Response {
    public $data;
    public $status;

    public function __construct($data, $status) {
        $this->data = $data;
        $this->status = $status;
    }
}

class WP_Error {
    private $message;

    public function __construct($code, $message) {
        $this->message = $message;
    }

    public function get_error_message() {
        return $this->message;
    }
}

class HarnessRequest {
    private $params;

    public function __construct($params) {
        $this->params = $params;
    }

    public function get_json_params() {
        return $this->params;
    }
}

class HarnessWpdb {
    public $prefix = 'wp_';
    public $options = 'wp_options';
    public $posts = 'wp_posts';
    public $postmeta = 'wp_postmeta';
    public $last_error = '';
    public $lock_available = true;
    private $connection_id;

    public function __construct($connection_id) {
        $this->connection_id = $connection_id;
    }

    public function prepare($query, ...$args) {
        return ['query' => $query, 'args' => $args];
    }

    public function insert($table, $row) {
        global $harness_fail_tracking_once, $harness_tracking;
        if ($table === 'wp_seo_potion_manage') {
            if ($harness_fail_tracking_once) {
                $harness_fail_tracking_once = false;
                $this->last_error = 'simulated tracking failure';
                return false;
            }
            $harness_tracking[$row['slug']] = $row;
        }
        return true;
    }

    public function delete($table, $where) {
        global $harness_tracking;
        if ($table === 'wp_seo_potion_manage') unset($harness_tracking[$where['slug']]);
        return 1;
    }

    public function get_var($prepared) {
        global $harness_advisory_locks, $harness_tracking;
        if (str_contains($prepared['query'], 'GET_LOCK')) {
            if (!$this->lock_available) return null;
            $lock_name = $prepared['args'][0];
            $owner = $harness_advisory_locks[$lock_name] ?? null;
            if ($owner !== null && $owner !== $this->connection_id) return '0';
            $harness_advisory_locks[$lock_name] = $this->connection_id;
            return '1';
        }
        if (str_contains($prepared['query'], 'RELEASE_LOCK')) {
            $lock_name = $prepared['args'][0];
            if (($harness_advisory_locks[$lock_name] ?? null) !== $this->connection_id) {
                return isset($harness_advisory_locks[$lock_name]) ? '0' : null;
            }
            unset($harness_advisory_locks[$lock_name]);
            return '1';
        }
        if (str_contains($prepared['query'], 'SHOW TABLES')) return null;
        if (str_contains($prepared['query'], 'SELECT COUNT(*) FROM %i')) {
            return isset($harness_tracking[$prepared['args'][1]]) ? 1 : 0;
        }
        return 0;
    }

    public function disconnect() {
        global $harness_advisory_locks;
        foreach ($harness_advisory_locks as $lock_name => $owner) {
            if ($owner === $this->connection_id) unset($harness_advisory_locks[$lock_name]);
        }
    }
}

$wpdb = new HarnessWpdb('bootstrap');

function add_action() {}
function register_rest_route() {}
function sanitize_text_field($value) { return trim((string) $value); }
function sanitize_key($value) { return strtolower(preg_replace('/[^a-z0-9_-]/i', '', (string) $value)); }
function sanitize_title($value) { return trim(strtolower(preg_replace('/[^a-z0-9]+/i', '-', (string) $value)), '-'); }
function wp_kses_allowed_html() { return []; }
function wp_kses($content) { return $content; }
function kses_remove_filters() {}
function kses_init_filters() {}
function current_time() {
    global $harness_now;
    return gmdate('Y-m-d H:i:s', $harness_now);
}
function wp_cache_delete() {}
function get_current_blog_id() { return 1; }
function maybe_unserialize($value) { return $value; }
function is_wp_error($value) { return $value instanceof WP_Error; }
function get_user_by() { return false; }
function get_category_by_slug() { return false; }
function wp_insert_term() { return ['term_id' => 1]; }
function seo_potion_ensure_table_exists() {}
function seo_potion_upload_image_from_url() { return 0; }
function seo_potion_download_content_images($content) { return $content; }
function set_post_thumbnail() { return true; }
function wp_delete_attachment() { return true; }

function harness_reset() {
    global $harness_options, $harness_posts, $harness_tracking, $harness_next_post_id,
        $harness_on_insert, $harness_on_delete, $harness_fail_tracking_once,
        $harness_fail_completion_once, $harness_advisory_locks, $harness_connections,
        $harness_now, $wpdb;
    $harness_options = [
        'seo_potion_api_key' => 'token',
        'seo_potion_post_as_draft' => 'yes',
    ];
    $harness_posts = [];
    $harness_tracking = [];
    $harness_next_post_id = 1;
    $harness_on_insert = null;
    $harness_on_delete = null;
    $harness_fail_tracking_once = false;
    $harness_fail_completion_once = false;
    $harness_advisory_locks = [];
    $harness_connections = [
        'a' => new HarnessWpdb('a'),
        'b' => new HarnessWpdb('b'),
        'dead' => new HarnessWpdb('dead'),
    ];
    $harness_now = strtotime('2026-08-12T00:00:00Z');
    $wpdb = $harness_connections['a'];
}

function get_option($name, $default = false) {
    global $harness_options;
    return $harness_options[$name] ?? $default;
}

function harness_with_connection($name, $callback) {
    global $harness_connections, $wpdb;
    $previous = $wpdb;
    $wpdb = $harness_connections[$name];
    try {
        return $callback();
    } finally {
        $wpdb = $previous;
    }
}

function harness_advance_seconds($seconds) {
    global $harness_now;
    $harness_now += $seconds;
}

function get_posts($args) {
    global $harness_posts;
    if (($args['meta_key'] ?? '') !== '_seo_potion_source_article_id') return [];
    foreach ($harness_posts as $id => $post) {
        if (($post['meta']['_seo_potion_source_article_id'] ?? null) === $args['meta_value']) {
            return [$id];
        }
    }
    return [];
}

function get_post_meta($post_id, $key) {
    global $harness_posts;
    return $harness_posts[$post_id]['meta'][$key] ?? '';
}

function update_post_meta($post_id, $key, $value) {
    global $harness_fail_completion_once, $harness_posts;
    if (!isset($harness_posts[$post_id])) return false;
    if ($key === '_seo_potion_source_publish_complete' && $harness_fail_completion_once) {
        $harness_fail_completion_once = false;
        return false;
    }
    $harness_posts[$post_id]['meta'][$key] = $value;
    return 1;
}

function wp_insert_post($args) {
    global $harness_posts, $harness_next_post_id, $harness_on_insert;
    $id = $harness_next_post_id++;
    $harness_posts[$id] = [
        'post_name' => $args['post_name'],
        'post_status' => $args['post_status'],
        'post_content' => $args['post_content'],
        'post_title' => $args['post_title'],
        'meta' => $args['meta_input'] ?? [],
        'thumbnail_id' => 0,
    ];
    if ($harness_on_insert) {
        $callback = $harness_on_insert;
        $harness_on_insert = null;
        $callback($id);
    }
    return $id;
}

function wp_update_post($args) {
    global $harness_posts;
    $id = $args['ID'];
    if (!isset($harness_posts[$id])) return new WP_Error('missing', 'missing post');
    foreach (['post_status', 'post_content', 'post_author', 'post_parent'] as $field) {
        if (array_key_exists($field, $args)) $harness_posts[$id][$field] = $args[$field];
    }
    return $id;
}

function wp_delete_post($post_id) {
    global $harness_posts, $harness_on_delete;
    if (!isset($harness_posts[$post_id])) return false;
    if ($harness_on_delete) {
        $callback = $harness_on_delete;
        $harness_on_delete = null;
        $callback($post_id);
    }
    unset($harness_posts[$post_id]);
    return (object) ['ID' => $post_id];
}

function get_post_thumbnail_id($post_id) {
    global $harness_posts;
    return $harness_posts[$post_id]['thumbnail_id'] ?? 0;
}

function get_post_field($field, $post_id) {
    global $harness_posts;
    return $harness_posts[$post_id][$field] ?? '';
}

function get_permalink($post_id) { return 'https://example.test/post/' . $post_id; }

function get_page_by_path($slug) {
    global $harness_posts;
    foreach ($harness_posts as $id => $post) {
        if ($post['post_name'] === $slug) return (object) ['ID' => $id];
    }
    return null;
}

function harness_request($source = 'article-1', $status = 'publish') {
    $params = [
        'secret' => 'token',
        'title' => 'Guide',
        'slug' => 'guide',
        'content' => 'Body',
        'meta_description' => 'Description',
    ];
    if ($source !== null) $params['source_article_id'] = $source;
    if ($status !== null) $params['status'] = $status;
    return new HarnessRequest($params);
}

function harness_assert($condition, $message) {
    if (!$condition) throw new RuntimeException($message);
}

require $argv[1];

harness_reset();
$during = null;
$created_by_a = null;
$harness_on_insert = function ($post_id) use (&$created_by_a, &$during) {
    global $harness_posts;
    $created_by_a = $post_id;
    harness_assert(
        ($harness_posts[$post_id]['meta']['_seo_potion_source_publish_complete'] ?? '') !== '1',
        'request A was marked complete before finalization'
    );
    harness_advance_seconds(301);
    $during = harness_with_connection('b', function () {
        return seo_potion_receive_article(harness_request());
    });
    harness_assert(isset($harness_posts[$post_id]), 'request B deleted request A post');
};
$first = seo_potion_receive_article(harness_request());
harness_assert($during->status === 409, 'concurrent request did not receive 409');
harness_assert(($during->data['code'] ?? '') === 'source_publish_in_progress', 'missing retry code');
harness_assert($first->status === 200, 'first request did not complete');
$repeat = harness_with_connection('b', function () {
    return seo_potion_receive_article(harness_request());
});
harness_assert($repeat->status === 200, 'completed repeat did not return 200');
harness_assert($repeat->data['post_id'] === $first->data['post_id'], 'repeat returned another post');
harness_assert($first->data['post_id'] === $created_by_a, 'request A post identity changed');
$completed = array_filter($harness_posts, function ($post) {
    return ($post['meta']['_seo_potion_source_publish_complete'] ?? '') === '1';
});
harness_assert(count($completed) === 1, 'live-owner contention created multiple completed posts');
harness_assert(count($harness_tracking) === 1, 'live-owner contention created duplicate tracking rows');

harness_reset();
$harness_posts[10] = [
    'post_name' => 'guide',
    'post_status' => 'publish',
    'post_content' => 'partial',
    'post_title' => 'Guide',
    'meta' => ['_seo_potion_source_article_id' => 'article-1'],
    'thumbnail_id' => 0,
];
$harness_next_post_id = 11;
$recovered = seo_potion_receive_article(harness_request());
harness_assert($recovered->status === 200, 'incomplete post recovery failed');
harness_assert($recovered->data['post_id'] !== 10, 'incomplete post was returned as success');
harness_assert(!isset($harness_posts[10]), 'incomplete post was not removed');

harness_reset();
$during_cleanup = null;
$harness_fail_completion_once = true;
$harness_on_delete = function () use (&$during_cleanup) {
    $during_cleanup = harness_with_connection('b', function () {
        return seo_potion_receive_article(harness_request());
    });
};
$failed = seo_potion_receive_article(harness_request());
harness_assert($failed->status === 500, 'simulated finalization failure did not fail');
harness_assert($during_cleanup->status === 409, 'cleanup race returned a doomed post');
harness_assert(count($harness_posts) === 0, 'failed post remained visible');
harness_assert(count($harness_tracking) === 0, 'failed post tracking row remained visible');
$after_failure = harness_with_connection('b', function () {
    return seo_potion_receive_article(harness_request());
});
harness_assert($after_failure->status === 200, 'retry after cleanup did not succeed');

harness_reset();
$harness_posts[20] = [
    'post_name' => 'guide',
    'post_status' => 'publish',
    'post_content' => 'partial',
    'post_title' => 'Guide',
    'meta' => ['_seo_potion_source_article_id' => 'article-1'],
    'thumbnail_id' => 0,
];
$harness_next_post_id = 21;
$dead_lock = harness_with_connection('dead', function () {
    return seo_potion_acquire_source_publish_lock('article-1');
});
harness_assert(is_string($dead_lock), 'dead owner did not acquire its source lock');
$harness_connections['dead']->disconnect();
$stale_recovery = harness_with_connection('b', function () {
    return seo_potion_receive_article(harness_request());
});
$stale_repeat = seo_potion_receive_article(harness_request());
harness_assert($stale_recovery->status === 200, 'dead connection was not recovered');
harness_assert($stale_repeat->data['post_id'] === $stale_recovery->data['post_id'], 'dead-owner recovery duplicated');
$completed = array_filter($harness_posts, function ($post) {
    return ($post['meta']['_seo_potion_source_publish_complete'] ?? '') === '1';
});
harness_assert(count($completed) === 1, 'dead-owner recovery did not converge to one completed post');
harness_assert(count($harness_tracking) === 1, 'dead-owner recovery left duplicate tracking rows');

harness_reset();
$harness_connections['b']->lock_available = false;
$unavailable = harness_with_connection('b', function () {
    return seo_potion_receive_article(harness_request());
});
harness_assert($unavailable->status === 500, 'unavailable lock did not fail closed');
harness_assert(
    ($unavailable->data['code'] ?? '') === 'source_publish_lock_unavailable',
    'unavailable lock returned the wrong code'
);
harness_assert(count($harness_posts) === 0, 'publishing continued without an established lock');

harness_reset();
$manual = seo_potion_receive_article(harness_request(null, null));
harness_assert($manual->status === 200, 'manual request failed');
harness_assert($manual->data['post_status'] === 'draft', 'manual draft preference was ignored');
$automatic = seo_potion_receive_article(harness_request('article-2', 'publish'));
harness_assert($automatic->data['post_status'] === 'publish', 'explicit publish did not override draft');

echo json_encode(['passed' => true]) . PHP_EOL;
