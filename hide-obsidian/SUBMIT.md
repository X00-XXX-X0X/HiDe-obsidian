# Publishing checklist (not shipped with the plugin)

1. Create a public GitHub repo (e.g. `hide-obsidian`), put the contents of this folder in it (without node_modules/main.js), replace YOUR_GITHUB_USERNAME in manifest.json and LICENSE name if needed.
2. `git tag 0.1.0 && git push --tags` → the workflow creates a release with main.js, manifest.json, styles.css. The tag must equal `version` in manifest.json exactly (no "v").
3. Fork https://github.com/obsidianmd/obsidian-releases and append to `community-plugins.json`:
   {
     "id": "hide",
     "name": "HiDe",
     "author": "Gosha",
     "description": "Build and browse skills as a hierarchy: each skill is built from its foundations. Focus view, states and quick creation of foundations.",
     "repo": "YOUR_GITHUB_USERNAME/hide-obsidian"
   }
   id/name/description must match manifest.json. Open a pull request using the "plugin" template and tick its checklist.
4. A bot validates the entry, then a human reviews the code (can take weeks). Before submitting, check the id "hide" and name "HiDe" aren't already taken in community-plugins.json.
