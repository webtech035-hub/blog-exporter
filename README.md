# Blog Crawler & Exporter (Next.js)

Enter a website URL, crawl its blog posts (title, featured image, body with images, description, date, author, tags) and download them in a format your platform can import: **WordPress, Wix, Squarespace, Shopify, Webflow, Ghost**, or generic **CSV / JSON**.

## Requirements

- Node.js **18.18 or newer** (check with `node -v`)
- npm (comes with Node)

## Run locally

```bash
npm install
npm run dev
```

Open **http://localhost:3000**.

Production build test:

```bash
npm run build
npm start
```

## Deploy to Vercel

**Option A: GitHub (recommended)**

1. Create a new GitHub repository and push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "Blog exporter"
   git branch -M main
   git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
   git push -u origin main
   ```
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Leave every setting at its default (Vercel detects Next.js automatically) and click **Deploy**.

**Option B: Vercel CLI**

```bash
npm i -g vercel
vercel        # follow the prompts
vercel --prod # publish to production
```

No environment variables are needed.

## How to use

1. Paste a site or blog URL (for example `https://example.com/blog`).
2. Set **Max** (start with 3 to 5 posts to test).
3. Click **Crawl blogs** and wait for the table to fill.
4. Click an export button. The file downloads and a short import tip appears.

## How it works

- **WordPress sites:** posts are read from the site's REST API (`/wp-json/wp/v2/posts`), which gives the cleanest data.
- **Any other site:** post URLs are found from the sitemap, then the RSS feed, then page links. Each post page is then scraped (`og:image` for the cover, the article body, `og:description`, published date).
- All page requests go through `/api/proxy`, a server-side route that avoids browser CORS limits. It blocks private/internal addresses and only allows http/https on ports 80 and 443.

## Importing the files

| Platform | File | How to import |
|---|---|---|
| WordPress | `.xml` | Tools → Import → WordPress. Tick "Download and import file attachments". |
| Wix | `.xml` | Blog dashboard → Import → WordPress. |
| Squarespace | `.xml` | Settings → Website → Import & Export → Import → WordPress. |
| Shopify | `.csv` | No native blog CSV import. Use an app such as Matrixify (Blog Posts). |
| Webflow | `.csv` | Create the CMS collection first, then Import CSV and map the columns to your fields. |
| Ghost | `.json` | Settings → Labs → Import content. |

Import steps and menu names change over time. Always test with 2 to 3 posts before importing everything.

## Limitations

- **Images stay hosted on the original site.** The exports link to the original image URLs; files are not copied. If the source removes them, they will break.
- **No guarantee of a pixel-identical import.** Each platform has its own importer and may drop or change some fields.
- **Embedded video and scripts are removed** from post bodies.
- **Unusual site layouts** may not scrape cleanly. Edit the selector list in `scrape()` in `lib/crawler.js` to fit them.
- **Vercel's free plan limits how long a function can run.** Each proxy call fetches only one page, so this is normally fine. If you see timeouts, try a smaller **Max**.
- **The proxy is public once deployed.** Consider adding rate limiting (Vercel Firewall) or a password if you share the URL widely.
- Only crawl and import content you own or have permission to copy.

## Project structure

```
app/
  layout.js            Page shell and metadata
  page.js              User interface
  globals.css          Styles
  api/proxy/route.js   Server-side fetch proxy (with SSRF protection)
lib/
  crawler.js           REST + sitemap/RSS + HTML scraping
  exporters.js         WordPress/Wix/Squarespace/Shopify/Webflow/Ghost/CSV/JSON builders
```

## Troubleshooting

- **"No posts found":** the site may block automated requests or render posts with JavaScript only. Try the blog page URL, such as `https://site.com/blog`.
- **Images missing in the preview:** some sites block hotlinking. The exported file still contains the image URLs.
- **`npm install` fails:** update Node to 18.18 or newer.
