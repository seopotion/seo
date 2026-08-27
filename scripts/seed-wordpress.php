<?php

require '/var/www/html/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/misc.php';
require_once ABSPATH . 'wp-admin/includes/taxonomy.php';

$administrators = get_users(['role' => 'administrator', 'number' => 1]);
if ($administrators) {
    wp_set_current_user($administrators[0]->ID);
}

function order66_fix_upload_permissions(): void
{
    $uploads = wp_get_upload_dir();
    $base = $uploads['basedir'];
    if (!is_dir($base)) {
        wp_mkdir_p($base);
    }

    chown($base, 'www-data');
    chgrp($base, 'www-data');
    chmod($base, 0755);

    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($files as $file) {
        $path = $file->getPathname();
        chown($path, 'www-data');
        chgrp($path, 'www-data');
        chmod($path, $file->isDir() ? 0755 : 0644);
    }
}

order66_fix_upload_permissions();

function order66_upsert(string $type, string $slug, string $title, string $content, string $excerpt = ''): int
{
    $existing = get_page_by_path($slug, OBJECT, $type);
    $post = [
        'ID' => $existing ? $existing->ID : 0,
        'post_type' => $type,
        'post_name' => $slug,
        'post_title' => $title,
        'post_content' => $content,
        'post_excerpt' => $excerpt,
        'post_status' => 'publish',
    ];
    $id = wp_insert_post(wp_slash($post), true);
    if (is_wp_error($id)) {
        throw new RuntimeException($id->get_error_message());
    }
    return $id;
}

function order66_hero(): int
{
    $existing = get_posts([
        'post_type' => 'attachment',
        'post_status' => 'inherit',
        'meta_key' => '_order66_seed_key',
        'meta_value' => 'coffee-hero',
        'posts_per_page' => 1,
    ]);
    if ($existing) {
        return $existing[0]->ID;
    }

    $upload = wp_upload_bits(
        'order66-coffee-hero.png',
        null,
        file_get_contents('/opt/order66/order66-coffee-hero.png')
    );
    if ($upload['error']) {
        throw new RuntimeException($upload['error']);
    }

    $id = wp_insert_attachment([
        'post_mime_type' => 'image/png',
        'post_title' => 'Barista preparing coffee at Order66 Coffee Roasters',
        'post_content' => '',
        'post_status' => 'inherit',
    ], $upload['file']);
    wp_update_attachment_metadata($id, wp_generate_attachment_metadata($id, $upload['file']));
    update_post_meta($id, '_wp_attachment_image_alt', 'Barista pouring a latte beside freshly roasted coffee beans');
    update_post_meta($id, '_order66_seed_key', 'coffee-hero');
    return $id;
}

$hero_id = order66_hero();
order66_fix_upload_permissions();
$hero_url = wp_get_attachment_url($hero_id);

