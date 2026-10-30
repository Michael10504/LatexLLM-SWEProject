# setup-vscode.ps1 - installs VS Code extensions and workspace settings for the project
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$extensions = @(
  "ms-azuretools.vscode-docker",
  "dbaeumer.vscode-eslint",
  "esbenp.prettier-vscode",
  "james-yu.latex-workshop",
  "orta.vscode-jest",
  "editorconfig.editorconfig"
)
foreach ($e in $extensions) {
  Write-Host "Installing $e ..."
  code --install-extension $e --force
}

New-Item -ItemType Directory -Force -Path "$root\.vscode" | Out-Null

@'
{
  "recommendations": [
    "ms-azuretools.vscode-docker",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "james-yu.latex-workshop",
    "orta.vscode-jest",
    "editorconfig.editorconfig"
  ]
}
'@ | Set-Content -Encoding utf8 "$root\.vscode\extensions.json"

@'
{
  "files.eol": "\n",
  "files.insertFinalNewline": true,
  "files.trimTrailingWhitespace": true,
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "editor.tabSize": 2,
  "typescript.tsdk": "node_modules/typescript/lib",
  "terminal.integrated.defaultProfile.windows": "PowerShell",
  "files.exclude": {
    "**/node_modules": true,
    "**/*.aux": true,
    "**/*.fls": true,
    "**/*.fdb_latexmk": true,
    "**/*.synctex.gz": true
  },
  "latex-workshop.latex.autoBuild.run": "never",
  "latex-workshop.latex.outDir": "%DIR%/build",
  "jest.runMode": "on-demand",
  "[latex]": { "editor.defaultFormatter": null, "editor.formatOnSave": false },
  "[dockerfile]": { "editor.defaultFormatter": "ms-azuretools.vscode-docker" }
}
'@ | Set-Content -Encoding utf8 "$root\.vscode\settings.json"

Write-Host ""
Write-Host "Done. Installed extensions:"
code --list-extensions | Select-String -Pattern "docker|eslint|prettier|latex|jest|editorconfig"
Write-Host ""
Write-Host "Opening the project in VS Code..."
code "$root"
