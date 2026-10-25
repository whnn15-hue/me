# Deployment expectations

This is the existing personal archive app. Follow the user's current instructions when they differ from this file.

The owner's latest instruction (2026-10-25) confirms that the updated app works and establishes the ongoing workflow: **review changes in a browser preview, then publish one final batch only after the owner requests that version's production deployment**. Release `aeb722b` has already been pushed once. The owner reported success; the deployment API and exact published revision remain independently unverified because of access restrictions. That one-time release authorization is fulfilled. Do not trigger another production build to verify it, and do not treat a future feature request, source push, or positive preview feedback as authorization to deploy production.

For subsequent development, work on a separate feature branch and push there, leaving `main` for the user-approved final release. The current workflow branch is `preview/workflow`; it was created from released `main`. Create further feature branches from the appropriate up-to-date base as needed. Keep `[skip netlify] [skip ci]` on source-only pushes until an isolated preview setup is verified. Netlify Deploy Previews use a GitHub pull request and commits without skip markers; a feature-branch push alone is not proof that a preview was created. Verify that previews use synthetic test data and cannot read or write the owner's production Firebase/Drive data before presenting a preview URL. The owner wants to inspect a browser preview before approving later production updates. Preview setup is still pending; do not claim it is configured. Do not create duplicate deployment workflows, change billing, or request a production release merely to test the integration.

Keep the existing Netlify project, production environment variables, Firebase data, Drive data and access protection. Uploaded private originals and import keys stay out of Git; only authenticated encrypted import assets and non-sensitive documentation belong in the repository. Preparing and pushing a data package does not import it into the owner's live account. Report those states separately.

- Repository: `whnn15-hue/me`, production branch `main`.
- Netlify project: `sensational-cuchufli-e3fbc9`.
- Site ID: `f5cf3147-38fc-4cb3-9505-982fbc72c328`.
- Production URL: `https://sensational-cuchufli-e3fbc9.netlify.app/`.
- Build command `npm run build`, publish directory `dist`, functions directory `netlify/functions`.
- Deploy the frontend and Netlify Functions together. Do not replace the site with a static-only upload.

A successful Git push is not proof of a successful deployment. Check Netlify's published production deploy against the pushed commit and verify the live version when access is available. A build request, a build in progress and a published production deploy are different states. Report only the state actually verified.

If the Netlify connection or credentials are unavailable, finish the authorized local work, identify the exact missing connection and request only the information needed to unblock it. Never claim that publishing is complete or invent a deployment failure reason. Never request passwords or personal access tokens in chat. Do not disable site access protection to make verification easier. Native GitHub-to-Netlify deployment is the preferred path. Use it once per approved production batch, and avoid a second deployment workflow that could duplicate builds.

Preserve a pre-change Git commit or backup branch. Do not modify private records to test deployment. Current user preference is desktop-only browser verification. See [the deployment runbook](docs/AUTO_DEPLOY.md).
