<?php
/**
 * Plugin Name: Iran Analytics
 * Description: Loads the first-party Iran Analytics tracker without LiteSpeed minify/combine.
 * Version: 1.1.0
 * Author: Iran Analytics
 */

if (!defined('ABSPATH')) {
  exit;
}

/**
 * Configure in wp-config.php or filter:
 *   define('IRAN_ANALYTICS_SRC', 'https://stats.homamigration.net/t.js');
 *   define('IRAN_ANALYTICS_SITE', 'ia_YOUR_PUBLIC_KEY');
 */
function iran_analytics_src() {
  if (defined('IRAN_ANALYTICS_SRC')) {
    return IRAN_ANALYTICS_SRC;
  }
  return apply_filters('iran_analytics_src', 'https://stats.homamigration.net/t.js');
}

function iran_analytics_site_key() {
  if (defined('IRAN_ANALYTICS_SITE')) {
    return IRAN_ANALYTICS_SITE;
  }
  return apply_filters('iran_analytics_site', '');
}

function iran_analytics_api_origin() {
  $src = iran_analytics_src();
  $parts = wp_parse_url($src);
  if (empty($parts['scheme']) || empty($parts['host'])) {
    return '';
  }
  $origin = $parts['scheme'] . '://' . $parts['host'];
  if (!empty($parts['port'])) {
    $origin .= ':' . $parts['port'];
  }
  return $origin;
}

add_action('wp_enqueue_scripts', function () {
  $key = iran_analytics_site_key();
  if (!$key) {
    return;
  }
  $src = iran_analytics_src();
  $handle = 'iran-analytics';
  wp_enqueue_script($handle, $src, [], null, [
    'strategy' => 'defer',
    'in_footer' => true,
  ]);
  wp_script_add_data($handle, 'data-site', $key);
  wp_script_add_data($handle, 'data-api', iran_analytics_api_origin());
  wp_script_add_data($handle, 'data-no-optimize', '1');
  wp_script_add_data($handle, 'data-no-minify', '1');
}, 1);

// Print data-* attributes (core does not emit wp_script_add_data for arbitrary keys).
add_filter('script_loader_tag', function ($tag, $handle, $src) {
  if ($handle !== 'iran-analytics') {
    return $tag;
  }
  $key = esc_attr(iran_analytics_site_key());
  $api = esc_attr(iran_analytics_api_origin());
  return sprintf(
    '<script defer src="%s" data-site="%s" data-api="%s" data-no-optimize="1" data-no-minify="1"></script>' . "\n",
    esc_url($src),
    $key,
    $api
  );
}, 10, 3);

// LiteSpeed Cache: never minify / combine / delay this script.
add_filter('litespeed_optimize_js_excludes', function ($excludes) {
  $excludes[] = 'stats.homamigration.net/t.js';
  $excludes[] = 'iran-analytics';
  $excludes[] = 't.js';
  return $excludes;
});
add_filter('litespeed_optm_js_defer_exc', function ($excludes) {
  $excludes[] = 'stats.homamigration.net/t.js';
  $excludes[] = 't.js';
  return $excludes;
});
