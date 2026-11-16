# 🐗 Zwijnenbier — Najaarsweekend

Bierteller voor het weekend. Iedereen maakt een account (naam + korte code), tikt op **Proost! +1** bij elk biertje, en het dashboard laat live de stand, het podium, badges en een activiteitenfeed zien.

- **Frontend:** `public/` (HTML/CSS/JS, geen build-stap)
- **Backend:** `netlify/functions/api.mjs` (één Netlify Function op `/api/*`)
- **Database:** Netlify Blobs, de ingebouwde opslag van Netlify. Niks extra's in te stellen.

## Online zetten (GitHub → Netlify)

1. Maak op GitHub een nieuwe (privé) repository, bijvoorbeeld `zwijnenbier`.
2. Push deze map:
   ```bash
   git remote add origin https://github.com/<jouw-account>/zwijnenbier.git
   git push -u origin main
   ```
3. Ga naar [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project → GitHub** en kies de repo.
4. De instellingen worden uit `netlify.toml` gelezen (publish: `public`, functions: `netlify/functions`). Klik **Deploy**.
5. Klaar. Deel de `*.netlify.app`-link in de groepsapp. Elke `git push` deployt automatisch opnieuw.

Optioneel: zet onder *Site configuration → Environment variables* een `SESSION_SECRET` (willekeurige lange tekst). Zonder deze variabele maakt de app er zelf één aan en bewaart die in Blobs.

## Lokaal draaien

```bash
npm install
npx netlify-cli dev        # → http://localhost:8888
```

## Spelregels in de app

| Moment | Wat gebeurt er |
|---|---|
| Eerste biertje van de dag (dag loopt van 06:00 tot 06:00) | Pop-up met compliment + confetti |
| 2+ biertjes binnen een uur | Pop-up met een gepast compliment (2, 3 of 4+) |
| 2 uur niks gedronken | Aanmoedigende pop-up (één keer per droge periode) |
| Badge verdiend | Pop-up met de badge |
| Verkeerd getikt | Laatste biertje is 10 minuten lang terug te draaien |

Badges: Openingsschot, Haantje de voorste, Ochtendzwijn, Kanonnier, Nachtbraker, Volhouder, Wildzwijn (10), Halve kist (12), Volle kist (24).
