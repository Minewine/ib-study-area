<?php
// Local dev test host for the PHP API: serves the repo root and maps
// /api/api.php onto server/api.php so the app pages + study pages can
// exercise auth/state sync without touching the deployed host.
//
//   NEVAIB_DATA_DIR=/tmp/nevaib-test-data php -S 127.0.0.1:8018 -t . tools/dev_server.php
//
// (api.php honours NEVAIB_DATA_DIR; without it, data lands in ~/nevaib-data
// as on the real host. Static files are served by the built-in server.)
$uri = urldecode((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
if ($uri === '/api/api.php') {
    require dirname(__DIR__) . '/server/api.php';
    return true;
}
return false; // let php -S serve static files
