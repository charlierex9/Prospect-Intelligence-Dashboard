name: Run Intelligence Scan

on:
  workflow_dispatch:

permissions:
  contents: write

jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run scanner
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          DATA_PASSPHRASE: ${{ secrets.DATA_PASSPHRASE }}
        run: node scanner.js

      - name: Commit updated data
        run: |
          git config user.name "prospect-bot"
          git config user.email "prospect-bot@users.noreply.github.com"
          git add data.json
          git commit -m "Update intelligence data" || echo "No changes to commit"
          git push
