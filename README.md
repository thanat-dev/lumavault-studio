---
title: LumaVault Studio
emoji: 📦
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# LumaVault Studio

Premium local-first Facebook media extraction, download, and FFmpeg render studio.

## Live URLs

Full server deployment with Node and FFmpeg:

```text
https://huggingface.co/spaces/Nash1372/lumavault-studio
```

Direct app endpoint:

```text
https://nash1372-lumavault-studio.hf.space
```

Static GitHub Pages UI:

```text
https://thanat-dev.github.io/lumavault-studio/
```

## Features

- Paste a Facebook URL and page source that the user can access.
- Extract direct MP4 and audio candidates.
- Rank the best downloadable choice.
- Render MP4 variants through FFmpeg.
- Render MP3 audio.
- Show render progress percentage and FFmpeg speed.
- Run locally, on Docker, or on Hugging Face Spaces.

## Project Progress

Current completion: **38%**

The detailed roadmap and weighted progress tracker are in:

```text
PROJECT_PLAN.md
```

## Local Run

```powershell
npm start
```

Then open:

```text
http://localhost:4173
```

## Deploy

The GitHub workflow deploys this app to Hugging Face Spaces. Required repository secrets:

```text
HF_TOKEN
HF_SPACE_REPO
```

`HF_SPACE_REPO` can be either:

```text
Nash1372/lumavault-studio
```

or:

```text
https://huggingface.co/spaces/Nash1372/lumavault-studio
```

The workflow can also fall back to the token owner's Hugging Face namespace when the requested namespace is not writable.

## Scope

This project does not log in on behalf of users, store cookies, bypass privacy controls, or bypass platform access restrictions. It works from URLs and page source that the user can already access.
