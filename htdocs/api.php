<?php
// Zwijnenbier API — PHP + MySQL (InfinityFree). Aanroepen via api.php?a=<actie>
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (!is_file(__DIR__ . '/config.php')) {
    out(500, ['error' => 'config.php ontbreekt. Kopieer config.example.php naar config.php en vul je database-gegevens in.']);
}
require __DIR__ . '/config.php';

const TZ_NAME = 'Europe/Amsterdam';
const DAY_START_HOUR = 6;        // een "dag" loopt van 06:00 tot 06:00
const HOUR = 3600000;
const COOLDOWN = 15000;          // tegen per ongeluk dubbel tikken
const UNDO_WINDOW = 600000;      // laatste bier 10 min lang terug te draaien
const SESSION_AGE = 2592000;     // 30 dagen ingelogd blijven

const BADGES = [
    ['id' => 'openingsschot', 'icon' => '🎯', 'name' => 'Openingsschot', 'desc' => 'Het allereerste bier van het weekend'],
    ['id' => 'haantje', 'icon' => '🐓', 'name' => 'Haantje de voorste', 'desc' => 'Als eerste van de rotte een bier op een dag'],
    ['id' => 'ochtendzwijn', 'icon' => '🌅', 'name' => 'Ochtendzwijn', 'desc' => 'Een bier vóór 12:00'],
    ['id' => 'kanonnier', 'icon' => '💥', 'name' => 'Kanonnier', 'desc' => '3 bier binnen één uur'],
    ['id' => 'nachtbraker', 'icon' => '🌙', 'name' => 'Nachtbraker', 'desc' => 'Een bier tussen 02:00 en 06:00'],
    ['id' => 'volhouder', 'icon' => '🔁', 'name' => 'Volhouder', 'desc' => 'Op 3 verschillende dagen gedronken'],
    ['id' => 'wildzwijn', 'icon' => '🐗', 'name' => 'Wildzwijn', 'desc' => '10 bier in totaal'],
    ['id' => 'halvekist', 'icon' => '📦', 'name' => 'Halve kist', 'desc' => '12 bier in totaal'],
    ['id' => 'kist', 'icon' => '🏆', 'name' => 'Volle kist', 'desc' => '24 bier in totaal'],
];

