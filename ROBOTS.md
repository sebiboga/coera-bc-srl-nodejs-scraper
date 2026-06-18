# robots.txt — COERA BC SRL

Sursa: https://www.co-era.com/robots.txt

```
User-agent: *
Disallow: /img/
```

## Analiză

- **Doar `/img/` este `Disallow`** — restul site-ului, inclusiv `/careers/`, e complet permis
- Niciun Crawl-Delay, niciun sitemap declarat

## Politica scraper-ului

Risc minim. Scraper-ul:
- Face un singur GET la `https://www.co-era.com/careers/`
- Nu accesează `/img/` (deja respectat — nu avem nevoie de imagini)
- Nu accesează paginile individuale de job (URL-urile sunt deja extrase din pagina principală)
- User-Agent identificabil: `job_seeker_ro_spider`
- Niciun concurrency, niciun retry agresiv

## Diferență față de EPAM template

EPAM (template-ul de la care a fost derivat acest scraper) are `Disallow: /api/*` și `Disallow: /*/vacancy/*` în robots.txt. COERA permite scraping pe tot site-ul cu excepția imaginilor.