$home = order66_upsert('page', 'home', 'Home', <<<HTML
<section class="order66-hero alignfull" style="background-image:linear-gradient(90deg,rgba(24,15,10,.9),rgba(24,15,10,.18)),url('{$hero_url}')"><div class="order66-hero-content"><h1>Specialty coffee, roasted in Kadıköy</h1><p><strong>Order66 Coffee Roasters</strong> is an independent Istanbul coffee shop and micro-roastery serving traceable seasonal coffees, carefully brewed espresso and filter drinks, and freshly roasted beans for home.</p><p class="order66-actions"><a href="/our-coffee/">Explore our coffee</a><a href="/visit-us/">Visit the café</a></p></div></section>
<section class="order66-section order66-intro"><div><p class="order66-eyebrow">Small-batch · Traceable · Roasted weekly</p><h2>Your neighborhood coffee roastery</h2></div><p>We roast in small batches to bring out sweetness, clarity and the character of each origin. Whether you stop by for a morning flat white, brew a V60 at home or need dependable coffee for your restaurant, our team will help you find the right roast and recipe.</p></section>
<section class="order66-section"><p class="order66-eyebrow">Made for every coffee routine</p><h2>What we offer</h2><div class="order66-grid"><article class="order66-card"><span>01</span><h3>Café and brew bar</h3><p>Espresso, cappuccino, Turkish coffee, cold brew and rotating hand-brewed single origins, prepared by baristas who are happy to talk through every cup.</p></article><article class="order66-card"><span>02</span><h3>Freshly roasted beans</h3><p>Seasonal single-origin and house-blend coffee is roasted every week and available as whole bean or ground for your brewing method.</p></article><article class="order66-card"><span>03</span><h3>Coffee subscriptions</h3><p>Choose one or two bags delivered monthly. Our rotating subscription introduces distinctive producers and harvests with practical brew guides.</p></article><article class="order66-card"><span>04</span><h3>Wholesale coffee</h3><p>We supply cafés, restaurants and creative workplaces across Istanbul with coffee, equipment guidance, recipes and barista training.</p></article></div></section>
<section class="order66-band"><div><p class="order66-eyebrow">Thoughtful from origin to cup</p><h2>Coffee with a clear story</h2><p>We buy traceable coffee from responsible import partners, publish origin and process details, and roast for balance rather than bitterness. Our packaging is recyclable, our spent grounds go to neighborhood gardens, and plant-based milk is always available.</p></div><aside><strong>Open daily in Moda, Kadıköy</strong><p>Come for a cup, pick up beans, or ask us anything about better coffee at home.</p><a href="/visit-us/">Plan your visit →</a></aside></section>
HTML, 'Independent specialty coffee shop and micro-roastery in Kadıköy, Istanbul.');

$coffee = order66_upsert('page', 'our-coffee', 'Our Coffee', <<<'HTML'
<h2 class="order66-page-lead">Coffee roasted for sweetness and clarity</h2>
<p>Order66 sources traceable Arabica coffee and roasts it in small batches at our Kadıköy micro-roastery. Every bag includes its origin, producer, variety, process, tasting notes, roast date and a starting brew recipe.</p>
<h2>Seasonal single origins</h2>
<h3>Ethiopia Guji — Natural</h3><p>A bright, aromatic filter roast with notes of blueberry, bergamot and cacao nib. Best for V60, AeroPress and batch brew.</p>
<h3>Colombia Huila — Washed</h3><p>A balanced all-rounder with red apple, caramel and milk chocolate. Delicious as espresso or filter.</p>
<h3>Brazil Mantiqueira — Pulped natural</h3><p>Our comforting espresso foundation, bringing hazelnut, toffee and a round body that works beautifully with milk.</p>
<h2>House espresso: First Light</h2>
<p>First Light is our dependable house blend for espresso machines and moka pots. It is sweet and full-bodied, with chocolate, almond and stone-fruit character. We develop it enough for easy extraction without roasting away the coffee's natural flavor.</p>
<h2>Decaf without compromise</h2>
<p>Our sugarcane-process Colombian decaf is selected and roasted with the same care as every other coffee. Expect caramel, orange and cocoa, with less than 0.1% caffeine.</p>
<h2>Subscriptions and wholesale</h2>
<p>Monthly subscriptions are available for filter, espresso or a rotating discovery selection. Wholesale partners receive dial-in recipes, training and ongoing support. Contact us to arrange a tasting.</p>
HTML, 'Seasonal single-origin coffee, espresso blends, decaf, subscriptions and wholesale beans.');

$about = order66_upsert('page', 'about', 'About Order66', <<<'HTML'
<h2 class="order66-page-lead">Built around better everyday coffee</h2>
<p>Order66 Coffee Roasters began in Kadıköy with a simple idea: specialty coffee should be exciting without being intimidating. We are an independent coffee shop and micro-roastery where careful sourcing, precise roasting and warm service belong together.</p>
<h2>Our approach</h2>
<p>We choose coffees for sweetness, traceability and distinctive regional character. Small-batch roasting gives us the control to develop each coffee individually. At the brew bar, we measure and taste throughout the day so every espresso and filter coffee has a reliable recipe.</p>
<h2>People and partnerships</h2>
<p>Long-term relationships make coffee better. We work with transparent importers and producers who share pricing, farming and processing information. At home in Istanbul, we collaborate with independent bakeries and deliver wholesale coffee to hospitality teams that care about quality.</p>
<h2>Less waste, more reuse</h2>
<p>We use recyclable retail bags, offer a discount for reusable cups, separate café waste and share spent coffee grounds with local gardeners. Our menu is intentionally focused so ingredients stay fresh and waste stays low.</p>
<h2>A welcoming place to learn</h2>
<p>You do not need special vocabulary to enjoy good coffee. Tell us what flavors and brewing method you like, and we will recommend a coffee and help you make it taste great.</p>
HTML, 'The story, sourcing values and roasting approach behind Order66 Coffee Roasters.');

