# 🐗 Zwijnenbier — Najaarsweekend

Bierteller voor het weekend. Iedereen maakt een account (naam + korte code), tikt op **Proost! +1** bij elk bier, en het dashboard laat live de stand van de rotte zien: podium, badges, activiteitenfeed en wie het zielige zwijn is.

- **Frontend:** `htdocs/index.html`, `styles.css`, `app.js` (geen build-stap)
- **Backend:** `htdocs/api.php` (PHP 8)
- **Database:** MySQL. De tabellen (`zb_users`, `zb_beers`) worden automatisch aangemaakt bij het eerste bezoek, dus de stand begint op nul.

## Online zetten op InfinityFree

### 1. Account en database
1. Maak een account op [infinityfree.com](https://www.infinityfree.com) en maak een hosting-account aan met een (gratis) subdomein, bijv. `zwijnenbier.infinityfreeapp.com`.
2. Open het **Control Panel → MySQL Databases** en maak een database aan (bijv. `zwijnenbier`).
3. Noteer: *MySQL Host Name*, *MySQL DB Name*, *MySQL User Name* en het wachtwoord (staat bij *Account → Hosting account → Password*).

### 2. config.php maken
Kopieer `htdocs/config.example.php` naar `config.php` en vul de gegevens in. **Dit bestand gaat niet naar GitHub** (staat in `.gitignore`), dus je uploadt het één keer handmatig via de **File Manager** van InfinityFree naar de map `htdocs/`.

### 3. Bestanden uploaden
Kies één van de twee:

**a) Automatisch via GitHub (aanbevolen).** Elke `git push` zet de site online.
1. Zoek in InfinityFree onder *Account → FTP Details* je FTP-hostname (bijv. `ftpupload.net`), username en wachtwoord.
2. Ga op GitHub naar de repo → **Settings → Secrets and variables → Actions → New repository secret** en maak:
   - `FTP_SERVER` → bijv. `ftpupload.net`
   - `FTP_USERNAME` → bijv. `if0_12345678`
   - `FTP_PASSWORD` → je hosting-wachtwoord
3. Ga naar **Actions → Deploy naar InfinityFree → Run workflow** (of push iets). De inhoud van `htdocs/` wordt geüpload.

**b) Handmatig.** Upload alle bestanden uit `htdocs/` via de File Manager of met FileZilla naar de map `htdocs/` op de server.

### 4. Klaar
Open je subdomein. Nog niemand is ingelogd en alle scores staan op nul. Deel de link in de groepsapp.

> Opnieuw beginnen? Leeg in phpMyAdmin de tabellen `zb_beers` (alleen scores) of ook `zb_users` (alle accounts).

## Spelregels in de app

| Moment | Wat gebeurt er |
|---|---|
| Eerste bier van de dag (dag loopt van 06:00 tot 06:00) | Pop-up met compliment + confetti |
| 2+ bier binnen een uur | Pop-up met een gepast compliment (2, 3 of 4+) |
| 2 uur niks gedronken | Aanmoedigende pop-up (één keer per droge periode) |
| Je komt op het podium of stijgt een podiumplek | 🦋 Pilsvlinder-melding |
| Laatste plek | Label "🥺 Zielig zwijn" in de stand |
| Badge verdiend | Pop-up met de badge |
| Verkeerd getikt | Laatste bier is 10 minuten lang terug te draaien |

Badges: Openingsschot, Haantje de voorste, Ochtendzwijn, Kanonnier, Nachtbraker, Volhouder, Wildzwijn (10), Halve kist (12), Volle kist (24).
