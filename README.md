# Free GST Billing Software

Static HTML, CSS and Vanilla JavaScript application. No React, npm, Node.js backend, Express or Google sign-in is required.

## Publish on GitHub Pages

1. Upload the contents of this folder to the root of a GitHub repository. Keep `index.html` at the repository root.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/(root)`, then save.
4. Open the GitHub Pages URL after deployment completes.

## Data and privacy

Business records are stored locally in the current browser profile using IndexedDB. Data is not uploaded to GitHub or a shared server. Use the app's backup export/import to move data to another browser or device.

## Notes

- Use the deployed HTTPS site; opening `index.html` directly as a `file://` URL does not support browser ES modules.
- An internet connection is needed to load the app's pinned third-party libraries on first use and for optional online features.
- Keep `CHANGELOG.md`: the in-app What's New screen reads it. Keep `manifest.webmanifest`, `sw.js`, `sw-reload.js`, `boot-guard.js`, `favicon.svg`, `.nojekyll` and the `icons/` folder; they support installability, updates, startup recovery and GitHub Pages hosting.