// ---------- Helpers ----------
function out(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function nowMs(): int
{
    return (int) floor(microtime(true) * 1000);
}
function body(): array
{
    $d = json_decode((string) file_get_contents('php://input'), true);
    return is_array($d) ? $d : [];
}
function cleanName($n): string
{
    return trim((string) preg_replace('/\s+/u', ' ', (string) $n));
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $opts = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];
    try {
        if (defined('DB_SQLITE') && DB_SQLITE) {
            // Alleen voor lokaal testen
            $pdo = new PDO('sqlite:' . DB_SQLITE, null, null, $opts);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('CREATE TABLE IF NOT EXISTS zb_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, pin_hash TEXT NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)');
            $pdo->exec('CREATE TABLE IF NOT EXISTS zb_beers (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES zb_users(id) ON DELETE CASCADE, ts INTEGER NOT NULL)');
            $pdo->exec('CREATE INDEX IF NOT EXISTS idx_user_ts ON zb_beers (user_id, ts)');
        } else {
            $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, $opts);
            $pdo->exec('CREATE TABLE IF NOT EXISTS zb_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(40) NOT NULL,
                name_key VARCHAR(40) NOT NULL UNIQUE,
                pin_hash VARCHAR(255) NOT NULL,
                fails INT NOT NULL DEFAULT 0,
                locked_until BIGINT NOT NULL DEFAULT 0,
                created_at BIGINT NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
            $pdo->exec('CREATE TABLE IF NOT EXISTS zb_beers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                ts BIGINT NOT NULL,
                INDEX idx_user_ts (user_id, ts),
                CONSTRAINT fk_beer_user FOREIGN KEY (user_id) REFERENCES zb_users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        }
    } catch (PDOException $e) {
        error_log('DB: ' . $e->getMessage());
        out(500, ['error' => 'Kan de database niet bereiken. Klopt config.php?']);
    }
    return $pdo;
}

// ---------- Tijd ----------
function tz(): DateTimeZone
{
    static $z = null;
    return $z ??= new DateTimeZone(TZ_NAME);
}
function localDate(int $ms): DateTimeImmutable
{
    return (new DateTimeImmutable('@' . intdiv($ms, 1000)))->setTimezone(tz());
}
function dayKey(int $ms): string
{
    return localDate($ms - DAY_START_HOUR * HOUR)->format('Y-m-d');
}
function localHour(int $ms): int
{
    return (int) localDate($ms)->format('G');
}

// ---------- Data ----------
function allUsers(): array
{
    return db()->query('SELECT id, name FROM zb_users')->fetchAll();
}
function allBeers(): array
{
    return db()->query('SELECT user_id, ts FROM zb_beers ORDER BY ts, id')->fetchAll();
}
function userBeers(int $uid): array
{
    $st = db()->prepare('SELECT id, ts FROM zb_beers WHERE user_id = ? ORDER BY ts, id');
    $st->execute([$uid]);
    return $st->fetchAll();
}

// Loopt chronologisch door alle bier: badges per gebruiker + feed-info.
function analyse(array $beers): array
{
    $badges = [];
    $seenDays = [];
    $perUser = [];
    $enriched = [];
    if ($beers) $badges[(int) $beers[0]['user_id']]['openingsschot'] = true;

    foreach ($beers as $b) {
        $uid = (int) $b['user_id'];
        $ts = (int) $b['ts'];
        $dk = dayKey($ts);
        $h = localHour($ts);
        if (!isset($seenDays[$dk])) { $seenDays[$dk] = true; $badges[$uid]['haantje'] = true; }
        if ($h >= 6 && $h < 12) $badges[$uid]['ochtendzwijn'] = true;
        if ($h >= 2 && $h < 6) $badges[$uid]['nachtbraker'] = true;

        $perUser[$uid] ??= ['ts' => [], 'days' => []];
        $perUser[$uid]['ts'][] = $ts;
        $perUser[$uid]['days'][$dk] = ($perUser[$uid]['days'][$dk] ?? 0) + 1;
        $list = $perUser[$uid]['ts'];
        $n = count($list);
        $inHour = 0;
        for ($i = $n - 1; $i >= 0 && $ts - $list[$i] < HOUR; $i--) $inHour++;

        if ($inHour >= 3) $badges[$uid]['kanonnier'] = true;
        if (count($perUser[$uid]['days']) >= 3) $badges[$uid]['volhouder'] = true;
        if ($n >= 10) $badges[$uid]['wildzwijn'] = true;
        if ($n >= 12) $badges[$uid]['halvekist'] = true;
        if ($n >= 24) $badges[$uid]['kist'] = true;

        $enriched[] = ['userId' => $uid, 'ts' => $ts, 'day' => $dk, 'inHour' => $inHour, 'dayNum' => $perUser[$uid]['days'][$dk]];
    }
    return ['badges' => $badges, 'enriched' => $enriched];
}

function badgeIds(array $set): array
{
    $ids = [];
    foreach (BADGES as $b) if (isset($set[$b['id']])) $ids[] = $b['id'];
    return $ids;
}

function buildState(): array
{
    $users = allUsers();
    $now = nowMs();
    $today = dayKey($now);
    ['badges' => $badges, 'enriched' => $enriched] = analyse(allBeers());

    $stats = [];
    $names = [];
    foreach ($users as $u) {
        $id = (int) $u['id'];
        $names[$id] = $u['name'];
        $stats[$id] = [
            'id' => $id, 'name' => $u['name'], 'total' => 0, 'today' => 0, 'lastHour' => 0, 'lastTs' => null,
            'badges' => badgeIds($badges[$id] ?? []),
        ];
    }
    $todayAll = 0;
    $lastHourAll = 0;
    foreach ($enriched as $b) {
        if (!isset($stats[$b['userId']])) continue;
        $s = &$stats[$b['userId']];
        $s['total']++;
        $s['lastTs'] = $b['ts'];
        if ($b['day'] === $today) { $s['today']++; $todayAll++; }
        if ($now - $b['ts'] < HOUR) { $s['lastHour']++; $lastHourAll++; }
        unset($s);
    }
    $ranked = array_values($stats);
    usort($ranked, function ($a, $b) {
        return [$b['total'], $a['lastTs'] ?? PHP_INT_MAX, $a['name']] <=> [$a['total'], $b['lastTs'] ?? PHP_INT_MAX, $b['name']];
    });

    $feed = [];
    foreach (array_reverse(array_slice($enriched, -20)) as $b) {
        $feed[] = ['name' => $names[$b['userId']] ?? '?', 'userId' => $b['userId'], 'ts' => $b['ts'], 'inHour' => $b['inHour'], 'dayNum' => $b['dayNum']];
    }

    $active = 0;
    foreach ($ranked as $u) if ($u['today'] > 0) $active++;

    return [
        'now' => $now,
        'today' => $today,
        'totals' => ['all' => count($enriched), 'today' => $todayAll, 'lastHour' => $lastHourAll, 'activeToday' => $active],
        'users' => $ranked,
        'feed' => $feed,
        'badges' => BADGES,
    ];
}

// ---------- Sessies (ondertekend cookie) ----------
function appSecret(): string
{
    $s = defined('APP_SECRET') ? (string) APP_SECRET : '';
    if ($s === '' || $s === 'verander-mij') $s = hash('sha256', 'zwijnenbier|' . (defined('DB_PASS') ? DB_PASS : '') . '|' . __DIR__);
    return $s;
}
function b64u(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}
function sign(string $data): string
{
    return b64u(hash_hmac('sha256', $data, appSecret(), true));
}
function isHttps(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
function setSession(?int $uid): void
{
    $value = '';
    $expires = time() - 3600;
    if ($uid) {
        $data = $uid . '.' . (time() + SESSION_AGE);
        $value = $data . '.' . sign($data);
        $expires = time() + SESSION_AGE;
    }
    setcookie('zwijn', $value, [
        'expires' => $expires, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => isHttps(),
    ]);
}
function currentUser(): ?array
{
    $parts = explode('.', (string) ($_COOKIE['zwijn'] ?? ''));
    if (count($parts) !== 3) return null;
    [$id, $exp, $sig] = $parts;
    if (!hash_equals(sign("$id.$exp"), $sig) || (int) $exp < time()) return null;
    $st = db()->prepare('SELECT id, name FROM zb_users WHERE id = ?');
    $st->execute([(int) $id]);
    $u = $st->fetch();
    return $u ? ['id' => (int) $u['id'], 'name' => $u['name']] : null;
}
function requireUser(): array
{
    $u = currentUser();
    if (!$u) out(401, ['error' => 'Log eerst in.']);
    return $u;
}

// ---------- Routes ----------
$a = (string) ($_GET['a'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($a === 'state' && $method === 'GET') out(200, buildState());

    if ($a === 'me' && $method === 'GET') {
        $u = currentUser();
        if (!$u) out(200, ['user' => null]);
        $beers = array_map(fn($b) => ['ts' => (int) $b['ts'], 'day' => dayKey((int) $b['ts'])], userBeers($u['id']));
        out(200, ['user' => $u, 'beers' => $beers, 'today' => dayKey(nowMs())]);
    }

    if ($method !== 'POST') out(404, ['error' => 'Niet gevonden']);

    if ($a === 'register') {
        $b = body();
        $name = cleanName($b['name'] ?? '');
        $pin = (string) ($b['pin'] ?? '');
        $len = mb_strlen($name);
        if ($len < 2 || $len > 20 || !preg_match("/^[\\p{L}\\p{N} _.'-]+$/u", $name))
            out(400, ['error' => 'Kies een naam van 2–20 tekens (letters, cijfers, spatie).']);
        if (mb_strlen($pin) < 4 || mb_strlen($pin) > 12)
            out(400, ['error' => 'Je wachtwoord moet 4 tot 12 tekens zijn.']);
        try {
            db()->prepare('INSERT INTO zb_users (name, name_key, pin_hash, created_at) VALUES (?, ?, ?, ?)')
                ->execute([$name, mb_strtolower($name), password_hash($pin, PASSWORD_DEFAULT), nowMs()]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') out(409, ['error' => 'Die naam is al bezet. Kies een andere of log in.']);
            throw $e;
        }
        $id = (int) db()->lastInsertId();
        setSession($id);
        out(201, ['user' => ['id' => $id, 'name' => $name]]);
    }

    if ($a === 'login') {
        $b = body();
        $name = cleanName($b['name'] ?? '');
        $pin = (string) ($b['pin'] ?? '');
        $st = db()->prepare('SELECT * FROM zb_users WHERE name_key = ?');
        $st->execute([mb_strtolower($name)]);
        $u = $st->fetch();
        if ($u && (int) $u['locked_until'] > nowMs())
            out(429, ['error' => 'Te vaak fout geprobeerd. Wacht een minuutje en probeer opnieuw.']);
        if (!$u || !password_verify($pin, $u['pin_hash'])) {
            if ($u) {
                $fails = (int) $u['fails'] + 1;
                $lock = $fails >= 5 ? nowMs() + 60000 : 0;
                db()->prepare('UPDATE zb_users SET fails = ?, locked_until = ? WHERE id = ?')
                    ->execute([$fails >= 5 ? 0 : $fails, $lock, $u['id']]);
            }
            out(401, ['error' => 'Naam of wachtwoord klopt niet.']);
        }
        db()->prepare('UPDATE zb_users SET fails = 0, locked_until = 0 WHERE id = ?')->execute([$u['id']]);
        setSession((int) $u['id']);
        out(200, ['user' => ['id' => (int) $u['id'], 'name' => $u['name']]]);
    }

    if ($a === 'logout') {
        setSession(null);
        out(200, ['ok' => true]);
    }

    if ($a === 'beer') {
        $u = requireUser();
        $now = nowMs();
        $mine = userBeers($u['id']);
        $last = end($mine);
        if ($last && $now - (int) $last['ts'] < COOLDOWN)
            out(429, ['error' => 'Rustig aan, die vorige is net geteld! 🐗']);

        $before = analyse(allBeers())['badges'][$u['id']] ?? [];
        db()->prepare('INSERT INTO zb_beers (user_id, ts) VALUES (?, ?)')->execute([$u['id'], $now]);
        $after = analyse(allBeers())['badges'][$u['id']] ?? [];
        $newBadges = array_values(array_filter(BADGES, fn($b) => isset($after[$b['id']]) && !isset($before[$b['id']])));

        $mine[] = ['ts' => $now];
        $today = dayKey($now);
        $todayCount = 0;
        $hourCount = 0;
        foreach ($mine as $m) {
            if (dayKey((int) $m['ts']) === $today) $todayCount++;
            if ($now - (int) $m['ts'] < HOUR) $hourCount++;
        }
        out(201, [
            'total' => count($mine), 'todayCount' => $todayCount, 'hourCount' => $hourCount,
            'firstOfDay' => $todayCount === 1, 'newBadges' => $newBadges,
        ]);
    }

    if ($a === 'undo') {
        $u = requireUser();
        $mine = userBeers($u['id']);
        $last = end($mine);
        if (!$last) out(404, ['error' => 'Er is niks om terug te draaien.']);
        if (nowMs() - (int) $last['ts'] > UNDO_WINDOW)
            out(400, ['error' => 'Alleen een bier van de laatste 10 minuten kan terug.']);
        db()->prepare('DELETE FROM zb_beers WHERE id = ?')->execute([$last['id']]);
        out(200, ['ok' => true]);
    }

    out(404, ['error' => 'Niet gevonden']);
} catch (Throwable $e) {
    error_log('Zwijnenbier: ' . $e->getMessage());
    out(500, ['error' => 'Er ging iets mis in het bos. Probeer het nog eens.']);
}
