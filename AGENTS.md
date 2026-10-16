# Deployment expectations

This is the existing personal archive app. Follow the user's current instructions when they differ from this file.

The owner has repeatedly requested automatic deployment after completed app changes. Within an implementation task, finish the checks, commit the scoped changes and push to `main` using the authorized repository connection. Do not ask for routine deployment approval again. Use the existing Netlify project and preserve its production environment variables, Firebase data, Drive data and access protection.

- Repository: `whnn15-hue/me`, production branch `main`.
- Netlify project: `sensational-cuchufli-e3fbc9`.
- Site ID: `f5cf3147-38fc-4cb3-9505-982fbc72c328`.
- Production URL: `https://sensational-cuchufli-e3fbc9.netlify.app/`.
- Build command `npm run build`, publish directory `dist`, functions directory `netlify/functions`.
- Deploy the frontend and Netlify Functions together. Do not replace the site with a static-only upload.

A successful Git push is not proof of a successful deployment. Check Netlify's published production deploy against the pushed commit and verify the live version when access is available. A build request, a build in progress and a published production deploy are different states. Report only the state actually verified.

If the Netlify connection or credentials are unavailable, finish the authorized local work, identify the exact missing connection and request only the information needed to unblock it. Never claim that publishing is complete or invent a deployment failure reason. Never request passwords or personal access tokens in chat. Do not disable site access protection to make verification easier. Native GitHub-to-Netlify deployment is the preferred path; avoid a second deployment workflow that could duplicate builds.

Preserve a pre-change Git commit or backup branch. Do not modify private records to test deployment. Current user preference is desktop-only browser verification. See [the deployment runbook](docs/AUTO_DEPLOY.md).
