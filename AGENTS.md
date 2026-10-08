# Project Rules & Guidelines for Streamvance

## 1. Automatic Zip Packaging
- Whenever any code or resource file is modified, updated, or created, you **MUST** run:
  ```bash
  python update_zip.py
  ```
  before concluding your turn.
- Ensure `streamvance.zip` is always strictly in sync with the latest code state in the workspace.

## 2. Always Keep Localhost Server Active
- Whenever you begin a turn or work with the project, check if `http://localhost:3000` is running.
- If port 3000 is not listening, proactively start `python server.py` in the background (as a daemon) so the user can test the app immediately without manual setup.

