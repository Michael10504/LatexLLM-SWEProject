# verify-image.ps1 - checks that ltx-sandbox:1 is built correctly (Step 3)
$img = "ltx-sandbox:1"
function Check($name, $cmd, $expect) {
  $out = (Invoke-Expression $cmd 2>&1 | Out-String).Trim()
  if ($out -match $expect) { Write-Host "[PASS] $name -> $out" -ForegroundColor Green }
  else { Write-Host "[FAIL] $name -> $out" -ForegroundColor Red }
}
Check "latexmk installed"     "docker run --rm $img latexmk -v"                          "Latexmk"
Check "pdflatex installed"    "docker run --rm $img pdflatex --version"                  "pdfTeX"
Check "biber/bibtex present"  "docker run --rm $img sh -c 'command -v bibtex && command -v biber'" "bibtex"
Check "runs as uid 1000"      "docker run --rm $img id -u"                               "^1000$"
Check "shell_escape disabled" "docker run --rm $img kpsewhich -var-value shell_escape"   "^f$"
Check "pkill available"       "docker run --rm $img sh -c 'command -v pkill'"            "pkill"
Check "HOME points to /tmp"   "docker run --rm $img sh -c 'echo `$HOME'"                 "^/tmp$"
docker image ls $img