$visit = order66_upsert('page', 'visit-us', 'Visit Us', <<<'HTML'
<h2 class="order66-page-lead">Visit Order66 in Kadıköy</h2>
<p>Our neighborhood café and micro-roastery is in Moda, Kadıköy, Istanbul. Stop in for espresso, seasonal filter coffee, fresh pastries and bags roasted during the week.</p>
<h2>Opening hours</h2>
<ul><li>Monday–Friday: 07:30–19:00</li><li>Saturday–Sunday: 08:30–20:00</li></ul>
<h2>Getting here</h2>
<p>We are a short walk from the Kadıköy ferry terminal and the Moda tram line. Bicycle parking is available outside. The café has step-free street access and free Wi-Fi.</p>
<h2>Contact</h2>
<p>Email: hello@order66.test<br>Phone: +90 212 000 00 66<br>Instagram: @order66coffee</p>
<p>This is a local demonstration business created for testing. The address and contact details are not a real storefront.</p>
HTML, 'Opening hours, location and contact details for our specialty coffee shop in Moda, Kadıköy.');

$journal = order66_upsert('page', 'journal', 'Coffee Journal', '<h2 class="order66-page-lead">Guides and stories from our roastery</h2><p>Practical brewing guides, origin stories and news from the Order66 roastery.</p>', 'Coffee brewing guides and roastery stories.');

$category = wp_create_category('Coffee Journal');

