# Opsima Sitemap Monitor

Daily cron job (10PM Israel time) that monitors the Opsima blog sitemap and emails new post notifications to the client.

## How it works

1. Fetches `https://opsima.com/blog/wp-sitemap-posts-post-1.xml`
2. Compares against `scripts/known-urls.json` (persisted state)
3. For each new URL, scrapes the SEO title + meta description
4. Sends an HTML email via SendGrid
5. Commits updated `known-urls.json` back to the repo

## Setup

Add `SENDGRID_API_KEY` as a GitHub Actions secret in this repo.

## First run

Trigger manually via **Actions → Sitemap Monitor → Run workflow**.  
The first run bootstraps the baseline (no email sent). Subsequent runs detect new posts.
