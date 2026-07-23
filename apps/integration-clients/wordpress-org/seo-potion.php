<?php
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly

/*
 * Plugin Name: SEO Potion
 * Description: Publish SEO Potion articles to your WordPress site as posts or drafts.
 * Version: 1.0.0
 * Author: SEO Potion
 * License: GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Requires PHP: 8.0
 * Requires at least: 6.4
 * Tested up to: 6.9
*/

/*
 * SEO Potion is a modified fork of Outrank 1.0.10.
 * Original contributor: eugenezolo.
 */

define('SEO_POTION_PLUGIN_PATH', plugin_dir_path(__FILE__));
define('SEO_POTION_PLUGIN_URL', plugin_dir_url(__FILE__));
require_once plugin_dir_path(__FILE__) . 'includes/image-functions.php';

/**
 * Create the seo_potion_manage table for a specific site.
 * Used during activation and when new sites are created in multisite.
 */
function seo_potion_create_table() {
    global $wpdb;
    $table_name = $wpdb->prefix . 'seo_potion_manage';
    $charset_collate = $wpdb->get_charset_collate();

    $sql = "
    CREATE TABLE {$table_name} (
        id INT(11) NOT NULL AUTO_INCREMENT,
        image TEXT NOT NULL,
        slug VARCHAR(191) NOT NULL,
        title TEXT NOT NULL,
        meta_description TEXT NOT NULL,
        status VARCHAR(50) NOT NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY slug_unique (slug)
    ) ENGINE=InnoDB $charset_collate;
    ";

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta($sql);
}

/**
 * Check if the seo_potion_manage table exists for the current site.
 *
 * @return bool True if table exists, false otherwise.
 */
function seo_potion_table_exists() {
    global $wpdb;
    $table_name = $wpdb->prefix . 'seo_potion_manage';

    $cache_key = 'seo_potion_table_exists_' . get_current_blog_id();
    $exists = wp_cache_get($cache_key, 'seo_potion');

    if ($exists === false) {
        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
        $exists = $wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $table_name)) === $table_name;
        wp_cache_set($cache_key, $exists ? 1 : 0, 'seo_potion', 3600);
    }

    return (bool) $exists;
}

/**
 * Ensure the table exists, create it if not.
 * Call this before any table operations.
 */
function seo_potion_ensure_table_exists() {
    if (!seo_potion_table_exists()) {
        seo_potion_create_table();
        // Clear the cache after creating the table
        wp_cache_delete('seo_potion_table_exists_' . get_current_blog_id(), 'seo_potion');
    }
}

// Add admin menu pages
add_action('admin_menu', 'seo_potion_add_seo_potion_menu');
function seo_potion_add_seo_potion_menu() {
    add_menu_page(
        'SEO Potion Menu',
        'SEO Potion',
        'manage_options',
        'seo-potion',
        'seo_potion_page',
        'data:image/png;base64,' . base64_encode(file_get_contents(SEO_POTION_PLUGIN_PATH . 'images/icon.png')),
        60
    );
    add_submenu_page('seo-potion', 'Home', 'Home', 'manage_options', 'seo-potion', 'seo_potion_page');
    add_submenu_page('seo-potion', 'Manage', 'Manage', 'manage_options', 'seo-potion-manage', 'seo_potion_manage_page');
}

// Redirect to manage page if no API key is set
add_action('admin_init', 'seo_potion_check_api_key_redirect');
function seo_potion_check_api_key_redirect() {
    // Only redirect if we're on the SEO Potion home page
    // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- admin page routing, no form data processed
    if (isset($_GET['page']) && $_GET['page'] === 'seo-potion') {
        $apiKey = get_option('seo_potion_api_key');
        if (empty($apiKey)) {
            wp_safe_redirect(admin_url('admin.php?page=seo-potion-manage'));
            exit;
        }
    }
}

// Handle activation redirect
add_action('admin_init', 'seo_potion_activation_redirect');
function seo_potion_activation_redirect() {
    // Only redirect if transient exists
    if (get_transient('seo_potion_activation_redirect')) {
        delete_transient('seo_potion_activation_redirect');

        // Don't redirect on multi-site activations or bulk plugin activations
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- standard WP activation check
        if (is_network_admin() || isset($_GET['activate-multi'])) {
            return;
        }

        // Redirect to manage page
        wp_safe_redirect(admin_url('admin.php?page=seo-potion-manage'));
        exit;
    }
}

// Include admin pages
function seo_potion_page() {
    include_once SEO_POTION_PLUGIN_PATH . 'pages/home.php';
}

function seo_potion_manage_page() {
    include_once SEO_POTION_PLUGIN_PATH . 'pages/manage.php';
}

// Activation hook: Create custom table
register_activation_hook(__FILE__, 'seo_potion_activate');
function seo_potion_activate($network_wide = false) {
    if (is_multisite() && $network_wide) {
        // Network activation: create tables for all existing sites
        $sites = get_sites(['fields' => 'ids']);
        foreach ($sites as $site_id) {
            switch_to_blog($site_id);
            seo_potion_create_table();
            restore_current_blog();
        }
    } else {
        // Single site activation
        seo_potion_create_table();
    }

    // Set transient for activation redirect
    set_transient('seo_potion_activation_redirect', true, 30);
}

/**
 * Create table when a new site is added in multisite.
 * Hook into wp_initialize_site for WordPress 5.1+
 *
 * @param WP_Site $new_site New site object.
 */