$posts = [
    ['pour-over-coffee-guide', 'How to Brew Better Pour-Over Coffee at Home', <<<'HTML'
<p>Pour-over coffee rewards consistency more than expensive equipment. With fresh beans, a simple dripper and a repeatable recipe, you can make a clean, sweet cup every morning.</p>
<h2>What you need</h2><p>Use 20 grams of medium-fine coffee, 320 grams of filtered water, a paper filter, a dripper and a scale. Heat the water to 92–96°C. Coffee roasted within the past month will usually give the clearest result.</p>
<h2>A reliable V60 recipe</h2><ol><li>Rinse the paper filter and discard the rinse water.</li><li>Add the ground coffee and level the bed.</li><li>Pour 60 grams of water, wetting every ground, and wait 40 seconds.</li><li>Pour slowly in circles until the scale reaches 200 grams.</li><li>At 1:15, continue to 320 grams and let the brewer drain.</li></ol>
<p>Aim for a total brew time around 2:45–3:15. If the coffee tastes sour or thin, grind finer. If it tastes dry or bitter, grind coarser. Change only one variable at a time.</p>
<h2>Choose coffee by flavor</h2><p>Washed Ethiopian coffee often emphasizes floral and citrus notes, while natural processing can bring berry-like sweetness. Colombian coffees are excellent all-rounders with caramel, fruit and chocolate character. Ask our baristas to grind any Order66 coffee for your dripper.</p>
HTML, 'A practical V60 recipe using 20 grams of coffee and 320 grams of water.'],
    ['why-fresh-coffee-matters', 'Why Freshly Roasted Coffee Tastes Better', <<<'HTML'
<p>Roasting creates hundreds of aromatic compounds and traps carbon dioxide inside the coffee bean. From that moment the coffee begins to change. Understanding that timeline helps you buy, store and brew beans at their best.</p>
<h2>Fresh does not mean same-day</h2><p>Coffee usually needs a short resting period after roasting. Very fresh beans release so much gas that water struggles to extract flavor evenly. We normally recommend resting filter roasts for 7–14 days and espresso for 10–21 days.</p>
<h2>The useful flavor window</h2><p>Most of our coffees are expressive for four to eight weeks when stored well. There is no magical expiry date, but delicate floral and fruit aromas gradually soften as oxygen reaches the beans.</p>
<h2>How to store coffee</h2><p>Keep beans sealed, dry and away from heat and sunlight. A kitchen cupboard is better than a clear jar beside the oven. Grind only what you need immediately before brewing. Avoid the refrigerator, where moisture and food aromas can damage the coffee.</p>
<p>Every Order66 bag carries a roast date rather than only a distant best-before date, so you know exactly what you are brewing.</p>
HTML, 'Learn about resting coffee, its best flavor window and correct storage.'],
    ['espresso-vs-filter-roast', 'Espresso Roast vs Filter Roast: What Is the Difference?', <<<'HTML'
<p>The words “espresso roast” and “filter roast” describe how a roaster develops coffee for different brewing conditions. They are useful guidance, not strict rules: any coffee can technically be brewed by either method.</p>
<h2>Espresso needs easy extraction</h2><p>Espresso uses a small amount of water under pressure, so it can be difficult to extract evenly. We generally give espresso roasts a little more development. This builds sweetness, body and solubility while keeping the origin character intact.</p>
<h2>Filter highlights clarity</h2><p>Filter methods use more water and a longer contact time. A lighter filter profile can preserve floral, fruit and tea-like aromas. Our Ethiopia Guji is roasted this way for V60, AeroPress and batch brew.</p>
<h2>Can you swap them?</h2><p>Absolutely. Filter-roasted coffee can make a bright modern espresso, though it may need a finer grind and higher yield. Espresso roast can produce a rich filter cup, especially if you prefer chocolate and nut flavors. Taste matters more than the label.</p>
<p>At Order66, tell us your equipment and the flavors you enjoy. We will recommend a coffee and starting recipe rather than insisting on one correct style.</p>
HTML, 'How roast development changes sweetness, body and clarity for espresso and filter coffee.'],
    ['coffee-subscription-guide', 'How to Choose a Coffee Subscription', <<<'HTML'
<p>A coffee subscription keeps fresh beans arriving before the cupboard is empty. The best plan should match how much you brew, your preferred flavors and the equipment you use.</p>
<h2>Estimate how much coffee you need</h2><p>A 250-gram bag makes roughly 14–16 filter brews or 12–14 double espressos. One daily cup usually means two 250-gram bags per month; a two-person household may prefer four.</p>
<h2>Filter, espresso or discovery?</h2><p>Choose filter if you enjoy bright, aromatic single origins. Choose espresso for balanced coffees that are easy to dial in and work with milk. Our discovery option rotates between both and includes a simple recipe card.</p>
<h2>Whole bean or ground?</h2><p>Whole beans stay aromatic longer, but we can grind each delivery for V60, AeroPress, French press, moka pot or espresso. Accurate brewing details help us choose the right grind size.</p>
<p>Order66 subscriptions are roasted during the dispatch week and can be paused whenever you travel. If a coffee is not to your taste, tell us what you noticed and we will adjust the next selection.</p>
HTML, 'Choose the right coffee quantity, roast style and grind for a monthly subscription.'],
];

foreach ($posts as [$slug, $title, $content, $excerpt]) {
    $post_id = order66_upsert('post', $slug, $title, $content, $excerpt);
    wp_set_post_categories($post_id, [$category]);
    set_post_thumbnail($post_id, $hero_id);
}

foreach ([['post', 'hello-world'], ['page', 'sample-page']] as [$type, $slug]) {
    $placeholder = get_page_by_path($slug, OBJECT, $type);
    if ($placeholder && $placeholder->post_status !== 'trash') {
        wp_trash_post($placeholder->ID);
    }
}

update_option('blogname', 'Order66 Coffee Roasters');
update_option('blogdescription', 'Specialty coffee roasted in Kadıköy, Istanbul');
update_option('show_on_front', 'page');
update_option('page_on_front', $home);
update_option('page_for_posts', $journal);
update_option('permalink_structure', '/%postname%/');
update_option('timezone_string', 'Europe/Istanbul');
set_post_thumbnail($home, $hero_id);

