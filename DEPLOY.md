# Deploy LumaVault Studio

Current production target: **Hugging Face Spaces**

Current project completion: **38%**

See the full development roadmap in:

```text
PROJECT_PLAN.md
```

## Current Live Static URL

GitHub Pages:

```text
https://thanat-dev.github.io/lumavault-studio/
```

This URL serves the premium UI and client-side workflow.

## Full Server Deploy With Hugging Face Spaces

Render may ask for payment information before creating a Docker service. If you want a no-card public deployment, use Hugging Face Spaces with Docker.

Create a new Space:

```text
https://huggingface.co/new-space
```

Recommended settings:

- Space name: `lumavault-studio`
- SDK: `Docker`
- Visibility: `Public`
- Hardware: Free CPU

Then push or import this GitHub repository:

```text
https://github.com/thanat-dev/lumavault-studio
```

Hugging Face will build the root `Dockerfile`. The app listens on port `7860`, which is the default Docker Spaces port.

You can also deploy through GitHub Actions after creating the Space. Add these repository secrets in GitHub:

```text
HF_TOKEN
HF_SPACE_REPO
```

`HF_SPACE_REPO` example:

```text
https://huggingface.co/spaces/your-username/lumavault-studio
```

Then run the `Deploy to Hugging Face Spaces` workflow manually from the GitHub Actions tab.

Expected URL:

```text
https://huggingface.co/spaces/<your-username>/lumavault-studio
```

The app itself will open inside the Space and support:

- `/api/extract`
- `/api/render`
- `/api/render-status`
- `/api/render-file`
- FFmpeg MP4/MP3 rendering

## Full Server Deploy With Render

Full cloud rendering requires a Node + FFmpeg server. GitHub Pages cannot run FFmpeg or the Node API.

If you later add payment information to Render, use this one-click Render deploy URL:

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
