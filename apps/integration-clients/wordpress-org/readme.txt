=== SEO Potion ===
Contributors: eugenezolo  
Tags: seo, content automation, article sync, ai blog  
Requires at least: 6.4  
Tested up to: 6.9
Requires PHP: 8.0  
Stable tag: 1.0.0
License: GPLv2 or later  
License URI: https://www.gnu.org/licenses/gpl-2.0.html  

SEO Potion automatically creates and publishes SEO-optimized articles to your WordPress site as blog posts or drafts.

== Description ==

Grow Organic Traffic Without Lifting a Finger.

SEO Potion is your behind-the-scenes content team powered by AI. It creates high-quality, SEO-optimized blog posts that drive traffic to your WordPress site – automatically. No brainstorming, no writing, no scheduling. Just pure growth on autopilot.

SEO Potion plugin may embed external links or credits on the public site.

The plugin provides secure API access to retrieve your published posts for content analysis and optimization within the SEO Potion app.

SEO Potion 1.0.0 is a modified fork of Outrank 1.0.10. The original plugin was published by Outrank with contributor eugenezolo.

== Features ==

1. Fully automatic content creation and keyword research – find hidden keyword gems and publish optimized articles daily.
2. Write in 150+ languages – speak to your audience wherever they are.
3. One-click integration with WordPress – set it up once and your content gets published like magic.
4. SEO-friendly, fact-checked articles with media – includes internal links, videos, images, and credible citations.
5. Your voice, your tone – match your brand’s style with AI-tuned tone control.
6. Up to 4000 words per article – long-form, evergreen content designed to rank and convert.
7. Smart daily publishing plan – a tailored 30-day strategy to keep content flowing.
8. Multi-user and multi-site support – manage teams and scale across sites easily.

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/` or install via the WordPress admin.
2. Activate the plugin from the “Plugins” page.
3. Navigate to **SEO Potion → Manage** in your admin menu.
4. Choose a strong integration token, select publish mode, and save the plugin settings.
5. In SEO Potion, open **Settings → Integrations**, paste the same token, and select **Connect & test**.
6. After the connection succeeds, articles can be sent to this WordPress site from SEO Potion.

== Screenshots ==

1. Grow Organic Traffic on Autopilot.
2. The Sync Dashboard and Setup Page.
3. AI-generated blog posts ready to publish.

== External services ==

This plugin connects to the SEO Potion API to fetch blog article content for your site. This is necessary to sync AI-generated content to your WordPress posts.

Data sent:
- Integration token (stored by the user in plugin settings)

Data is sent when:
- Articles are synced via the SEO Potion API.

External Service:
- [SEO Potion](https://seopotion.com)

== Privacy ==

The plugin stores the integration key provided by the site administrator in the WordPress options table. It exchanges the integration key and article or post data with SEO Potion only when the integration routes are used. Remote images supplied with article content may be downloaded from their source URLs into the WordPress Media Library. The plugin does not add analytics or advertising services.

== Terms of use ==

Use of the plugin requires authorization to connect the WordPress site to SEO Potion. The site administrator controls plugin activation, the integration key, and whether incoming articles are saved as drafts or published. The plugin is licensed under GPLv2 or later.

== Frequently Asked Questions ==

= Does this plugin automatically post articles? =  
Yes. You can choose whether articles are saved as drafts or published instantly.

= How does the sync work? =
SEO Potion syncs articles to your site via a secure API connection.

== Changelog ==

= 1.0.0 =
* Initial SEO Potion fork, derived from Outrank 1.0.10.

= Upstream history: Outrank 1.0.10 and earlier =

= 1.0.10 =
* Fixed a duplicate slug error that could occur when publishing articles as drafts

= 1.0.9 =
* Slug generation limit has been removed; WordPress now assigns unique slugs without limit

= 1.0.8 =
* Added support for updating existing synced articles from Outrank
* Improved integration compatibility by exposing available plugin capabilities
* Internal maintenance and packaging improvements

= 1.0.7 =
* External images in articles are now downloaded to the WordPress media library for better performance and SEO
* New /set-integration-id REST endpoint for API-driven integration registration
* Removed background cron fetch in favor of direct API-driven article submission
* Plugin dashboard stays in sync when posts are trashed, deleted, or status-changed in WordPress
* All secret comparisons now use timing-safe hash_equals() for security hardening
* Fixed slug deduplication off-by-one error
* Featured image now inherits author and parent post from the article
* YouTube iframe embeds preserved through all post operations
* Non-destructive uninstall: plugin no longer deletes user posts or media on removal
* Added deactivation hook to clear scheduled cron event

= 1.0.6 =
* Added Squirrly SEO plugin support for SEO meta data (title, description, keywords)

= 1.0.5 =
* Added full WordPress Multisite support
* Network activation now properly creates tables for all sites
* New sites in a multisite network automatically get plugin tables created
* Fixed cache key collisions in multisite environments with shared object cache
* Proper cleanup when sites are deleted from a multisite network
* Backwards compatibility with WordPress versions before 5.1
* Removed cron-based daily sync and manual fetch triggers in favor of API-driven sync
* Added paginated dashboard with 10 articles per page

= 1.0.4 =
* Improved image downloading reliability across different server configurations
* Fixed compatibility issues with strict database settings
* Better error messages when troubleshooting sync issues
* Improved handling of image filenames and file types

= 1.0.3 =
* Add custom duplicate slugs handling

= 1.0.2 =
* Fixed YouTube video embedding in synced articles

= 1.0.1 =
* Added posts fetching endpoint for retrieving published blog posts
* Added API access functionality for content analysis and optimization
* Various bug fixes and improvements

= 1.0.0 =
* Initial release.
* Admin dashboard with API key and post settings.
* Manual and automatic article syncing via cron.

== Upgrade Notice ==

= 1.0.0 =
Initial SEO Potion fork based on Outrank 1.0.10.