$menu_name = 'Order66 Main Menu';
$menu = wp_get_nav_menu_object($menu_name);
$menu_id = $menu ? $menu->term_id : wp_create_nav_menu($menu_name);
foreach ([$home, $coffee, $about, $visit, $journal] as $page_id) {
    $present = wp_get_associated_nav_menu_items($page_id, 'post_type');
    if (!$present) {
        wp_update_nav_menu_item($menu_id, 0, [
            'menu-item-object-id' => $page_id,
            'menu-item-object' => 'page',
            'menu-item-status' => 'publish',
            'menu-item-type' => 'post_type',
            'menu-item-title' => get_the_title($page_id),
        ]);
    }
}

$locations = get_theme_mod('nav_menu_locations', []);
foreach (get_registered_nav_menus() as $location => $_description) {
    if (!isset($locations[$location])) {
        $locations[$location] = $menu_id;
    }
}
set_theme_mod('nav_menu_locations', $locations);
flush_rewrite_rules(false);

$css = <<<CSS
:root {
  --order66-ink: #241a12;
  --order66-muted: #6f6256;
  --order66-cream: #f6f0e7;
  --order66-paper: #fffaf2;
  --order66-caramel: #b96032;
  --order66-dark: #2d2118;
  --order66-line: #ddcfbf;
}