add_action('wp_initialize_site', 'seo_potion_on_new_site', 10, 1);
function seo_potion_on_new_site($new_site) {
    if (!function_exists('is_plugin_active_for_network')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    if (!is_plugin_active_for_network(plugin_basename(__FILE__))) {
        return;
    }

    switch_to_blog($new_site->blog_id);
    seo_potion_create_table();
    restore_current_blog();
}

/**
 * Backwards compatibility for WordPress < 5.1
 * Create table when a new site is added using the older hook.
 *
 * @param int $blog_id The new blog ID.
 */
add_action('wpmu_new_blog', 'seo_potion_on_new_blog_legacy', 10, 1);
function seo_potion_on_new_blog_legacy($blog_id) {
    // Only run on WordPress < 5.1 (wp_initialize_site handles 5.1+)
    if (version_compare(get_bloginfo('version'), '5.1', '>=')) {
        return;
    }

    if (!function_exists('is_plugin_active_for_network')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    if (!is_plugin_active_for_network(plugin_basename(__FILE__))) {
        return;
    }

    switch_to_blog($blog_id);
    seo_potion_create_table();
    restore_current_blog();
}

/**
 * Clean up when a site is deleted in multisite (WordPress 5.1+).
 *
 * @param WP_Site $old_site The site being deleted.
 */
add_action('wp_uninitialize_site', 'seo_potion_on_delete_site', 10, 1);
function seo_potion_on_delete_site($old_site) {
    $blog_id = is_object($old_site) ? $old_site->blog_id : $old_site;
    seo_potion_cleanup_site($blog_id);
}

/**
 * Backwards compatibility for WordPress < 5.1.
 * Clean up when a site is deleted using the older hook.
 *
 * @param int $blog_id The site ID being deleted.
 */
add_action('delete_blog', 'seo_potion_on_delete_blog_legacy', 10, 1);
function seo_potion_on_delete_blog_legacy($blog_id) {
    // Only run on WordPress < 5.1 (wp_uninitialize_site handles 5.1+)
    if (version_compare(get_bloginfo('version'), '5.1', '>=')) {
        return;
    }

    seo_potion_cleanup_site($blog_id);
}

/**
 * Clean up plugin data for a specific site.
 *
 * @param int $blog_id The site ID to clean up.
 */
function seo_potion_cleanup_site($blog_id) {
    global $wpdb;

    switch_to_blog($blog_id);

    $table_name = $wpdb->prefix . 'seo_potion_manage';
    // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange, WordPress.DB.DirectDatabaseQuery.NoCaching
    $wpdb->query($wpdb->prepare("DROP TABLE IF EXISTS %i", $table_name));

    // Clean up options
    delete_option('seo_potion_api_key');
    delete_option('seo_potion_integration_id');
    delete_option('seo_potion_post_as_draft');

    restore_current_blog();
}

// Enqueue admin styles and scripts
add_action('admin_enqueue_scripts', 'seo_potion_add_plugin_assets');
function seo_potion_add_plugin_assets($hook_suffix = '') {
    if (strpos($hook_suffix, 'seo-potion') === false) return; // Only enqueue on SEO Potion pages

    wp_enqueue_style('seo-potion-style', SEO_POTION_PLUGIN_URL . 'css/manage.css', [], '1.0.0');
    wp_enqueue_style('seo-potion-home-style', SEO_POTION_PLUGIN_URL . 'css/home.css', [], '1.0.0');

    wp_enqueue_script('seo-potion-script', SEO_POTION_PLUGIN_URL . 'script/manage.js', ['jquery'], '1.0.0', true);
}

// Helper function to get all articles from DB
function seo_potion_get_articles() {
    global $wpdb;

    // Ensure table exists (handles multisite subsites)
    seo_potion_ensure_table_exists();

    $cache_key = 'seo_potion_all_articles_' . get_current_blog_id();
    $articles = wp_cache_get($cache_key, 'seo_potion');

    if ($articles === false) {
        $table_name = $wpdb->prefix . 'seo_potion_manage';
        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
        $articles = $wpdb->get_results($wpdb->prepare("SELECT * FROM %i ORDER BY created_at DESC", $table_name));
        wp_cache_set($cache_key, $articles, 'seo_potion', 300); // Cache for 5 minutes
    }

    return $articles;
}

function seo_potion_clear_articles_cache() {
    wp_cache_delete('seo_potion_all_articles_' . get_current_blog_id(), 'seo_potion');
}

require_once SEO_POTION_PLUGIN_PATH . 'libs/api.php';

// Sync post status changes to seo_potion_manage table
add_action('transition_post_status', 'seo_potion_sync_post_status', 10, 3);
function seo_potion_sync_post_status($new_status, $old_status, $post) {
    if ($post->post_type !== 'post') return;
    if ($new_status === $old_status) return;

    global $wpdb;
    $table = $wpdb->prefix . 'seo_potion_manage';

    if (!seo_potion_table_exists()) return;

    $slug = $post->post_name;
    // Strip __trashed suffix WordPress adds when trashing
    $slug = preg_replace('/__trashed$/', '', $slug);

    // Check if another post uses this slug (avoid conflicts)
    // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
    $other_post = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_name = %s AND post_type = 'post' AND ID != %d",
        $slug,
        $post->ID
    ));
    if ($other_post > 0) return;

    // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
    $wpdb->update($table, ['status' => $new_status], ['slug' => $slug]);

    seo_potion_clear_articles_cache();
}

// Remove from seo_potion_manage when a post is permanently deleted
add_action('before_delete_post', 'seo_potion_sync_post_delete', 10, 1);
function seo_potion_sync_post_delete($post_id) {
    $post = get_post($post_id);
    if (!$post || $post->post_type !== 'post') return;

    global $wpdb;
    $table = $wpdb->prefix . 'seo_potion_manage';

    if (!seo_potion_table_exists()) return;

    $slug = $post->post_name;
    $slug = preg_replace('/__trashed$/', '', $slug);

    // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
    $wpdb->delete($table, ['slug' => $slug]);

    seo_potion_clear_articles_cache();
}
