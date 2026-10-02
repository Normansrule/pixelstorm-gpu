# 18. Troubleshooting

> **Appendix**, chapter 18 of 18. About 5 minutes.

---

## Installing and running

| Symptom | Cause | Fix |
|---|---|---|
| `iverilog: command not found` | Tools not installed | `bash scripts/setup_ubuntu.sh` |
| `./pixelstorm: Permission denied` | Executable bit lost (for example after copying through Windows) | `chmod +x pixelstorm scripts/*.sh` |
| Syntax errors from Node.js | Node.js older than 18 | Install Node 18 or later (for example with nvm) |
| GTKWave does not open under WSL2 | No graphical display | Windows 11 includes WSLg; on Windows 10 install an X server, or copy the `.vcd` to Windows and open it there |
| `timeout` at the end of a run | The kernel never finished: missing `EXIT`, an infinite loop, or a barrier some warp never reaches | Check the last instructions in `./pixelstorm sim <kernel>`; add `EXIT` |
| `MISMATCH` in `./pixelstorm test` | The RTL and the golden model disagree | The message names the first differing cycle, SM, warp and PC. Change `ps_sm.v` and `web/js/pixelstorm.js` together |
| `no kernel "x"` | Name typo | `./pixelstorm list` |

## The website

| Symptom | Cause | Fix |
|---|---|---|
| Pictures missing on the home page | `web/img/` is generated, not committed | `make site` (also run by `make serve`) |
| Visualizer only offers "Golden model in this browser" | `web/traces/` missing, or the page was opened as a file | `make traces`, then `make serve` and use `http://localhost:8000` |
| Your edited kernel does not show up | Traces and the kernel bundle are stale | `make traces` (it also rebuilds `web/js/examples.js`) |
| Hosted site shows 404 | GitHub Pages not enabled | Repository Settings, Pages, Source: GitHub Actions; then `gh workflow run visualizer` |

## Git and GitHub

| Symptom | Cause | Fix |
|---|---|---|
| `refusing to allow an OAuth App to create or update workflow` | Pushing `.github/workflows/` over HTTPS with a token lacking the `workflow` scope | Push over SSH, or `gh auth refresh -s workflow` |
| `Repository not found` on push | The repository does not exist yet, or the remote points at the wrong account | `gh repo view <owner>/<repo>`; create it first |
| `make all` changes many files in `docs/img/` | Figures are regenerated from fresh traces | Expected; commit them with your hardware change |

<!-- chapter-footer -->

---

[Previous: 17. Glossary](17-glossary.md) | [Course map](00-start-here.md) | [Back to the start](00-start-here.md)