html { scroll-behavior: smooth; }
body {
  background: var(--order66-cream);
  color: var(--order66-ink);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.wp-site-blocks > header {
  position: sticky;
  top: 0;
  z-index: 50;
  border-bottom: 1px solid rgba(76, 53, 37, .14);
  background: rgba(255, 250, 242, .92);
  backdrop-filter: blur(14px);
}
.wp-site-blocks > header > .wp-block-group {
  padding-top: 18px !important;
  padding-bottom: 18px !important;
}
header .wp-block-site-title a {
  color: var(--order66-ink);
  font-size: clamp(1.1rem, 2vw, 1.45rem);
  font-weight: 800;
  letter-spacing: -.03em;
  text-decoration: none;
}
header .wp-block-navigation-item__content {
  color: #4f4136;
  font-size: .84rem;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
}
header .wp-block-navigation-item__content:hover { color: var(--order66-caramel); }

main { margin-block-start: 0 !important; }
main > .wp-block-group { padding-top: clamp(2.5rem, 6vw, 5rem) !important; }
.home main > .wp-block-group { padding-top: 0 !important; }
.home .wp-block-post-title,
.home main .wp-block-post-featured-image { display: none; }
.entry-content { color: #3f3329; }
.entry-content > *:not(.alignfull) { max-width: 780px; }
.entry-content p,
.wp-block-post-content p { font-size: 1.08rem; line-height: 1.78; }
.entry-content h1,
.entry-content h2,
.entry-content h3,
.wp-block-post-title {
  color: var(--order66-ink);
  font-family: Georgia, "Times New Roman", serif;
  letter-spacing: -.035em;
}
.wp-block-post-title { font-size: clamp(2.6rem, 7vw, 5.2rem); line-height: .98; }
.entry-content h2 { margin-top: 2.5em; font-size: clamp(2rem, 5vw, 3.3rem); line-height: 1.05; }
.entry-content > .order66-page-lead { margin-top: .4em; }
.entry-content h3 { margin-top: 1.9em; font-size: 1.45rem; }
.entry-content a { color: var(--order66-caramel); text-decoration-thickness: 1px; text-underline-offset: 4px; }
.entry-content li { margin-bottom: .7rem; line-height: 1.65; }

.home .entry-content > .order66-hero:first-child {
  width: min(1380px, calc(100% - 32px));
  min-height: min(720px, calc(100vh - 110px));
  margin: 16px auto 0;
  border-radius: 30px;
  overflow: hidden;
  box-shadow: 0 26px 80px rgba(44, 29, 18, .2);
  background-position: center;
  background-size: cover;
  display: flex;
  align-items: center;
  background-image: linear-gradient(90deg, rgba(24,15,10,.9), rgba(24,15,10,.18)), url('{$hero_url}') !important;
}
.order66-hero-content { width: min(1140px, calc(100% - 48px)); margin: 0 auto; }
.order66-hero-content > * { max-width: 660px; }
.order66-hero h1 { margin: 0; color: white; font-size: clamp(3.2rem, 8vw, 7rem); line-height: .92; }
.order66-hero p { color: rgba(255,255,255,.87); font-size: clamp(1rem, 2vw, 1.25rem); }
.order66-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.order66-actions a {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  padding: 0 22px;
  border: 1px solid rgba(255,255,255,.5);
  border-radius: 999px;
  color: white;
  font-size: .92rem;
  font-weight: 750;
  letter-spacing: .03em;
  text-decoration: none;
}
.order66-actions a:first-child { border-color: var(--order66-caramel); background: var(--order66-caramel); }
.order66-actions a:hover { transform: translateY(-2px); }

.order66-section { max-width: 1180px !important; margin: 0 auto; padding: clamp(5rem, 10vw, 9rem) 24px; }
.order66-intro { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 8vw; align-items: end; }
.order66-intro h2 { margin: 0; }
.order66-intro > p:last-child { margin: 0; color: var(--order66-muted); font-size: 1.2rem; }
.order66-eyebrow {
  margin: 0 0 18px !important;
  color: var(--order66-caramel) !important;
  font-size: .76rem !important;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.order66-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 48px; }
.order66-card {
  min-height: 270px;
  padding: clamp(1.7rem, 4vw, 2.5rem);
  border: 1px solid var(--order66-line);
  border-radius: 22px;
  background: var(--order66-paper);
  transition: transform .2s ease, box-shadow .2s ease;
}
.order66-card:hover { transform: translateY(-5px); box-shadow: 0 18px 45px rgba(59, 40, 25, .1); }
.order66-card > span { color: var(--order66-caramel); font-size: .75rem; font-weight: 800; letter-spacing: .12em; }
.order66-card h3 { margin: 60px 0 10px; font-size: 1.65rem; }
.order66-card p { margin: 0; color: var(--order66-muted); font-size: 1rem; }
.order66-band {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, .6fr);
  gap: clamp(2rem, 7vw, 7rem);
  max-width: 1260px !important;
  margin: 0 auto clamp(5rem, 10vw, 9rem);
  padding: clamp(3rem, 7vw, 6rem);
  border-radius: 30px;
  background: var(--order66-dark);
  color: #e9ded1;
}
.order66-band h2 { margin-top: 0; color: white; }
.order66-band aside { align-self: end; padding: 28px; border: 1px solid rgba(255,255,255,.16); border-radius: 18px; }
.order66-band aside strong { color: white; font-size: 1.1rem; }
.order66-band aside p { color: #cbbcaf; font-size: .96rem; }
.order66-band aside a { color: #f1a36f; font-weight: 750; }

.blog .wp-block-post-template,
.archive .wp-block-post-template { gap: 24px; }
.blog .wp-block-post,
.archive .wp-block-post {
  padding: 28px;
  border: 1px solid var(--order66-line);
  border-radius: 20px;
  background: var(--order66-paper);
}
.single-post .wp-block-post-featured-image img { max-height: 620px; border-radius: 26px; object-fit: cover; }

footer,
footer .wp-block-group { margin-block-start: 0; background: #1e1712 !important; color: #d8cabd; }
footer .wp-block-site-title a { color: white; text-decoration: none; }
footer .wp-block-site-tagline { color: #aa9b8e; }
footer nav,
footer .has-small-font-size { display: none !important; }

@media (max-width: 760px) {
  .wp-site-blocks > header { position: relative; }
  .home .entry-content > .order66-hero:first-child { width: calc(100% - 20px); border-radius: 20px; }
  .order66-intro,
  .order66-grid,
  .order66-band { grid-template-columns: 1fr; }
  .order66-card { min-height: 230px; }
  .order66-card h3 { margin-top: 38px; }
  .order66-band { margin-inline: 10px; border-radius: 22px; }
}
CSS;

$custom_css = wp_update_custom_css_post($css);
if (is_wp_error($custom_css)) {
    throw new RuntimeException($custom_css->get_error_message());
}

echo "Seeded Order66 Coffee Roasters\n";
