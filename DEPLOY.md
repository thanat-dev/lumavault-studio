# Deploy LumaVault Studio

## Current Live Static URL

GitHub Pages:

```text
https://thanat-dev.github.io/lumavault-studio/
```

This URL serves the premium UI and client-side workflow.

## Full Server Deploy With Render

Full cloud rendering requires a Node + FFmpeg server. GitHub Pages cannot run FFmpeg or the Node API.

Use this one-click Render deploy URL:

```text
https://render.com/deploy?repo=https://github.com/thanat-dev/lumavault-studio
```

Render will read `render.yaml` and build the Docker service with FFmpeg installed.

## Expected Render Settings

- Environment: Docker
- Health check path: `/api/health`
- Port: `4173`
- Start command: inherited from Dockerfile

## After Render Creates The Service

Render will provide a public URL similar to:

```text
https://lumavault-studio.onrender.com
```

That URL is the full version with:

- `/api/extract`
- `/api/render`
- `/api/render-status`
- `/api/render-file`
- FFmpeg MP4/MP3 rendering

## GitHub Actions Auto Deploy

If you create a Render deploy hook, add it to GitHub repository secrets:

```text
RENDER_DEPLOY_HOOK_URL
```

Then every push to `main` can trigger Render deployment through `.github/workflows/render-deploy.yml`.
